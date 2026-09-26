import type { ProviderMcpSignIn, ProviderMcpSignInAttempt } from '@workspace/contracts'
import { errorMessage } from '@workspace/contracts'

import { recordChatPipelineInfo } from '../orchestration/orchestration-logging'
import { mcpConfigErrors } from './structured-errors'

/** How long a started sign-in waits for its page to finish before it is dropped. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** Finished attempts stay readable this long, so a slow poll still sees how they ended. */
const SETTLED_RETENTION_MS = 60_000
/** A pasted address waits this long for the harness to finish the exchange. */
const FINISH_WAIT_MS = 20_000

/**
 * One OAuth sign-in a harness is running. Its redirect goes to the harness's own loopback on
 * this machine; `finish` hands it the address the page ended on when the browser was elsewhere.
 */
export type McpSignInFlow = {
  readonly authorizationUrl: string
  /** Settles when the harness has the token, or has given up. */
  readonly done: Promise<void>
  finish: (callbackUrl: URL) => Promise<void>
  cancel: () => void
}

type Attempt = {
  readonly attemptId: string
  readonly flow: McpSignInFlow
  readonly name: string
  state: ProviderMcpSignInAttempt['state']
  message: string | null
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Pending MCP sign-ins by attempt id. A pasted address is accepted only for a loopback host,
 * the port and path of that attempt's redirect, and its `state`, so the server never fetches
 * anything else on the owner's behalf.
 */
export class McpSignInAttempts {
  private readonly attempts = new Map<string, Attempt>()

  start(name: string, flow: McpSignInFlow): ProviderMcpSignIn {
    const attemptId = crypto.randomUUID()
    const attempt: Attempt = { attemptId, flow, message: null, name, state: 'pending' }
    this.attempts.set(attemptId, attempt)
    const timer = setTimeout(() => flow.cancel(), SIGN_IN_TIMEOUT_MS)
    timer.unref?.()
    flow.done
      .then(() => {
        attempt.state = 'succeeded'
      })
      .catch((error: unknown) => {
        attempt.state = 'failed'
        attempt.message = errorMessage(error)
      })
      .finally(() => {
        clearTimeout(timer)
        recordChatPipelineInfo('chat.pipeline.mcp_sign_in.settled', { name, state: attempt.state })
        setTimeout(() => this.attempts.delete(attemptId), SETTLED_RETENTION_MS).unref?.()
      })
    return { attemptId, authorizationUrl: flow.authorizationUrl }
  }

  read(attemptId: string): ProviderMcpSignInAttempt {
    return this.view(this.require(attemptId))
  }

  async finish(attemptId: string, callbackUrl: string): Promise<ProviderMcpSignInAttempt> {
    const attempt = this.require(attemptId)
    if (attempt.state !== 'pending') return this.view(attempt)

    const callback = matchingCallback(attempt.flow.authorizationUrl, callbackUrl)
    // A harness that finishes can close its listener before the reply arrives; its own outcome
    // decides, so a delivery error counts only when the sign-in did not succeed.
    const delivery = await attempt.flow.finish(callback).then(
      () => null,
      (error: unknown) => error,
    )
    await Promise.race([attempt.flow.done.catch(() => undefined), Bun.sleep(FINISH_WAIT_MS)])
    if (delivery && this.view(attempt).state !== 'succeeded') throw delivery
    return this.view(attempt)
  }

  cancelAll() {
    for (const attempt of this.attempts.values()) attempt.flow.cancel()
  }

  private require(attemptId: string) {
    const attempt = this.attempts.get(attemptId)
    if (attempt) return attempt

    throw mcpConfigErrors.MCP_SIGN_IN_GONE({ internal: { attemptId } })
  }

  private view(attempt: Attempt): ProviderMcpSignInAttempt {
    return {
      attemptId: attempt.attemptId,
      message: attempt.message,
      name: attempt.name,
      state: attempt.state,
    }
  }
}

/** The pasted address, when it is the redirect this attempt is waiting for. */
export function matchingCallback(authorizationUrl: string, pasted: string) {
  const authorization = new URL(authorizationUrl)
  const redirect = URL.canParse(authorization.searchParams.get('redirect_uri') ?? '')
    ? new URL(authorization.searchParams.get('redirect_uri') ?? '')
    : null
  const callback = URL.canParse(pasted) ? new URL(pasted) : null
  const facts = {
    loopback: callback ? LOOPBACK_HOSTS.has(callback.hostname) : false,
    redirectLoopback: redirect ? LOOPBACK_HOSTS.has(redirect.hostname) : false,
    parsed: callback !== null,
    path: callback !== null && callback.pathname === redirect?.pathname,
    port: callback !== null && callback.port === redirect?.port,
    state:
      callback !== null &&
      callback.searchParams.get('state') === authorization.searchParams.get('state'),
  }
  // Delivered to the exact origin the harness listens on: `localhost` may resolve to `::1`.
  if (callback && redirect && callback.protocol === 'http:' && Object.values(facts).every(Boolean))
    return new URL(`${callback.pathname}${callback.search}`, redirect.origin)

  throw mcpConfigErrors.MCP_SIGN_IN_ADDRESS_MISMATCH({ internal: facts })
}

/** The harness listens on this machine's loopback; the pasted address is delivered there. */
export async function replayMcpCallback(callbackUrl: URL) {
  const response = await fetch(callbackUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => {
    throw mcpConfigErrors.MCP_SIGN_IN_FAILED({
      cause: error instanceof Error ? error : undefined,
      internal: { port: callbackUrl.port, stage: 'replay' },
    })
  })
  // The listener's page is for a person; only the harness's own notice says whether it worked.
  await response.body?.cancel()
}
