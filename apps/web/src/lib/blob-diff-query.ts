import type { GitFileDiff } from '@workspace/contracts'
import { clientLogContext } from '@/lib/environments/state/log-context'
import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { gitKeys } from '@/lib/query-keys'
import { queryOptions } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

/** Two blob versions of one file, named by their git object ids. */
export type BlobDiffRequest = {
  path: string
  oldPath?: string
  oldObjectId?: string
  newObjectId?: string
}

export function blobDiffQueryOptions(query: BlobDiffRequest) {
  return queryOptions<readonly GitFileDiff[]>({
    queryKey: blobDiffQueryKey(query),
    queryFn: ({ signal, client }) => fetchBlobDiff(query, signal, clientForQueryClient(client)),
    retry: false,
    staleTime: Infinity,
  })
}

export function blobDiffQueryKey(query: BlobDiffRequest) {
  return gitKeys.blobDiff({
    newObjectId: query.newObjectId,
    oldObjectId: query.oldObjectId,
    oldPath: query.oldPath,
    path: query.path,
  })
}

/**
 * Blob diffs carry the full `oldText`/`newText` alongside the hunks, which is
 * what lets the viewer expand the unchanged runs git left out of the patch.
 * Content-addressed by object id, so one fetch per pair is enough forever.
 */
export async function fetchBlobDiff(
  query: BlobDiffRequest,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<GitFileDiff[]> {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'git.diff_blob',
      area: 'git',
      hasNewObject: Boolean(query.newObjectId),
      hasOldObject: Boolean(query.oldObjectId),
      path: query.path,
      signal,
    },
    async () => {
      const response = await client.git.diff.blob.get({
        fetch: { signal },
        query: {
          newObjectId: query.newObjectId,
          oldObjectId: query.oldObjectId,
          oldPath: query.oldPath,
          path: query.path,
        },
      })

      return unwrapEdenResponse<GitFileDiff[]>(response, {
        requireData: true,
        emptyMessage: 'git server returned an empty response',
      })
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}
