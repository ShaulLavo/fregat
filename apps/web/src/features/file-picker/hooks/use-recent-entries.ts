import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FsEntry, ServerInfo } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query'

import { fetchRecentEntries } from '@/features/file-picker/utils/data-helpers'
import { entriesLoadState } from '@/features/file-picker/utils/load-state'
import type { FilePickerMode } from '@/features/file-picker/utils/model'

export function useRecentEntries({
  mode,
  open,
  serverInfo,
  showHidden,
}: {
  mode: FilePickerMode
  open: boolean
  serverInfo: ServerInfo | null
  showHidden: boolean
}) {
  const enabled = open && Boolean(serverInfo)
  const query = useQuery<FsEntry[]>({
    enabled,
    queryFn: ({ signal, client }) =>
      fetchRecentEntries(mode, showHidden, signal, clientForQueryClient(client)),
    queryKey: filePickerKeys.recentList(mode, showHidden),
  })

  return {
    loadState: entriesLoadState(query, enabled),
    refresh: query.refetch,
  }
}
