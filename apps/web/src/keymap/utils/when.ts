import { filesystemResource, saveCapability } from '@/lib/documents/utils/capabilities'
import type { DocumentRef, TabId } from '@/lib/documents/utils/types'
import type { CommandTargetKind, CommandWhen } from '@workspace/client-core/commands/metadata'
import {
  editorKeyConditionMatches,
  type EditorKeyCondition,
  type EditorKeymapContext,
} from '@singapore-editor/core/keymap'

export function editorBindingConditionsMatch(
  conditions: readonly EditorKeyCondition[] | undefined,
  context: EditorKeymapContext | null,
): boolean {
  if (!conditions?.length) return true
  if (!context) return false
  return conditions.every((condition) => editorKeyConditionMatches(condition, context))
}

export type CommandWhenSnapshot = {
  readonly activeDocumentSavable: boolean
  readonly activeDocument: DocumentRef | null
  readonly activeTabId: TabId | null
  readonly chatMode: boolean
  readonly sessionActionUndoable?: boolean
  readonly sessionActionRedoable?: boolean
  readonly fileOperationRedoable?: boolean
  readonly fileOperationUndoable?: boolean
  readonly workspaceOpen: boolean
  readonly workspaceEditRedoable?: boolean
  readonly workspaceEditUndoable?: boolean
  readonly workspaceMutable?: boolean
}

export type CommandWhenTarget = {
  readonly kind: CommandTargetKind
  readonly writable?: boolean
}

export const commandWhenDisabledReasons = {
  chatMode: 'Chat mode is not active.',
  editorTarget: 'No text editor is active.',
  editorWritable: 'The active editor is read-only.',
  fileBackedTab: 'No file-backed surface is active.',
  fileOperationRedoable: 'No file operation can be redone.',
  fileOperationUndoable: 'No file operation can be undone.',
  saveableTab: 'Nothing here can be saved.',
  sessionActionUndoable: 'No session action can be undone.',
  sessionActionRedoable: 'No session action can be redone.',
  tabOpen: 'No editor tab is open.',
  workspaceOpen: 'No workspace open.',
  workspaceEditRedoable: 'No workspace edit can be redone.',
  workspaceEditUndoable: 'No workspace edit can be undone.',
  workspaceMutable: 'Workspace files are locked by a transaction.',
} as const satisfies Record<CommandWhen, string>

export function commandWhenDisabledReason(
  conditions: readonly CommandWhen[],
  snapshot: CommandWhenSnapshot,
  target: CommandWhenTarget,
): string | null {
  for (const condition of conditions) {
    const reason = conditionDisabledReason(condition, snapshot, target)
    if (reason) return reason
  }

  return null
}

function conditionDisabledReason(
  condition: CommandWhen,
  snapshot: CommandWhenSnapshot,
  target: CommandWhenTarget,
): string | null {
  if (condition === 'chatMode') {
    return snapshot.chatMode ? null : commandWhenDisabledReasons.chatMode
  }
  if (condition === 'editorTarget') {
    return target.kind === 'editor' ? null : commandWhenDisabledReasons.editorTarget
  }
  if (condition === 'editorWritable') {
    return target.kind === 'editor' && target.writable
      ? null
      : commandWhenDisabledReasons.editorWritable
  }
  if (condition === 'fileBackedTab') {
    return filesystemResource(snapshot.activeDocument)
      ? null
      : commandWhenDisabledReasons.fileBackedTab
  }
  if (condition === 'fileOperationRedoable') {
    return snapshot.fileOperationRedoable ? null : commandWhenDisabledReasons.fileOperationRedoable
  }
  if (condition === 'fileOperationUndoable') {
    return snapshot.fileOperationUndoable ? null : commandWhenDisabledReasons.fileOperationUndoable
  }
  if (condition === 'saveableTab') {
    const savable =
      snapshot.activeDocument && saveCapability(snapshot.activeDocument).kind !== 'none'
    return savable && snapshot.activeDocumentSavable ? null : commandWhenDisabledReasons.saveableTab
  }
  if (condition === 'sessionActionRedoable')
    return snapshot.sessionActionRedoable ? null : commandWhenDisabledReasons.sessionActionRedoable
  if (condition === 'sessionActionUndoable') {
    return snapshot.sessionActionUndoable ? null : commandWhenDisabledReasons.sessionActionUndoable
  }
  if (condition === 'tabOpen') {
    return snapshot.activeTabId !== null ? null : commandWhenDisabledReasons.tabOpen
  }
  if (condition === 'workspaceOpen') {
    return snapshot.workspaceOpen ? null : commandWhenDisabledReasons.workspaceOpen
  }
  if (condition === 'workspaceEditRedoable') {
    return snapshot.workspaceEditRedoable ? null : commandWhenDisabledReasons.workspaceEditRedoable
  }
  if (condition === 'workspaceEditUndoable') {
    return snapshot.workspaceEditUndoable ? null : commandWhenDisabledReasons.workspaceEditUndoable
  }
  if (condition === 'workspaceMutable') {
    return snapshot.workspaceMutable ? null : commandWhenDisabledReasons.workspaceMutable
  }

  return unreachableCondition(condition)
}

function unreachableCondition(condition: never): null {
  return condition
}
