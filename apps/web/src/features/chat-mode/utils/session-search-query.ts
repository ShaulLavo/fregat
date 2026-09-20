import { sessionSearchQueryKeys } from '@/features/chat-mode/utils/query-keys'
import {
  ORCHESTRATION_SESSION_SEARCH_DEFAULT_LIMIT,
  ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH,
  orchestrationSearchSessionsResultSchema,
  type OrchestrationSearchSessionsResult,
} from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'
import * as v from 'valibot'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'

/**
 * How long typing has to pause before the rail asks the server. Longer than the
 * mention search: this one is a `LIKE '%…%'` scan over every stored message on a
 * synchronous single-connection SQLite handle, so a keystroke-per-request burst
 * queues every other chat request behind it.
 */
export const SESSION_SEARCH_DEBOUNCE_MS = 220

const SESSION_SEARCH_STALE_TIME_MS = 30_000

type SessionSearchQueryKey = ReturnType<typeof sessionSearchQueryKeys.search>

/** The server rejects anything shorter, so a one-character query never leaves the browser. */
export function isSessionSearchQuery(query: string) {
  return query.trim().length >= ORCHESTRATION_SESSION_SEARCH_MIN_QUERY_LENGTH
}

export function sessionSearchQueryOptions(input: { limit?: number; query: string }) {
  const limit = input.limit ?? ORCHESTRATION_SESSION_SEARCH_DEFAULT_LIMIT
  const query = input.query.trim()

  return queryOptions<
    OrchestrationSearchSessionsResult,
    Error,
    OrchestrationSearchSessionsResult,
    SessionSearchQueryKey
  >({
    enabled: isSessionSearchQuery(query),
    queryFn: ({ signal, client }) =>
      searchSessions({ limit, query, signal, client: clientForQueryClient(client) }),
    queryKey: sessionSearchQueryKeys.search(query, limit),
    // A failed scan is not worth a second scan: the user is still typing, and
    // the next keystroke supersedes this query anyway.
    retry: false,
    staleTime: SESSION_SEARCH_STALE_TIME_MS,
  })
}

async function searchSessions({
  client,
  limit,
  query,
  signal,
}: {
  client: Client
  limit: number
  query: string
  signal: AbortSignal
}): Promise<OrchestrationSearchSessionsResult> {
  return observeClientOperation(
    {
      action: 'chat.session_search.http',
      area: 'chat',
      limit,
      // The query is user content and stays off the wide event; its length is
      // what explains a slow scan or a bounds rejection.
      queryLength: query.length,
      signal,
    },
    async () => {
      const response = await client.orchestration['session-search'].post(
        { limit, query },
        { fetch: { signal } },
      )

      return v.parse(
        orchestrationSearchSessionsResultSchema,
        unwrapEdenResponse(response, {
          requireData: true,
          emptyMessage: 'session search returned an empty response',
          normalizeDates: true,
        }),
      )
    },
    (result) => ({ matchCount: result.matches.length }),
  )
}
