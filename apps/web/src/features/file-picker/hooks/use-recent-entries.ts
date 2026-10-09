import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { FsEntry, ServerInfo } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { fetchRecentEntries } from '@/features/file-picker/utils/data-helpers'
import { entriesLoadState } from '@/features/file-picker/utils/load-state'

export function useRecentEntries({
  open,
  serverInfo,
  showHidden,
}: {
  open: boolean
  serverInfo: ServerInfo | null
  showHidden: boolean
}) {
  const enabled = open && Boolean(serverInfo)
  const query = useQuery<FsEntry[]>({
    enabled,
    // Recent folders lead the phone list, so a hidden-files toggle must not blank and refill them.
    placeholderData: keepPreviousData,
    queryFn: ({ signal, client }) =>
      fetchRecentEntries(showHidden, signal, clientForQueryClient(client)),
    queryKey: filePickerKeys.recentList(showHidden),
  })

  return {
    loadState: entriesLoadState(query, enabled),
    refresh: query.refetch,
  }
}
