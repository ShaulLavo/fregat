import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import type { ServerInfo } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent } from 'react'

import { fetchServerInfo } from '@/features/file-picker/utils/data-helpers'

export function useServerInfoForOpen(
  open: boolean,
  onReady: (info: ServerInfo) => void,
  onClose: () => void,
) {
  const closeSession = useEffectEvent(onClose)
  const applyServerInfo = useEffectEvent(onReady)
  const query = useQuery<ServerInfo>({
    enabled: open,
    queryFn: ({ signal, client }) => fetchServerInfo(signal, clientForQueryClient(client)),
    queryKey: filePickerKeys.serverInfo(),
  })

  useEffect(() => {
    if (!open) {
      closeSession()
      return
    }
    if (!query.data) return

    applyServerInfo(query.data)
  }, [open, query.data])

  return {
    refresh: query.refetch,
    serverInfo: query.data ?? null,
    serverInfoError: query.isError ? query.error : null,
  }
}
