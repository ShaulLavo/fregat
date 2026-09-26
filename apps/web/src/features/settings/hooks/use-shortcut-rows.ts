import { detectPlatform } from '@tanstack/hotkeys'

import { useSettingValue } from '@/hooks/use-setting-value'
import { presetPlatformKeyBindings } from '@/keymap/default-bindings'
import { shortcutRows } from '@/features/settings/utils/shortcut-rows'

/** Every command's shortcut row under the current preset and overrides, on this host. */
export function useShortcutRows() {
  const overrides = useSettingValue('keybindings.overrides')
  const preset = useSettingValue('keybindings.preset')
  const platform = detectPlatform()
  const defaults = presetPlatformKeyBindings(platform, preset)

  return {
    defaults,
    overrides,
    platform,
    preset,
    rows: shortcutRows(defaults.bindings, overrides, platform),
  }
}
