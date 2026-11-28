import type { FileSnapshot } from '@/lib/file-snapshot'
import { markEditorOpenBenchmark } from '@/lib/editor-open-benchmark-mark'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { QueryClient } from '@tanstack/react-query'

import type { FileResult } from '@/lib/file-system-types'
import { fetchFile } from '@/lib/file-server'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fileSystemKeys } from '@/lib/query-keys'
import { pruneFileSnapshotQueryCache } from '@/lib/file-snapshot-cache-policy'

export const FILE_SNAPSHOT_QUERY_GC_TIME_MS = 2 * 60 * 1000
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
    queryFn: ({
      client,
      signal,
    }: {
      client: QueryClient
      signal: AbortSignal
    }): Promise<FileSnapshot> => {
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
  file: FileSnapshot,
  options: { readonly updatedAt?: number } = {},
) {
  const queryKey = fileSystemKeys.fileSnapshot(file.path)
  const query = queryClient
    .getQueryCache()
    .build<FileSnapshot, unknown, FileSnapshot, typeof queryKey>(
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
  const file = queryClient.getQueryData<FileSnapshot>(queryKey)
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
