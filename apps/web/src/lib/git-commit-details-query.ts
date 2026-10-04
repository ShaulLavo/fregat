import { queryOptions } from '@tanstack/react-query'
import { gitKeys } from '@/lib/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'

export function commitDetailsQueryOptions(path: string, commit: string) {
  return queryOptions({
    queryKey: gitKeys.commitDetails(path, commit),
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
