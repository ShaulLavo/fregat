import {
  loadDirectoryData,
  type DirectoryLoadData,
} from '@/features/file-picker/utils/data-helpers'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import type { FsEntry } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'
import { queryOptions, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export const DIRECTORY_QUERY_STALE_MS = 10_000

export function directoryQueryOptions({
  mode,
  path,
  query,
  showHidden,
}: {
  mode: FilePickerMode
  path: string
  query: string
  showHidden: boolean
}) {
  const queryKey = filePickerKeys.directory(path, query, mode, showHidden)
  const baseQueryKey = filePickerKeys.directory(path, '', mode, showHidden)

  return queryOptions<DirectoryLoadData>({
    queryFn: ({ signal, client }) =>
      loadDirectoryData(
        path,
        query,
        mode,
        signal,
        (entries) => {
          if (signal.aborted) return

          writeStreamedDirectoryEntries({ baseQueryKey, entries, queryClient: client, queryKey })
        },
        { showHidden },
        clientForQueryClient(client),
      ),
    queryKey,
    staleTime: DIRECTORY_QUERY_STALE_MS,
  })
}

export function writeStreamedDirectoryEntries({
  baseQueryKey,
  entries,
  queryClient,
  queryKey,
}: {
  baseQueryKey: QueryKey
  entries: FsEntry[]
  queryClient: QueryClient
  queryKey: QueryKey
}) {
  queryClient.setQueryData<DirectoryLoadData>(
    queryKey,
    (current) => ({
      currentEntry:
        current?.currentEntry ??
        queryClient.getQueryData<DirectoryLoadData>(baseQueryKey)?.currentEntry ??
        null,
      entries,
    }),
    // Streamed prefixes must refetch if their request is aborted.
    { updatedAt: 0 },
  )
}
