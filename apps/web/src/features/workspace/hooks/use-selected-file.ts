import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import { statPath } from '@/lib/file-server'
import type { FileResult, StatResult } from '@/lib/file-system-types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { fileStatVersion } from '@/features/workspace/utils/file-version'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { idleState, type LoadState } from '@/lib/load-state'
import { fileSystemKeys } from '@/lib/query-keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

export function useSelectedFile(filePath: FilesystemPath | null) {
  const queryClient = useQueryClient()
  const query = useQuery<FileResult>({
    ...fileSnapshotQueryOptions(filePath ?? filesystemPath('')),
    enabled: Boolean(filePath),
    placeholderData: (previousFile) => previousFile,
  })
  const { data, error, isError, isPending } = query
  const metadataQuery = useQuery<StatResult>({
    enabled: Boolean(filePath),
    gcTime: 0,
    queryFn: ({ signal, client }) =>
      statPath(filePath ?? filesystemPath(''), signal, clientForQueryClient(client)),
    queryKey: fileSystemKeys.fileMetadata(filePath ?? filesystemPath('')),
    refetchOnMount: 'always',
  })
  // Manual keys: the compiler would also key this on the metadata query, which refetches on every
  // mount, so consumers would see a new `fileState` for a stat that changed nothing.
  const fileState = useMemo(
    () => (filePath ? fileLoadState({ data, error, isError, isPending }, filePath) : idleState),
    [data, error, filePath, isError, isPending],
  )
  const metadata = metadataQuery.isFetching ? undefined : metadataQuery.data
  const fileVersion = selectedFileVersion(filePath, fileState, metadata)

  function resetFileLoad() {
    if (!filePath) return

    queryClient.removeQueries({
      exact: true,
      queryKey: fileSystemKeys.fileSnapshot(filePath),
    })
  }

  return { fileState, fileVersion, resetFileLoad }
}

function selectedFileVersion(
  filePath: FilesystemPath | null,
  fileState: LoadState<FileResult>,
  metadata: StatResult | undefined,
): string | null {
  if (!filePath) return null
  if (fileState.status === 'ready') return fileStatVersion(fileState.data)
  if (metadata?.path === filePath) return metadata.version

  return null
}

export function fileLoadState(
  query: {
    data: FileResult | undefined
    error: Error | null
    isError: boolean
    isPending: boolean
  },
  selectedFilePath: FilesystemPath,
): LoadState<FileResult> {
  if (query.data?.path === selectedFilePath) {
    return { status: 'ready', data: query.data }
  }
  if (query.isError) return { status: 'error', message: clientErrorMessage(query.error) }
  if (query.data) return idleState
  if (query.isPending) return { status: 'loading' }

  return idleState
}
