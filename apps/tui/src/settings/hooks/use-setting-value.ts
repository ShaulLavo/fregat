import { useSystemColorMode } from '@/theme/hooks/use-system-color-mode'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  DEFAULT_SETTING_VALUES,
  resolveThemeSettings,
  type SettingId,
  type SettingsLayer,
  type SettingsValues,
} from '@workspace/contracts'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'

const NO_OWNER = createStore<{
  readonly projection: {
    readonly values: SettingsValues
    readonly layers: readonly SettingsLayer[]
  }
}>(() => ({ projection: { values: DEFAULT_SETTING_VALUES, layers: [] } }))

export function useSettingValue<K extends SettingId>(
  owner: SettingsOwner | null,
  key: K,
): SettingsValues[K] {
  const systemMode = useSystemColorMode()
  // Theme-derived values are references the bundle or settings already hold, so this is stable.
  return useStore(
    owner?.store ?? NO_OWNER,
    ({ projection }) => resolveThemeSettings(projection.values, systemMode, projection.layers)[key],
  )
}
