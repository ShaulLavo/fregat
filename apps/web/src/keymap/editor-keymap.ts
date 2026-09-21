import type { EditorKeymapOptions } from '@singapore-editor/core/keymap'
import type { EditorCommandId } from '@singapore-editor/core/editor'
import type { PlatformCommandId } from '@/keymap/types'

export const HOSTED_EDITOR_KEYMAP = { enabled: false } satisfies EditorKeymapOptions

const EDITOR_COMMAND_PREFIX = 'editor.'
type EditorAdapterPlatformCommandId = `editor.${EditorCommandId}`

function isEditorPlatformCommandId(
  command: EditorAdapterPlatformCommandId | PlatformCommandId | null,
): command is EditorAdapterPlatformCommandId {
  if (!command) return false

  return command.startsWith(EDITOR_COMMAND_PREFIX)
}

export function editorCommandIdFromPlatform(
  command: EditorAdapterPlatformCommandId | PlatformCommandId | null,
): EditorCommandId | null {
  if (!isEditorPlatformCommandId(command)) return null

  return command.slice(EDITOR_COMMAND_PREFIX.length) as EditorCommandId
}
