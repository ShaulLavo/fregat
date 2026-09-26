import { use } from 'react'

import { CommandContext } from '@/keymap/providers/command-context'
import { commandShortcut } from '@/keymap/utils/format-keys'

/** The effective key for the session Undo command, named on its notice. */
export function useSessionUndoShortcut() {
  const bindings = use(CommandContext)?.bindings
  return bindings ? commandShortcut('workspace.undoSessionAction', bindings) : null
}
