import type { nodeCommands } from '@/keymap/node-commands'
import type { BindingSource, KeyChord, KeymapEntry } from '@fregat/hotkeys'
import type { environmentCommands } from '@/keymap/environment-commands'

// `import type` on purpose: it is erased, so the command table can keep reading
// `ITEM_POSITIONS` from here without a runtime cycle.
import type { WorkspaceCommandId } from '@/keymap/workspace-commands'
import type { editorCommands } from '@/keymap/editor-commands'

export {
  ITEM_POSITIONS,
  selectItemCommandId,
  sidebarPanelCommandId,
} from '@workspace/client-core/commands/item-position'

type EditorPlatformCommandId = (typeof editorCommands)[number]['id']

export type PlatformCommandId =
  | (typeof nodeCommands)[number]['id']
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
  readonly entry: KeymapEntry
  readonly keys: string
  readonly chord: KeyChord
  readonly command: PlatformCommandId | null
  readonly context?: string
  readonly source: BindingSource
  readonly upstreamCommandId?: string
  readonly yieldsToTextEntry?: boolean
  readonly firesWhileTyping?: boolean
}
