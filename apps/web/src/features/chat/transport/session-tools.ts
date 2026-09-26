import {
  providerMcpSignInSchema,
  type ProviderMcpSignIn,
  type ProviderSessionHooks,
  type ProviderSessionMcp,
  type ScopedSessionRef,
} from '@workspace/contracts'
import * as v from 'valibot'

import { environmentClientFor } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

function sessionControls(ref: ScopedSessionRef) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  return client.providers.sessions({ sessionId: ref.sessionId })
}

export async function fetchSessionMcp(ref: ScopedSessionRef, signal: AbortSignal) {
  const response = await sessionControls(ref).mcp.get({ fetch: { signal } })
  return unwrapEdenResponse<ProviderSessionMcp>(response, {
    emptyMessage: 'the MCP server list carried no data',
    requireData: true,
  })
}

/** Resolves with the server list after the reconnect, so the list settles without a second read. */
export async function reconnectMcpServer(ref: ScopedSessionRef, name: string) {
  const response = await sessionControls(ref).mcp({ name }).reconnect.post()
  return unwrapEdenResponse<ProviderSessionMcp>(response, {
    emptyMessage: 'the reconnect response carried no server list',
    requireData: true,
  })
}

/** Resolves with the server list after the approval, which restarts an idle session. */
export async function approveMcpServer(ref: ScopedSessionRef, name: string) {
  const response = await sessionControls(ref).mcp({ name }).approve.post()
  return unwrapEdenResponse<ProviderSessionMcp>(response, {
    emptyMessage: 'the approval response carried no server list',
    requireData: true,
  })
}

export async function signInMcpServer(ref: ScopedSessionRef, name: string) {
  const response = await sessionControls(ref).mcp({ name })['sign-in'].post()
  const result = unwrapEdenResponse<ProviderMcpSignIn>(response, {
    emptyMessage: 'the sign-in response carried no address',
    requireData: true,
  })
  return v.parse(providerMcpSignInSchema, result)
}

export async function fetchSessionHooks(ref: ScopedSessionRef, signal: AbortSignal) {
  const response = await sessionControls(ref).hooks.get({ fetch: { signal } })
  return unwrapEdenResponse<ProviderSessionHooks>(response, {
    emptyMessage: 'the hook list carried no data',
    requireData: true,
  })
}
