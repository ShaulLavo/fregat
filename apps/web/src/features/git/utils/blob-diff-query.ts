import type { GitFileDiff } from '@workspace/contracts'
import { clientLogContext } from '@/lib/environments/state/log-context'
import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapGit } from '@/features/git/utils/api'
import { gitKeys } from '@/lib/query-keys'
import type { UseQueryOptions } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { BlobDiffRequest } from '@/features/git/utils/types'

export function blobDiffQueryOptions(
  query: BlobDiffRequest,
): UseQueryOptions<readonly GitFileDiff[]> {
  return {
    queryKey: blobDiffQueryKey(query),
    queryFn: ({ signal, client }) => fetchBlobDiff(query, signal, clientForQueryClient(client)),
    retry: false,
    staleTime: Infinity,
  }
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

      const diffs = unwrapGit<GitFileDiff[]>(response)

      return diffs.map((diff) => withRequestedPaths(diff, query))
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}

/**
 * `/git/diff/blob` re-roots the paths it parses back out of the patch, so a
 * blob diff for `repo/a.ts` comes back as `repo/repo/a.ts`. The request already
 * names the exact pair being diffed — one blob against one blob — so take the
 * identity from the request and keep only the content from the response.
 */
function withRequestedPaths(diff: GitFileDiff, query: BlobDiffRequest): GitFileDiff {
  const renamed = Boolean(query.oldPath && query.oldPath !== query.path)

  return { ...diff, oldPath: renamed ? query.oldPath : undefined, path: query.path }
}
