import type { KeyChord, EditorKeyCondition } from '@singapor/core/keymap'
export type { KeyChord } from '@singapor/core/keymap'
import type { environmentCommands } from '@/keymap/environment-commands'
import type { FocusArea } from '@/lib/focus/state/service'
import type { HotkeyMeta } from '@tanstack/hotkeys'

// `import type` on purpose: it is erased, so the command table can keep reading
// `SESSION_JUMP_POSITIONS` from here without a runtime cycle.
import type { WorkspaceCommandId } from '@/keymap/workspace-commands'
import type { editorCommands } from '@/keymap/editor-commands'

/** `user` bindings come from the settings document and stand in for a default. */
export type KeyBindingSource = 'default' | 'user'

export {
  SESSION_JUMP_POSITIONS,
  sessionJumpCommandId,
  type SessionJumpPosition,
  type SessionJumpCommandId,
} from '@workspace/client-core/commands/session-jump'

export type { WorkspaceCommandId }

export type EditorPlatformCommandId = (typeof editorCommands)[number]['id']

export type PlatformCommandId =
  | WorkspaceCommandId
  | EditorPlatformCommandId
  | (typeof environmentCommands)[number]['id']

/** Every menu surface recorded as the source of a Platform command. */
export type MenuSurfaceId =
  | 'chat.composer'
  | 'chat.message'
  | 'chat.project'
  | 'chat.session'
  | 'editor.gutter'
  | 'editor.tab'
  | 'editor.text'
  | 'files.empty'
  | 'files.row'
  | 'git.file'
  | 'git.group'
  | 'pane.header'
  | 'sidebar.rail'
  | 'terminal'
  | 'titlebar'
  | 'workspace.project'

export type PlatformKeyBinding = {
  readonly editorWhen?: readonly EditorKeyCondition[]
  readonly keys: string
  readonly chord: KeyChord
  readonly command: PlatformCommandId | null
  readonly pane?: FocusArea | 'any'
  readonly source: KeyBindingSource
  readonly vscodeCommandId?: string
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
  readonly meta?: HotkeyMeta
}

/**
 * The parts of a `KeyboardEvent` a binding is matched against, narrowed so the
 * matcher can be exercised without a DOM.
 */
export type KeyBindingKeyboardEvent = {
  readonly altKey: boolean
  readonly code?: string
  readonly ctrlKey: boolean
  readonly key: string
  readonly isComposing?: boolean
  readonly keyCode?: number
  readonly repeat?: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/** One command's effective binding, as the settings editor lists it. */
export type CommandKeyBinding = {
  readonly command: PlatformCommandId
  readonly defaultKeys: readonly string[]
  /** The binding in force. `null` is an explicit unbind. */
  readonly keys: string | null
  readonly source: KeyBindingSource
}
