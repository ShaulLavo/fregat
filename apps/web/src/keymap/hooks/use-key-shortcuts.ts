import { detectPlatform } from '@tanstack/hotkeys'
import { use } from 'react'

import { KeyBindingsContext } from '@/keymap/providers/bindings-context'
import type { PlatformCommandId } from '@/keymap/types'
import { ariaKeyShortcuts } from '@/keymap/utils/shortcut-hints'

/** `aria-keyshortcuts` for a control the command acts on. */
export function useKeyShortcuts(command: PlatformCommandId | null) {
  const bindings = use(KeyBindingsContext)
  return command ? ariaKeyShortcuts(bindings, command, detectPlatform()) : undefined
}
