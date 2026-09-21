import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { settingsReloadOwner, subscribeSettingsReload } from '@/features/settings/state/reload'

export function useSettingsReloadOwner(owner: QueryClient) {
  return useSyncExternalStore(
    subscribeSettingsReload,
    () => settingsReloadOwner(owner),
    () => settingsReloadOwner(owner),
  )
}
