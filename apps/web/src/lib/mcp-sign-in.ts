import { queryOptions } from '@tanstack/react-query'
import type { ProviderMcpSignInAttempt } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { createRpcError } from '@/lib/structured-errors'

/** A browser on the server machine finishes the sign-in by itself; this notices it. */
const PENDING_POLL_MS = 2_000

export const mcpSignInKeys = {
  attempt: (attemptId: string) => ['providers', 'mcp-sign-in', attemptId] as const,
  finish: (attemptId: string) => ['providers', 'mcp-sign-in', 'finish', attemptId] as const,
}

export function mcpSignInAttemptQueryOptions(client: Client, attemptId: string) {
  return queryOptions({
    queryFn: async ({ signal }) => {
      const response = await client.providers['mcp-sign-in']({ attemptId }).get({
        fetch: { signal },
      })
      if (response.error) throw createRpcError(response.error)
      return response.data as ProviderMcpSignInAttempt
    },
    queryKey: mcpSignInKeys.attempt(attemptId),
    refetchInterval: (query) => (query.state.data?.state === 'pending' ? PENDING_POLL_MS : false),
    retry: false,
  })
}

/** Hands the server the address the sign-in page ended on; resolves with how the sign-in ended. */
export async function finishMcpSignIn(client: Client, attemptId: string, callbackUrl: string) {
  const response = await client.providers['mcp-sign-in']({ attemptId }).post({ callbackUrl })
  if (response.error) throw createRpcError(response.error)
  return response.data as ProviderMcpSignInAttempt
}
