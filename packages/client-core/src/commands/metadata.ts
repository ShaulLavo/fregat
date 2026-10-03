import { editorCommandMutates } from '@singapore-editor/core/editor'
import type { EditorCommandId } from '@singapore-editor/core/editor'

export type CommandTargetKind = 'editor' | 'workspace' | 'diagnostic' | 'checkpoint-change'

export type CommandWhen =
  | 'chatMode'
  | 'editorTarget'
  | 'editorWritable'
  | 'editorMarkdown'
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

export type KeybindingPreset = 'ours' | 'zed' | 'vscode'

export type CommandUndoCategory =
  | 'file-operation'
  | 'text-edit'
  | 'view-only'
  | 'workspace-operation'

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

export type EditorPlatformCommandId<Id extends string> = Id extends `editor.${string}`
  ? Id
  : `editor.${Id}`

export function defineEditorMetadata<const Id extends EditorCommandId>(
  command: Omit<
    CommandMetadata<EditorPlatformCommandId<Id>, 'sync'>,
    'id' | 'category' | 'target' | 'execution' | 'when'
  > & { readonly id: Id },
) {
  const when: CommandWhen[] = ['editorTarget']
  if (editorCommandMutates(command.id)) when.push('editorWritable')
  if (command.id.startsWith('markdown.')) when.push('editorMarkdown')
  return {
    ...command,
    id: (command.id.startsWith('editor.')
      ? command.id
      : `editor.${command.id}`) as EditorPlatformCommandId<Id>,
    category: 'Editor',
    target: 'editor',
    execution: 'sync',
    when,
  } satisfies CommandMetadata<EditorPlatformCommandId<Id>, 'sync'>
}
