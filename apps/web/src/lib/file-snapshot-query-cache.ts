import { markEditorOpenBenchmark } from '@/lib/editor-open-benchmark-mark'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { Query, QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'

import type { FileResult } from '@/lib/file-system-types'
import { fetchFile } from '@/lib/file-server'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fileSystemKeys } from '@/lib/query-keys'

export const FILE_SNAPSHOT_QUERY_GC_TIME_MS = 2 * 60 * 1000
const FILE_SNAPSHOT_QUERY_CACHE_LIMIT = 64
export const FILE_SNAPSHOT_STALE_MS = 5_000

type FileSnapshotFetcher = (path: FilesystemPath, signal: AbortSignal) => Promise<FileResult>

type FileSnapshotQueryConfig = {
  readonly fetcher?: FileSnapshotFetcher
}

// Single source of truth for file-snapshot queries. The selected-file useQuery,
// intent prefetches, and workspace event sync all build their options here so
// they share one query key, one freshness window, and one in-flight fetch
// instead of racing duplicate reads of the same file.
export function fileSnapshotQueryOptions(
  path: FilesystemPath,
  config: FileSnapshotQueryConfig = {},
) {
  return {
    gcTime: FILE_SNAPSHOT_QUERY_GC_TIME_MS,
    queryFn: ({ client, signal }: { client: QueryClient; signal: AbortSignal }) => {
      markEditorOpenBenchmark('editor.file_open.file_read', path)
      if (config.fetcher) return config.fetcher(path, signal)
      return fetchFile(path, signal, clientForQueryClient(client))
    },
    queryKey: fileSystemKeys.fileSnapshot(path),
    staleTime: FILE_SNAPSHOT_STALE_MS,
  }
}

export function setFileSnapshotQueryData(
  queryClient: QueryClient,
  file: FileResult,
  options: { readonly updatedAt?: number } = {},
) {
  const queryKey = fileSystemKeys.fileSnapshot(file.path)
  const query = queryClient
    .getQueryCache()
    .build<FileResult, unknown, FileResult, typeof queryKey>(
      queryClient,
      queryClient.defaultQueryOptions(fileSnapshotQueryOptions(file.path)),
    )
  query.setData(file, { manual: true, updatedAt: options.updatedAt })
  pruneFileSnapshotQueryCache(queryClient)
}

/** Removes the old entry before writing the new one, so a move never overfills the cache cap. */
export function moveFileSnapshotQueryData(
  queryClient: QueryClient,
  from: FilesystemPath,
  to: FilesystemPath,
) {
  const queryKey = fileSystemKeys.fileSnapshot(from)
  const file = queryClient.getQueryData<FileResult>(queryKey)
  queryClient.removeQueries({ exact: true, queryKey })
  if (!file) return

  setFileSnapshotQueryData(queryClient, { ...file, path: to })
}

export function ensureFileSnapshotQuery(
  queryClient: QueryClient,
  path: FilesystemPath,
  config: FileSnapshotQueryConfig = {},
) {
  return queryClient.query(fileSnapshotQueryOptions(path, config))
}

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
