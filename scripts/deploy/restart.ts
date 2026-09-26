import * as v from 'valibot'

import { meshOrigin, serverPort } from './config'
import { log } from './run'
import { errorMessage } from '../../packages/contracts/src/error-fields'
import type { SessionId } from '../../packages/contracts/src/chat-ids'
import {
  serverRestartResultSchema,
  serverUpdateErrorSchema,
  type BusySession,
  type ServerRestartResult,
} from '../../packages/contracts/src/server-update'
import { scriptErrors } from '../structured-errors'

export type RestartOptions = {
  /** End busy turns, like the Restart button's interrupt choice. */
  interrupt: boolean
  waitMs: number
  /** The caller runs under the production server, so its own turn counts as busy. */
  insidePlatform: boolean
}

/** How `--restart` reaches the server; tests pass a scripted one. */
export type RestartControl = {
  request: (interrupt: readonly SessionId[]) => Promise<ServerRestartResult>
  now: () => number
  sleep: (ms: number) => Promise<void>
  print: (text: string) => void
}

const BUSY_POLL_MS = 5_000

/** The staged release directory `--restart` promotes; nothing staged is an error. */
export function requireStaged(staged: string | null, productionRoot: string) {
  if (staged) return staged
  throw scriptErrors.NOTHING_STAGED({ internal: { productionRoot } })
}

/**
 * Sends the Restart button's request until the server accepts it. Busy sessions are waited
 * out, or interrupted with `interrupt`; the server exits into the staged release on accept.
 */
export async function requestRestart(options: RestartOptions, control = liveRestartControl) {
  const deadline = control.now() + options.waitMs
  let interrupting: readonly SessionId[] = []
  let shown = false
  for (;;) {
    const answer = await control.request(interrupting)
    if (answer.restarting) return
    if (control.now() >= deadline) throw busyFailure(answer.busy, options.waitMs)

    if (options.interrupt) {
      // The server refuses when a session became busy after the list it sent; name it too.
      interrupting = answer.busy.map((session) => session.sessionId)
      continue
    }
    // A sleeping session runs nothing, so waiting never ends it; the restart ends its schedules.
    const sleeping = answer.busy.filter((session) => session.state === 'sleeping')
    if (sleeping.length === answer.busy.length) {
      control.print(sleepingText(sleeping))
      interrupting = sleeping.map((session) => session.sessionId)
      continue
    }
    if (!shown) control.print(busyText(answer.busy, options))
    shown = true
    await control.sleep(BUSY_POLL_MS)
  }
}

export function busyText(busy: readonly BusySession[], options: RestartOptions) {
  const minutes = Math.round(options.waitMs / 60_000)
  const lines = [
    `[restart] waiting up to ${minutes}m for ${busy.length} busy session${busy.length === 1 ? '' : 's'}:`,
    ...busy.map((session) => `  ${sessionLabel(session)} (${session.state})`),
  ]
  if (options.insidePlatform)
    lines.push(
      '[restart] This command runs inside a Platform session, whose own turn is busy until it ends.',
      '[restart] Rerun with --interrupt; the restart then ends this turn too.',
    )
  return lines.join('\n')
}

function sleepingText(sleeping: readonly BusySession[]) {
  return [
    `[restart] ending the schedules of ${sleeping.length} sleeping session${sleeping.length === 1 ? '' : 's'}:`,
    ...sleeping.map((session) => `  ${sessionLabel(session)}`),
  ].join('\n')
}

function sessionLabel(session: BusySession) {
  return session.projectTitle ? `${session.projectTitle} › ${session.title}` : session.title
}

function busyFailure(busy: readonly BusySession[], waitMs: number) {
  return scriptErrors.RESTART_BUSY({
    count: busy.length,
    minutes: Math.round(waitMs / 60_000),
    internal: { busy: busy.map(({ sessionId, state }) => ({ sessionId, state })) },
  })
}

const liveRestartControl: RestartControl = {
  request: postRestart,
  now: Date.now,
  sleep: (ms) => Bun.sleep(ms),
  print: (text) => console.log(text),
}

// The auth guard is an exact origin allowlist on a loopback socket (auth.ts). Sending the
// app's own origin makes this the same request the Restart button sends.
async function postRestart(interrupt: readonly SessionId[]): Promise<ServerRestartResult> {
  log('restart', `POST /server/restart (interrupting ${interrupt.length})`)
  const response = await fetch(`http://127.0.0.1:${serverPort}/server/restart`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: meshOrigin,
      'x-client-instance': 'deploy-cli',
    },
    body: JSON.stringify({ interrupt }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: unknown) => {
    throw scriptErrors.RESTART_REQUEST_FAILED({
      detail: errorMessage(error),
      internal: { port: serverPort },
    })
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) return v.parse(serverRestartResultSchema, body)

  throw restartRefusal(response.status, body)
}

/** Maps the server's refusal body to a script error. */
export function restartRefusal(status: number, body: unknown) {
  const parsed = v.safeParse(errorBodySchema, body)
  if (!parsed.success)
    return scriptErrors.RESTART_REQUEST_FAILED({ detail: `HTTP ${status}`, internal: { status } })

  const { code, message, why, fix } = parsed.output.error
  if (code.endsWith('NO_UPDATE_STAGED'))
    return scriptErrors.NOTHING_STAGED({ internal: { status, code } })
  const detail = [`${status} ${code}: ${message}`, why, fix].filter(Boolean).join(' ')
  return scriptErrors.RESTART_REQUEST_FAILED({ detail, internal: { status, code } })
}

const errorBodySchema = v.object({ error: serverUpdateErrorSchema })
