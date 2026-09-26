import type { CommandId } from '@workspace/client-core/commands/catalog'
import { commandMetadata } from '@workspace/client-core/commands/catalog'
import { MAX_CHORD_STROKES, normalizedChord } from '@workspace/client-core/commands/chord'
import { recordedStroke, recordingControl } from '@workspace/client-core/settings/recording'

import { terminalBindingReason } from '@/commands/utils/bindings'
import { terminalKeyboardEvent, type TerminalKeyEvent } from '@/commands/utils/keyboard'

export type KeybindingEditorState =
  | { readonly kind: 'select' }
  | { readonly kind: 'actions'; readonly command: CommandId }
  | {
      readonly kind: 'record'
      readonly command: CommandId
      readonly strokes: readonly string[]
      readonly error: string | null
    }
  | {
      readonly kind: 'review'
      readonly command: CommandId
      readonly keys: string | null | undefined
    }

export function recordKey(
  state: KeybindingEditorState,
  event: TerminalKeyEvent,
  kitty: boolean,
): KeybindingEditorState {
  if (state.kind !== 'record' || event.repeated || event.eventType === 'release') return state
  const key = terminalKeyboardEvent(event)
  const control = recordingControl(key)
  if (control === 'cancel' || (key.ctrlKey && key.key.toLowerCase() === 'c'))
    return { kind: 'actions', command: state.command }
  if (control === 'remove') return { ...state, strokes: state.strokes.slice(0, -1), error: null }
  if (control === 'commit') {
    const keys = state.strokes.join(' ')
    const error = terminalBindingReason(state.command, keys, kitty)
    if (error) return { ...state, error }
    return { kind: 'review', command: state.command, keys: normalizedChord(keys, 'linux') }
  }
  if (key.metaKey)
    return { ...state, error: 'Meta shortcuts are reserved by the desktop. Use Control.' }
  // The TUI binds Ctrl as Mod on every host, as its labels say.
  const stroke = recordedStroke(key, 'linux')
  if (!stroke) return state
  if (state.strokes.length === MAX_CHORD_STROKES)
    return {
      ...state,
      error:
        'A shortcut has at most two strokes. Press Enter to review or Backspace to remove one.',
    }
  const strokes = [...state.strokes, stroke]
  return {
    ...state,
    strokes,
    error: terminalBindingReason(state.command, strokes.join(' '), kitty),
  }
}

export function matchingCommands(query: string) {
  return commandMetadata.filter((command) =>
    `${command.id} ${command.title}`.toLowerCase().includes(query.toLowerCase()),
  )
}

export function recordedKeysLabel(keys: string | null | undefined) {
  if (keys === undefined) return 'Restore default'
  if (keys === null) return 'Disabled'
  return keys.replaceAll('Mod+', 'Ctrl+')
}
