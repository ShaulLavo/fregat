import type { ServerInfo } from '@/lib/file-system-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { directoryLoadState } from '@/features/file-picker/utils/load-state'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import { filePickerKeys } from '@/lib/query-keys'

export function useDirectoryLoad({
  currentPath,
  effectiveQuery,
  open,
  serverInfo,
  showHidden,
}: {
  currentPath: string
  effectiveQuery: string
  open: boolean
  serverInfo: ServerInfo | null
  showHidden: boolean
}) {
  const queryClient = useQueryClient()
  const enabled = open && Boolean(serverInfo)
  const query = useQuery({
    ...directoryQueryOptions({
      path: currentPath,
      query: effectiveQuery,
      showHidden,
    }),
    enabled,
    placeholderData: (previous) => {
      if (previous?.currentEntry?.path === currentPath) return previous

      if (!effectiveQuery) return undefined

      return queryClient.getQueryData(filePickerKeys.directory(currentPath, '', showHidden))
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
