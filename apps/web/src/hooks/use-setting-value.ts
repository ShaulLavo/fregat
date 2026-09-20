import { useContext } from 'react'
import { AppearancePreviewContext } from '@/features/settings/providers/appearance-preview-context'
import type { SettingId, SettingsValues } from '@workspace/contracts'

import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { readSettingBootValue } from '@/lib/settings-boot-mirror'

/**
 * One setting, with its validated boot mirror or registry default until the snapshot lands.
 *
 * The read every consumer outside this feature uses, so no component has to
 * index the raw document or know the query key.
 */
export function useSettingValue<K extends SettingId>(key: K): SettingsValues[K] {
  const preview = useContext(AppearancePreviewContext)
  const projection = useSettingsProjection()

  return preview?.[key] ?? projection?.values[key] ?? readSettingBootValue(key)
}
