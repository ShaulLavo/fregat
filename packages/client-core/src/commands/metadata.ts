import { editorCommandMutates, type KeyChord } from '@singapore-editor/core/keymap'
import type { EditorCommandId } from '@singapore-editor/core/editor'
import type { FocusArea } from './focus'

type CommandPlatformName = 'linux' | 'mac' | 'windows' | 'tui'

export type CommandTargetKind = 'editor' | 'workspace' | 'diagnostic' | 'checkpoint-change'

export type CommandWhen =
  | 'chatMode'
  | 'editorTarget'
  | 'editorWritable'
  | 'fileBackedTab'
  | 'fileOperationRedoable'
  | 'fileOperationUndoable'
  | 'saveableTab'
  | 'sessionActionUndoable'
  | 'sessionActionRedoable'
  | 'tabOpen'
  | 'workspaceOpen'
  | 'workspaceEditRedoable'
  | 'workspaceEditUndoable'
  | 'workspaceMutable'

export type CommandExecution = 'async' | 'sync'

/** The `keybindings.preset` values. `default` is Platform mode. */
export type KeybindingPreset = 'default' | 'vscode'

export type CommandUndoCategory =
  | 'file-operation'
  | 'text-edit'
  | 'view-only'
  | 'workspace-operation'

/** One default key for a command. */
export type CommandKeyDefault = {
  readonly terminalProtocol?: 'kitty'
  readonly chord: KeyChord
  readonly pane?: FocusArea | 'any'
  readonly platforms?: readonly CommandPlatformName[]
  /** Keyboard modes this default belongs to; every mode when absent. */
  readonly presets?: readonly KeybindingPreset[]
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
  /** A modifier chord that leaves a focused text box its own meaning, such as Mod+Z. */
  readonly yieldsToTextEntry?: boolean
  /** VS Code command represented by this specific default binding, used for keymap import/export. */
  readonly vscodeCommandId?: string
}

export type CommandMetadata<
  Id extends string = string,
  Execution extends CommandExecution = CommandExecution,
> = {
  readonly id: Id
  readonly title: string
  readonly description?: string
  readonly category: string
  /** Never set today; read by the palette's keyword builder. Kept as a hook. */
  readonly aliases?: readonly string[]
  readonly vscodeCommandIds?: readonly string[]
  readonly keys?: readonly CommandKeyDefault[]
  readonly execution: Execution
  readonly target: CommandTargetKind
  readonly undoCategory: CommandUndoCategory
  readonly when: readonly CommandWhen[]
  /** Running it only switches palette mode, so the palette stays open. */
  readonly keepsPaletteOpen?: boolean
  /** Not offered in the `>` command list. */
  readonly hiddenInPalette?: boolean
}

export function defineMetadata<const Id extends string, const Execution extends CommandExecution>(
  command: CommandMetadata<Id, Execution>,
): CommandMetadata<Id, Execution> {
  return command
}

export function defineEditorMetadata<const Id extends EditorCommandId>(
  command: Omit<
    CommandMetadata<`editor.${Id}`, 'sync'>,
    'id' | 'category' | 'target' | 'execution' | 'when'
  > & { readonly id: Id },
) {
  const when: CommandWhen[] = ['editorTarget']
  if (editorCommandMutates(command.id)) when.push('editorWritable')
  return {
    ...command,
    keys: command.keys?.map((key) => ({ pane: 'editor' as const, ...key })),
    id: `editor.${command.id}` as const,
    category: 'Editor',
    target: 'editor',
    execution: 'sync',
    when,
  } satisfies CommandMetadata<`editor.${Id}`, 'sync'>
}
