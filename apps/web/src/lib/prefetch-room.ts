import type { QueryClient, QueryKey } from '@tanstack/react-query'

// A long list raises an intent for every row a pointer path or a scroll passes over.
const SPECULATIVE_PREFETCH_LIMIT = 4

/** Whether a guessed prefetch under `queryKey` may start; past the limit the guess is skipped. */
export function hasPrefetchRoom(queryClient: QueryClient, queryKey: QueryKey) {
  return queryClient.isFetching({ queryKey }) < SPECULATIVE_PREFETCH_LIMIT
}
