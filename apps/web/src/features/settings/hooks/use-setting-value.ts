import type { SettingId, SettingsValues } from '@workspace/contracts'

import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { readSettingBootValue } from '@/features/settings/utils/boot-mirror'

/**
 * One setting, with its validated boot mirror or registry default until the snapshot lands.
 *
 * The read every consumer outside this feature uses, so no component has to
 * index the raw document or know the query key.
 */
export function useSettingValue<K extends SettingId>(key: K): SettingsValues[K] {
  const projection = useSettingsProjection()

  return projection?.values[key] ?? readSettingBootValue(key)
}
