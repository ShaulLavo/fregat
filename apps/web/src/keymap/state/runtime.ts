import {
  createFocusRequestToken,
  type FocusTransitionOutcome,
} from '@workspace/client-core/commands/focus'
import type { CommandTargetKind } from '@workspace/client-core/commands/metadata'
import type { WorkspaceEditHistoryResult } from '@workspace/contracts'
import { fileSystemKeys } from '@/lib/query-keys'
import { isSavableEditorDocument } from '@/features/editor/utils/save'
import { sessionUndoAvailable, sessionRedoAvailable } from '@/features/chat-mode/state/session-undo'
import { settingsSelection } from '@/features/settings/state/selection'
import { documentKey } from '@/lib/documents/utils/identity'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { activeTabDocument, sameTabContent } from '@/lib/documents/utils/tabs'
import {
  activeEditorContentForWorkbenchPanels,
  activeEditorTabForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type {
  PlatformCommandTarget,
  WorkspaceCommandHandlerContext,
  WorkspaceCommandRuntime,
  WorkspaceCommandSnapshot,
} from '@/keymap/define-command'
import { editorCommandIdFromPlatform } from '@/keymap/editor-keymap'
import { notifyUndoBarrier } from '@/keymap/state/undo-barrier'
import type {
  CommandDefinition,
  CommandInvocation,
  EditorCommandDefinition,
} from '@/keymap/state/command-bus'
import { platformCommand } from '@/keymap/table'
import type { PlatformCommandId } from '@/keymap/types'
import type {
  FocusPathSource,
  FocusService,
  FocusTargetSnapshot,
  FocusTargetToken,
} from '@/lib/focus/state/service'
import { focusTargetById } from '@/lib/focus/state/service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'

export type PlatformCommandDefinition = CommandDefinition<
  PlatformCommandId,
  WorkspaceCommandRuntime,
  WorkspaceCommandSnapshot,
  PlatformCommandTarget,
  CommandInvocation
>

export function captureCommandSnapshot(runtime: WorkspaceCommandRuntime): WorkspaceCommandSnapshot {
  const state = runtime.workspace.getState()
  const settings = runtime.settings.readSnapshot()
  const workspaceEdit = runtime.workspaceEdits.getSnapshot()
  const activeTabContent = activeEditorContentForWorkbenchPanels(state.workbenchPanels)
  const activeDocument = activeTabContent
    ? activeTabDocument(activeTabContent, settingsSelection())
    : null
  const liveDocument = activeDocument
    ? runtime.documents.store.getState().getLiveEditorDocument(documentKey(activeDocument))
    : null
  const workspaceMutable = runtime.workspaceEdits.canMutateWorkspace()
  const fileHistory = state.rootFolder
    ? runtime.documents.queryClient.getQueryData<WorkspaceEditHistoryResult>(
        fileSystemKeys.fileOperationHistory(state.rootFolder.path),
      )
    : undefined
  return {
    activeDocumentSavable: liveDocument ? isSavableEditorDocument(liveDocument) : false,
    activeTabContent,
    activeDocument,
    activeTabId: activeEditorTabForWorkbenchPanels(state.workbenchPanels)?.id ?? null,
    chatMode: state.uiMode === 'chat',
    chatModePanels: state.chatModePanels,
    diffViewMode: settings.diffViewMode,
    // Until the history has loaded the handler decides; it always reads the server's list first.
    fileOperationRedoable: workspaceMutable && (fileHistory?.redo.length ?? 1) > 0,
    fileOperationUndoable: workspaceMutable && (fileHistory?.undo.length ?? 1) > 0,
    rootPath: state.rootFolder?.path ?? null,
    sessionActionUndoable: sessionUndoAvailable(),
    sessionActionRedoable: sessionRedoAvailable(),
    uiMode: state.uiMode,
    wallpaperEnabled: settings.wallpaperEnabled,
    workbenchPanels: state.workbenchPanels,
    workspaceOpen: state.rootFolder !== null,
    workspaceEditRedoable: workspaceEdit.canRedo,
    workspaceEditUndoable: workspaceEdit.canUndo,
    workspaceMutable,
  }
}

export function lookupPlatformCommand(id: PlatformCommandId): PlatformCommandDefinition | null {
  return platformCommand(id) as PlatformCommandDefinition | null
}

export function resolveCommandTarget(
  runtime: WorkspaceCommandRuntime,
  targetKind: CommandTargetKind,
  invocation: CommandInvocation,
  snapshot: WorkspaceCommandSnapshot,
): PlatformCommandTarget | null {
  if (targetKind === 'workspace') return { kind: 'workspace', logIdentity: 'workspace' }
  if (targetKind !== 'editor') {
    const action = targetKind === 'diagnostic' ? 'fixDiagnostic' : 'toggleCheckpointChange'
    const target = runtime.focus.resolveTarget({
      compatible: (candidate) => Boolean(candidate.capabilities[action]),
      origin: (invocation.origin as FocusTargetToken | null | undefined) ?? null,
      path: (invocation.event as FocusPathSource | null | undefined) ?? null,
    })
    const execute = target?.capabilities[action]
    return execute && target
      ? { kind: targetKind, execute, token: target.token, logIdentity: targetKind }
      : null
  }

  const focusTarget = runtime.focus.resolveTarget({
    compatible: editorTarget,
    exact: (target) => exactActiveEditor(target, snapshot),
    origin: (invocation.origin as FocusTargetToken | null | undefined) ?? null,
    path: (invocation.event as FocusPathSource | null | undefined) ?? null,
  })
  const capability = focusTarget?.capabilities.editor
  if (!focusTarget || !capability) return null

  return {
    keymapContext: capability.readKeymapContext?.() ?? null,
    inputElement: capability.getInputElement?.() ?? null,
    focusTarget,
    kind: 'editor',
    logIdentity: editorLogIdentity(focusTarget.id),
    token: focusTarget.token,
    writable: capability.writable,
  }
}

export function dispatchEditor(
  entry: EditorCommandDefinition<PlatformCommandId>,
  context: WorkspaceCommandHandlerContext,
) {
  if (context.target.kind !== 'editor') return false

  const editorId = editorCommandIdFromPlatform(entry.id)
  if (!editorId) return false

  const capability = context.target.focusTarget.capabilities.editor
  if (!capability) return false

  if (editorId === 'undo') notifyUndoBarrier(context.runtime, context.target.focusTarget.id)
  return capability.dispatch(editorId, {
    event: context.invocation.event as KeyboardEvent | undefined,
  })
}

export function openWorkspaceSettings(
  focus: FocusService,
  workspace: WorkspaceCommandRuntime['workspace'],
  editor: WorkspaceCommandRuntime['editor'],
  category?: string | null,
) {
  return {
    token: createFocusRequestToken(),
    completion: editor
      .openSettingsEditor(category)
      .then((result): FocusTransitionOutcome | Promise<FocusTransitionOutcome> => {
        if (result.status !== 'applied')
          return { status: 'rejected', reason: 'destination-invalid' }
        return focusOpenedSettings(focus, workspace).completion
      }),
  }
}

function focusOpenedSettings(focus: FocusService, workspace: WorkspaceCommandRuntime['workspace']) {
  if (workspace.getState().rootFolder === null)
    return focus.request(focusTargetById({ kind: 'settings-dialog' }))
  const activeTab = activeEditorTabForWorkbenchPanels(workspace.getState().workbenchPanels)
  if (!activeTab) {
    return focus.request({ isValid: () => false, kind: 'match', matches: () => false })
  }

  const layout = workspace.getState().uiMode
  const identity = { diffPath: null, layout, searchRoot: null, tabId: activeTab.id } as const
  return focus.request({
    isValid: () => activeSettingsSurfaceIsValid(workspace, activeTab, layout),
    kind: 'match',
    matches: (target) => matchesActiveSurface(target, identity),
  })
}

function editorTarget(target: FocusTargetSnapshot) {
  return target.id.kind === 'editor' && target.capabilities.editor !== undefined
}

function exactActiveEditor(target: FocusTargetSnapshot, snapshot: WorkspaceCommandSnapshot) {
  if (target.id.kind !== 'editor') return false
  if (target.layout !== snapshot.uiMode) return false
  if (target.id.side === 'old') return false
  if (snapshot.activeTabId && target.id.tabId === snapshot.activeTabId) return true
  if (target.id.tabId !== undefined) return false
  if (target.id.surface !== 'diff') return false

  const document = snapshot.activeDocument
  const diffPath =
    document?.kind === 'compare-saved' || document?.kind === 'git-diff'
      ? documentSourcePath(document)
      : null
  if (!diffPath) return false

  return target.id.key === diffPath
}

function editorLogIdentity(id: FocusTargetSnapshot['id']) {
  if (id.kind !== 'editor') return 'editor'

  return ['editor', id.surface, id.side].filter(Boolean).join(':')
}

function activeSettingsSurfaceIsValid(
  workspace: WorkspaceCommandRuntime['workspace'],
  activeTab: NonNullable<ReturnType<typeof activeEditorTabForWorkbenchPanels>>,
  layout: WorkspaceCommandSnapshot['uiMode'],
) {
  const state = workspace.getState()
  const current = activeEditorTabForWorkbenchPanels(state.workbenchPanels)
  return (
    state.uiMode === layout &&
    current?.id === activeTab.id &&
    sameTabContent(current.content, activeTab.content)
  )
}
