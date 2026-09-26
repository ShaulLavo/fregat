import type { KeyChord, EditorKeyCondition } from '@singapore-editor/core/keymap'
export type { KeyChord } from '@singapore-editor/core/keymap'
import type { environmentCommands } from '@/keymap/environment-commands'
import type { FocusArea } from '@/lib/focus/state/service'
import type { HotkeyMeta } from '@tanstack/hotkeys'

// `import type` on purpose: it is erased, so the command table can keep reading
// `ITEM_POSITIONS` from here without a runtime cycle.
import type { WorkspaceCommandId } from '@/keymap/workspace-commands'
import type { editorCommands } from '@/keymap/editor-commands'

/** `user` bindings come from the settings document and stand in for a default. */
type KeyBindingSource = 'default' | 'user'

export {
  ITEM_POSITIONS,
  selectItemCommandId,
  sidebarPanelCommandId,
} from '@workspace/client-core/commands/item-position'

type EditorPlatformCommandId = (typeof editorCommands)[number]['id']

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
  | 'terminal.tab'
  | 'editor.text'
  | 'files.empty'
  | 'files.row'
  | 'git.file'
  | 'git.group'
  | 'pane.header'
  | 'search.file'
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
  readonly yieldsToTextEntry?: boolean
  readonly meta?: HotkeyMeta
}
