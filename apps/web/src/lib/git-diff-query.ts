import type { GitFileDiff } from '@workspace/contracts'
import { queryOptions } from '@tanstack/react-query'
import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { unwrapEdenResponse } from '@/lib/eden-events'
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

export async function fetchDiff(
  path: string,
  staged: boolean,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeClientOperation(
    { ...clientLogContext(client), action: 'git.diff', area: 'git', path, signal, staged },
    async () => {
      const response = await client.git.diff.get({
        query: { path, staged },
        fetch: { signal },
      })

      return unwrapEdenResponse(response, {
        requireData: true,
        emptyMessage: 'git server returned an empty response',
      })
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}
