import { queryOptions } from '@tanstack/react-query'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

export function languageCensusQueryOptions(root: string) {
  return queryOptions({
    queryKey: editorQueryKeys.languageCensus(root),
    queryFn: async ({ client, signal }) => {
      const response = await clientForQueryClient(client).fs['workspace-index'].languages.get({
        query: { root },
        fetch: { signal },
      })
      if (response.error) throw createRpcError(response.error)
      return response.data
    },
    staleTime: 5 * 60 * 1000,
  })
}
