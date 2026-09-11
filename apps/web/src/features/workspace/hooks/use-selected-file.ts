import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { errorMessage, statPath } from '@/lib/file-server'
import type { FileResult, StatResult } from '@/lib/file-system-types'
import { fileBackedDocumentPath } from '@/features/editor/utils/file-backed-document'
import { fileStatVersion } from '@/features/workspace/utils/file-version'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { idleState, type LoadState } from '@/lib/load-state'
import { fileSystemKeys } from '@/lib/query-keys'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

export function useSelectedFile(selectedFilePath: string | null) {
  const queryClient = useQueryClient()
  const filePath = fileBackedDocumentPath(selectedFilePath)
  const query = useQuery<FileResult>({
    ...fileSnapshotQueryOptions(filePath ?? ''),
    enabled: Boolean(filePath),
    placeholderData: (previousFile) => previousFile,
  })
  const { data, error, isError, isPending } = query
  const metadataQuery = useQuery<StatResult>({
    enabled: Boolean(filePath),
    gcTime: 0,
    queryFn: ({ signal, client }) => statPath(filePath ?? '', signal, clientForQueryClient(client)),
    queryKey: fileSystemKeys.fileMetadata(filePath ?? ''),
    refetchOnMount: 'always',
  })
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
  filePath: string | null,
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
  selectedFilePath: string,
): LoadState<FileResult> {
  if (query.data?.path === selectedFilePath) {
    return { status: 'ready', data: query.data }
  }
  if (query.isError) return { status: 'error', message: errorMessage(query.error) }
  if (query.data) return idleState
  if (query.isPending) return { status: 'loading' }

  return idleState
}
