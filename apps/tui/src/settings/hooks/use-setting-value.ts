import { useSystemColorMode } from '@/theme/hooks/use-system-color-mode'
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_SETTING_VALUES,
  resolveThemeSettings,
  type SettingId,
  type SettingsValues,
} from '@workspace/contracts'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'

import { emptySettingsSubscription } from '@/settings/utils/subscription'

export function useSettingValue<K extends SettingId>(
  owner: SettingsOwner | null,
  key: K,
): SettingsValues[K] {
  const systemMode = useSystemColorMode()
  const snapshot = useSyncExternalStore(
    owner?.subscribe ?? emptySettingsSubscription,
    () => owner?.getSnapshot().projection.values ?? DEFAULT_SETTING_VALUES,
  )
  return resolveThemeSettings(snapshot, systemMode, owner?.getSnapshot().projection.layers)[key]
}
