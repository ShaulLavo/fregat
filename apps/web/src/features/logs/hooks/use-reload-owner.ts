import { useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { logsReloadOwner, subscribeLogsReload } from '@/features/logs/state/reload'

export function useLogsReloadOwner() {
  const owner = useQueryClient()
  return useSyncExternalStore(
    subscribeLogsReload,
    () => logsReloadOwner(owner),
    () => logsReloadOwner(owner),
  )
}
