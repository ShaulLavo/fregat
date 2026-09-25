import { detectPlatform } from '@tanstack/hotkeys'
import { use, useSyncExternalStore } from 'react'

import { KeyBindingsContext } from '@/keymap/providers/bindings-context'
import { heldModifiers, subscribeHeldModifiers } from '@/keymap/state/held-modifiers'
import type { PlatformCommandId } from '@/keymap/types'
import { shortcutHintLabel } from '@/keymap/utils/shortcut-hints'

/**
 * The key to badge a target with while its command's modifiers are held, else null.
 * The snapshot is the label itself, so a target re-renders only when its own badge changes.
 */
export function useShortcutHint(command: PlatformCommandId | null) {
  const bindings = use(KeyBindingsContext)
  const platform = detectPlatform()
  const snapshot = () =>
    command ? shortcutHintLabel(bindings, command, heldModifiers(), platform) : null

  return useSyncExternalStore(subscribeHeldModifiers, snapshot, () => null)
}
