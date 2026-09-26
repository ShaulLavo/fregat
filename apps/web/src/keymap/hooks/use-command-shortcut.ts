import { resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import type { PlatformCommandId } from '@/keymap/types'
import { commandShortcut } from '@/keymap/utils/format-keys'
import { useSettingValue } from '@/hooks/use-setting-value'

/**
 * The chord bound to `command`, formatted for display, or null when nothing is bound. Read from
 * the keybinding settings, not the command context, so a hint does not re-render per palette key.
 */
export function useCommandShortcut(command: PlatformCommandId | undefined): string | null {
  const overrides = useSettingValue('keybindings.overrides')
  const preset = useSettingValue('keybindings.preset')
  if (!command) return null
  const bindings = resolvedPlatformKeyBindings(
    defaultPlatformKeyBindings(undefined, preset),
    overrides,
  )
  return commandShortcut(command, bindings)
}
