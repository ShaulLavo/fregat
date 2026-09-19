import {
  infiniteQueryOptions,
  queryOptions,
  type QueryFunctionContext,
} from '@tanstack/react-query'
import type { GitHistoryCursor } from '@workspace/contracts'
import { gitKeys } from '@/lib/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'

export const historyKeys = {
  page: (path: string, ref: string, search: string) =>
    [...gitKeys.all, 'history', path, ref, search] as const,
  commit: (path: string, commit: string) =>
    [...gitKeys.all, 'history-commit', path, commit] as const,
}

function sameHistorySource(key: readonly unknown[] | undefined, path: string, ref: string) {
  if (!key) return false
  const searchIndex = key.length - 1

  return key[searchIndex - 2] === path && key[searchIndex - 1] === ref
}

export function historyQueryOptions(path: string, ref: string, search: string) {
  return infiniteQueryOptions({
    queryKey: historyKeys.page(path, ref, search),
    initialPageParam: null,
    queryFn: ({
      client: queryClient,
      signal,
      pageParam,
    }: QueryFunctionContext<ReturnType<typeof historyKeys.page>, GitHistoryCursor | null>) => {
      const client = clientForQueryClient(queryClient)
      return observeClientOperation(
        {
          ...clientLogContext(client),
          area: 'git',
          action: 'git.history',
          path,
          ref,
          signal,
          skip: pageParam?.skip ?? 0,
        },
        async () =>
          unwrapEdenResponse(
            await client.git.history.post(
              { path, ref, search, cursor: pageParam ?? undefined },
              { fetch: { signal } },
            ),
            { requireData: true, emptyMessage: 'Git returned no history response' },
          ),
        (page) => ({ commitCount: page.commits.length, hasMore: page.next !== null }),
      )
    },
    getNextPageParam: (page) => page.next,
    // Typing in the search keeps the last rows up; another repository or ref never lends its rows.
    placeholderData: (previous, previousQuery) =>
      sameHistorySource(previousQuery?.queryKey, path, ref) ? previous : undefined,
    staleTime: 30_000,
  })
}

export function commitDetailsQueryOptions(path: string, commit: string) {
  return queryOptions({
    queryKey: historyKeys.commit(path, commit),
    queryFn: ({ client: queryClient, signal }) => {
      const client = clientForQueryClient(queryClient)
      return observeClientOperation(
        {
          ...clientLogContext(client),
          area: 'git',
          action: 'git.history_commit',
          path,
          commit,
          signal,
        },
        async () =>
          unwrapEdenResponse(
            await client.git.history.commit.get({ query: { path, commit }, fetch: { signal } }),
            { requireData: true, emptyMessage: 'Git returned no commit response' },
          ),
        (details) => ({ fileCount: details.files.length }),
      )
    },
    staleTime: Infinity,
  })
}
