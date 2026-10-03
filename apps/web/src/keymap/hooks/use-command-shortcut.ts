import { use } from 'react'
import { KeyBindingsContext } from '@/keymap/providers/bindings-context'
import type { PlatformCommandId } from '@/keymap/types'
import { commandShortcut } from '@/keymap/utils/format-keys'

/** The effective chord formatted for menus and tooltips. */
export function useCommandShortcut(command: PlatformCommandId | undefined): string | null {
  const bindings = use(KeyBindingsContext)
  return command ? commandShortcut(command, bindings) : null
}
