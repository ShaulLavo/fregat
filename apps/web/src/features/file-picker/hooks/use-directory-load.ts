import type { ServerInfo } from '@/lib/file-system-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { directoryLoadState } from '@/features/file-picker/utils/load-state'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { filePickerKeys } from '@/lib/query-keys'

export function useDirectoryLoad({
  currentPath,
  effectiveQuery,
  mode,
  open,
  serverInfo,
  showHidden,
}: {
  currentPath: string
  effectiveQuery: string
  mode: FilePickerMode
  open: boolean
  serverInfo: ServerInfo | null
  showHidden: boolean
}) {
  const queryClient = useQueryClient()
  const enabled = open && Boolean(serverInfo)
  const query = useQuery({
    ...directoryQueryOptions({
      mode,
      path: currentPath,
      query: effectiveQuery,
      showHidden,
    }),
    enabled,
    placeholderData: () => {
      if (!effectiveQuery) return undefined

      return queryClient.getQueryData(filePickerKeys.directory(currentPath, '', mode, showHidden))
    },
  })

  return {
    currentEntry: query.data?.currentEntry ?? null,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    loadState: directoryLoadState(query, enabled),
    refresh: query.refetch,
  }
}
