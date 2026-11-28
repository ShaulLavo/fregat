import type { Query, QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fileSystemKeys } from '@/lib/query-keys'

const FILE_SNAPSHOT_QUERY_CACHE_LIMIT = 64

export function installFileSnapshotQueryCachePolicy(queryClient: QueryClient) {
  let pruneQueued = false

  return queryClient.getQueryCache().subscribe((event) => {
    if (!isFileSnapshotQueryKey(event.query.queryKey)) return

    if (pruneQueued) return

    pruneQueued = true
    queueMicrotask(() => {
      pruneQueued = false
      pruneFileSnapshotQueryCache(queryClient)
    })
  })
}

export function pruneFileSnapshotQueryCache(
  queryClient: QueryClient,
  limit = FILE_SNAPSHOT_QUERY_CACHE_LIMIT,
) {
  const queries = fileSnapshotQueries(queryClient)
  const overflow = queries.length - limit
  if (overflow <= 0) return 0

  const candidates = queries
    .filter((query) => !query.isActive())
    .sort(compareFileSnapshotQueriesForEviction)
  let removed = 0
  for (const query of candidates) {
    if (removed >= overflow) break

    queryClient.removeQueries({ exact: true, queryKey: query.queryKey })
    removed += 1
  }

  return removed
}

function fileSnapshotQueries(queryClient: QueryClient) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: fileSystemKeys.fileSnapshots() })
    .filter(isCachedFileSnapshotQuery)
}

function isCachedFileSnapshotQuery(query: Query) {
  if (!isFileSnapshotQueryKey(query.queryKey)) return false

  return query.state.data !== undefined
}

function compareFileSnapshotQueriesForEviction(left: Query, right: Query) {
  return left.state.dataUpdatedAt - right.state.dataUpdatedAt
}

function isFileSnapshotQueryKey(
  queryKey: QueryKey,
): queryKey is ReturnType<typeof fileSystemKeys.fileSnapshot> {
  return (
    queryKey.length === 3 &&
    queryKey[0] === fileSystemKeys.all[0] &&
    queryKey[1] === fileSystemKeys.fileSnapshots()[1] &&
    typeof queryKey[2] === 'string'
  )
}

/** Every file-snapshot read, and no other query under the snapshot key family. */
export const fileSnapshotReads: QueryFilters = {
  predicate: (query) => isFileSnapshotQueryKey(query.queryKey),
}

export function fileSnapshotPathFromQueryKey(queryKey: QueryKey): FilesystemPath | null {
  if (!isFileSnapshotQueryKey(queryKey)) return null

  return filesystemPath(queryKey[2])
}
