import type { GitFileDiff } from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'
import { fetchDiff } from '@/features/git/utils/api'
import { blobDiffQueryKey } from '@/lib/blob-diff-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { gitKeys } from '@/lib/query-keys'

export function diffQueryOptions(path: string, staged: boolean) {
  return queryOptions<readonly GitFileDiff[]>({
    queryKey: gitKeys.diff(path, staged),
    staleTime: 1000,
    queryFn: async ({ signal, client }) => {
      const diffs = await fetchDiff(path, staged, signal, clientForQueryClient(client))
      for (const diff of diffs) {
        if (diff.omitted) continue
        if (!diff.oldObjectId && !diff.newObjectId) continue
        client.setQueryData(blobDiffQueryKey(diff), [diff])
      }
      return diffs
    },
  })
}
