import { EDITOR_COMMANDS } from '@singapore-editor/core/keymap'
import type { EditorCommandId } from '@singapore-editor/core/editor'
import type { PlatformCommandId } from '@/keymap/types'

export function editorPlatformCommandId(command: string): string {
  return command.startsWith('editor.') ? command : `editor.${command}`
}

const editorIds = new Map(EDITOR_COMMANDS.map(({ id }) => [editorPlatformCommandId(id), id]))

export function editorCommandIdFromPlatform(
  command: PlatformCommandId | string | null,
): EditorCommandId | null {
  return command ? (editorIds.get(command) ?? null) : null
}
