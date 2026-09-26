import { detectPlatform } from '@tanstack/hotkeys'
import { use, useSyncExternalStore } from 'react'

import { KeyBindingsContext } from '@/keymap/providers/bindings-context'
import { heldModifiers, subscribeHeldModifiers } from '@/keymap/state/held-modifiers'
import type { PlatformCommandId } from '@/keymap/types'
import { shortcutHintLabel } from '@/keymap/utils/shortcut-hints'

/** Whether the held modifiers badge any of these commands. */
export function useAnyShortcutHint(commands: readonly PlatformCommandId[]) {
  const bindings = use(KeyBindingsContext)
  const platform = detectPlatform()
  const snapshot = () => {
    const held = heldModifiers()
    return commands.some((command) => shortcutHintLabel(bindings, command, held, platform) !== null)
  }

  return useSyncExternalStore(subscribeHeldModifiers, snapshot, () => false)
}
