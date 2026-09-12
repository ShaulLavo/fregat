import type {
  EditorSnapZone,
  EditorSplitDirection,
  EditorSplitScope,
} from '@/features/workspace/utils/tab-model'
import { type EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  editorHistoryForClosedPath,
  editorHistoryForSelection,
  previousOpenEditorPath,
  recentlyClosedEditorPathsForClose,
  recentlyClosedEditorPathsForReopen,
} from '@/features/editor/state/tab-paths'
import { type EditorUiStoreApi } from '@/features/editor/state/ui-state'
import {
  retentionForProjects,
  type RetainedWorkspaceSlice,
} from '@/features/editor/utils/document-retention'
import {
  editorWorkspaceSelectionForWorkbenchPanels,
  type EditorWorkspaceStore,
  type EditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  closeEditorTabInWorkbenchPanels,
  editorOpenPathsForWorkbenchPanels,
  editorPathCountsForWorkbenchPanels,
  openEditorPathInWorkbenchPanels,
  reorderEditorTabInWorkbenchPanels,
  selectEditorTabInWorkbenchPanels,
  activeEditorTabForWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import { type SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { log } from '@/lib/client-logging'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { LanguageServerDefinitionTarget } from '@singapor/lsp-plugin'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { editorTabDocumentIds } from '@/features/workspace/utils/tab-dirty'
import type {
  FileOpenIntentActivation,
  FileOpenIntentServiceOwner,
} from '@/lib/file-open-intent/state/service'
import { fileBackedDocumentPath } from '@/features/editor/utils/file-backed-document'
import {
  updateWorkspaceDocument,
  type WorkspaceDocumentChange,
} from '@/features/editor/utils/workspace-document'

export type EditorApplyActions = {
  clearRootFolder: () => void
  closeTab: (tabId: string) => void
  discardAndCloseTab: (tabId: string) => { wasDirty: boolean }
  discardLiveEditorDocument: (path: string) => { wasDirty: boolean }
  moveTabToPane: (tabId: string, paneId: string, targetIndex?: number) => boolean
  moveTabToSplit: (
    tabId: string,
    paneId: string,
    zone: Exclude<EditorSnapZone, 'center'>,
    scope?: EditorSplitScope,
  ) => boolean
  openDefinition: (target: LanguageServerDefinitionTarget) => boolean
  openFileSurface: (path: string) => void
  openSearchEditor: (rootPath: string) => void
  openSettingsEditor: () => void
  reopenClosedEditor: () => boolean
  renameLiveEditorDocument: (from: string, to: string) => { wasDirty: boolean }
  reorderTab: (paneId: string, tabId: string, targetIndex: number) => boolean
  selectFile: (path: string | null) => void
  selectPreviousEditor: () => boolean
  selectTab: (paneId: string, tabId: string) => void
  setActivePane: (paneId: string) => void
  splitTab: (tabId: string, direction: EditorSplitDirection) => boolean
  /** Parks the open project and restores the target's tabs, history and search results. */
  switchRootFolder: (rootFolder: PickedFsEntry) => void
}

export type EditorActivation = {
  activate(path: string, tabId: string): void
  setRoot(rootPath: string | null): void
}

export function createEditorApplyActions({
  activation,
  documentStore,
  retainedTextBudget,
  searchStore,
  uiStore,
  workspaceStore,
}: {
  activation: EditorActivation
  documentStore: EditorDocumentStoreApi
  /** Injected so this module stays off `features/settings` and a test can pin it. */
  retainedTextBudget: () => number
  searchStore: SearchBufferStoreApi
  uiStore: EditorUiStoreApi
  workspaceStore: EditorWorkspaceStoreApi
}): EditorApplyActions {
  return {
    clearRootFolder: () => {
      uiStore.getState().resetEditorUiState()
      activation.setRoot(null)
      workspaceStore.getState().clearRootFolder()
      searchStore.getState().switchWorkspace(null)
    },
    closeTab: (tabId) =>
      closeTab(tabId, workspaceStore, documentStore, uiStore, activation, retainedTextBudget),
    discardAndCloseTab: (tabId) =>
      closeTab(tabId, workspaceStore, documentStore, uiStore, activation, retainedTextBudget, {
        discard: true,
      }),
    discardLiveEditorDocument: (path) =>
      discardLiveEditorDocument(path, workspaceStore, documentStore, uiStore, activation),
    moveTabToPane: () => false,
    moveTabToSplit: () => false,
    openDefinition: (target) => openDefinition(target, workspaceStore, uiStore, activation),
    openFileSurface: (path) => openEditorPathSurface(path, workspaceStore, activation),
    openSearchEditor: (rootPath) =>
      openEditorPathSurface(searchBufferDocumentId(rootPath), workspaceStore, activation),
    // Dedupes by path like every other editor surface, so the settings tab is a
    // singleton without any bookkeeping of its own.
    openSettingsEditor: () =>
      openEditorPathSurface(settingsDocumentId(), workspaceStore, activation),
    reopenClosedEditor: () => reopenClosedEditor(workspaceStore, activation),
    renameLiveEditorDocument: (from, to) =>
      renameLiveEditorDocument(from, to, workspaceStore, documentStore, uiStore, activation),
    reorderTab: (_paneId, tabId, targetIndex) => reorderTab(tabId, targetIndex, workspaceStore),
    selectFile: (path) => selectFile(path, workspaceStore, activation),
    selectPreviousEditor: () => selectPreviousEditor(workspaceStore, activation),
    selectTab: (_paneId, tabId) => selectTab(tabId, workspaceStore, activation),
    setActivePane: () => undefined,
    splitTab: () => false,
    switchRootFolder: (rootFolder) =>
      switchRootFolder(rootFolder, {
        activation,
        documentStore,
        retainedTextBudget,
        searchStore,
        uiStore,
        workspaceStore,
      }),
  }
}

function selectFile(
  selectedFilePath: string | null,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  if (!selectedFilePath) return

  openEditorPathSurface(selectedFilePath, workspaceStore, activation)
}

// Selects an existing tab or opens a new one for this document path.
function openEditorPathSurface(
  selectedFilePath: string,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const workbenchPanels = openEditorPathInWorkbenchPanels(
    workspace.workbenchPanels,
    selectedFilePath,
  )
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(
    workspace,
    workbenchPanels,
  )

  logSelectFileTransition({
    nextSelection,
    requestedPath: selectedFilePath,
    workbenchPanels,
    workspace,
  })

  activateWorkbenchSelection(workbenchPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory: editorHistoryForSelection(workspace.editorHistory, selectedFilePath),
  })
}

function logSelectFileTransition({
  nextSelection,
  requestedPath,
  workbenchPanels,
  workspace,
}: {
  nextSelection: ReturnType<typeof editorWorkspaceSelectionForWorkbenchPanelsForState>
  requestedPath: string
  workbenchPanels: WorkbenchPanels
  workspace: EditorWorkspaceStore
}) {
  const existingTab = editorTabForPath(workspace.workbenchPanels, requestedPath)
  const requestedTab = editorTabForPath(workbenchPanels, requestedPath)

  log.info({
    action: 'editor.command.select_file',
    area: 'editor',
    existingTabId: existingTab?.id ?? null,
    nextActiveTabId: workbenchPanels.activeEditorTabId,
    nextOpenFilePaths: nextSelection.openFilePaths,
    nextSelectedFilePath: nextSelection.selectedFilePath,
    previousActiveTabId: workspace.workbenchPanels.activeEditorTabId,
    previousOpenFilePaths: workspace.openFilePaths,
    previousSelectedFilePath: workspace.selectedFilePath,
    requestedPath,
    requestedTabActive: requestedTab?.id === workbenchPanels.activeEditorTabId,
    requestedTabId: requestedTab?.id ?? null,
  })
}

function openDefinition(
  definitionTarget: LanguageServerDefinitionTarget,
  workspaceStore: EditorWorkspaceStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
) {
  openEditorPathSurface(definitionTarget.path, workspaceStore, activation)
  uiStore.setState({
    definitionTarget,
    statusBarSource: null,
  })

  return true
}

// Park each workspace before switching so unsaved documents and search buffers remain owned.
function switchRootFolder(
  rootFolder: PickedFsEntry,
  {
    activation,
    documentStore,
    retainedTextBudget,
    searchStore,
    uiStore,
    workspaceStore,
  }: {
    activation: EditorActivation
    documentStore: EditorDocumentStoreApi
    retainedTextBudget: () => number
    searchStore: SearchBufferStoreApi
    uiStore: EditorUiStoreApi
    workspaceStore: EditorWorkspaceStoreApi
  },
) {
  const previousRootPath = workspaceStore.getState().rootFolder?.path ?? null
  if (previousRootPath === rootFolder.path) return

  uiStore.getState().resetEditorUiState()
  activation.setRoot(rootFolder.path)
  activateRestoredWorkspace(rootFolder.path, workspaceStore.getState(), activation)
  workspaceStore.getState().switchWorkspace(rootFolder)
  searchStore.getState().switchWorkspace(rootFolder.path)
  const workspace = workspaceStore.getState()
  const documentSizes = documentStore.getState().editorDocumentSizes()
  const byteBudget = retainedTextBudget()
  const evicted = documentStore
    .getState()
    .retainEditorDocuments(
      editorRetention(workspace, workspace.workbenchPanels, documentSizes, byteBudget),
    )

  log.info({
    action: 'workspace.root_switched',
    area: 'workspace',
    byteBudget,
    documentSizeBeforeTrim: totalRetainedSize(documentSizes),
    evictedDocumentCount: evicted.evictedDocumentIds.length,
    evictedTabCount: evicted.evictedTabIds.length,
    parkedCount: workspace.parkedWorkspaces.size,
    path: rootFolder.path,
    previousPath: previousRootPath,
    restoredTabCount: workspace.workbenchPanels.editorTabs.length,
    // Read after the trim. `documentSizes` is the pre-eviction snapshot, so
    // summing it here reported everything just evicted as still retained —
    // worst exactly when the trim was biggest, and unusable next to `byteBudget`.
    retainedDocumentSize: totalRetainedSize(documentStore.getState().editorDocumentSizes()),
  })
}

function totalRetainedSize(documentSizes: ReadonlyMap<string, number>) {
  let total = 0
  for (const size of documentSizes.values()) total += size

  return total
}

/**
 * The keep set for both retention triggers: a project switch and a tab close.
 *
 * The active slice is built even when `rootPath` is null, or `clearRootFolder` and
 * rootless surfaces like the settings editor would put every open document outside
 * the keep set. That rootless slice does spend one of the `projectLimit` slots.
 */
function editorRetention(
  workspace: EditorWorkspaceStore,
  activePanels: WorkbenchPanels,
  documentSizes: ReadonlyMap<string, number>,
  byteBudget: number,
) {
  const activeRootPath = workspace.rootFolder?.path ?? null
  const parked = Array.from(workspace.parkedWorkspaces, ([rootPath, entry]) =>
    retainedSlice(rootPath, entry.workbenchPanels, entry.lastActiveAt),
  )

  return retentionForProjects({
    activeRootPath,
    byteBudget,
    documentSizes,
    slices: [...parked, retainedSlice(activeRootPath, activePanels, Date.now())],
  })
}

function retainedSlice(
  rootPath: string | null,
  panels: WorkbenchPanels,
  lastActiveAt: number,
): RetainedWorkspaceSlice {
  return {
    documentIds: editorOpenPathsForWorkbenchPanels(panels),
    lastActiveAt,
    rootPath,
    tabIds: panels.editorTabs.map((tab) => tab.id),
  }
}

function closeTab(
  tabId: string,
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
  retainedTextBudget: () => number,
  options: { discard?: boolean } = {},
) {
  const workspace = workspaceStore.getState()
  const tab = editorTabForId(workspace.workbenchPanels, tabId)
  if (!tab) return { wasDirty: false }

  const path = tab.path
  const nextPanels = closeEditorTabInWorkbenchPanels(workspace.workbenchPanels, tabId)
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, nextPanels)
  const remainingCount = editorPathCountsForWorkbenchPanels(nextPanels).get(path) ?? 0
  // Every document behind the tab: discarding the settings tab has to drop both
  // scope buffers, and deleting its own path drops nothing at all — which left
  // the edits and the beforeunload warning behind after the user chose Discard.
  const result =
    options.discard && remainingCount === 0
      ? editorTabDocumentIds(path)
          .map((id) => documentStore.getState().deleteLiveEditorDocument(id))
          .reduce((all, one) => ({ wasDirty: all.wasDirty || one.wasDirty }), { wasDirty: false })
      : { wasDirty: false }

  if (!options.discard || remainingCount > 0) {
    documentStore.getState().removeEditorView(tabId)
    if (remainingCount === 0) {
      // One eviction policy in the codebase: keep everything the remaining tabs
      // still reference, and let retain() decide what that leaves behind. The keep
      // set spans every project, not just this one — building it from the closing
      // workspace's panels alone is what evicted parked projects' documents.
      const documentSizes = documentStore.getState().editorDocumentSizes()
      const byteBudget = retainedTextBudget()
      const evicted = documentStore
        .getState()
        .retainEditorDocuments(editorRetention(workspace, nextPanels, documentSizes, byteBudget))
      log.info({
        // Named for retention, not for the command: this fires only when the
        // closed path had no other tab, so an `editor.command.*` name would be
        // uncountable against actual closes.
        action: 'editor.retention.close_tab',
        area: 'editor',
        byteBudget,
        documentSizeBeforeTrim: totalRetainedSize(documentSizes),
        evictedDocumentCount: evicted.evictedDocumentIds.length,
        evictedTabCount: evicted.evictedTabIds.length,
        parkedCount: workspace.parkedWorkspaces.size,
        path,
        retainedDocumentSize: totalRetainedSize(documentStore.getState().editorDocumentSizes()),
      })
    }
  }

  const selectedFilePath = nextSelection.selectedFilePath
  updateUiForClosedPath(path, selectedFilePath, remainingCount, uiStore)
  activateWorkbenchSelection(nextPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory:
      remainingCount === 0
        ? editorHistoryForClosedPath(workspace.editorHistory, path)
        : workspace.editorHistory,
    recentlyClosedEditorPaths: recentlyClosedEditorPathsForClose(
      workspace.recentlyClosedEditorPaths,
      path,
    ),
  })

  return result
}

function discardLiveEditorDocument(
  path: string,
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const result = documentStore.getState().deleteLiveEditorDocument(path)
  const slices = updateWorkspaceDocuments(workspace, { path, replacement: null })
  const nextPanels = slices.workbenchPanels
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, nextPanels)
  const selectedFilePath = nextSelection.selectedFilePath

  updateUiForClosedPath(path, selectedFilePath, 0, uiStore)
  activateWorkbenchSelection(nextPanels, activation)
  workspaceStore.setState({
    ...slices,
    ...nextSelection,
  })

  return { wasDirty: result.wasDirty }
}

function reopenClosedEditor(workspaceStore: EditorWorkspaceStoreApi, activation: EditorActivation) {
  const workspace = workspaceStore.getState()
  const path = workspace.recentlyClosedEditorPaths[0]
  if (!path) return false

  selectFile(path, workspaceStore, activation)
  workspaceStore.setState((state) => ({
    recentlyClosedEditorPaths: recentlyClosedEditorPathsForReopen(
      state.recentlyClosedEditorPaths,
      path,
    ),
  }))
  return true
}

function selectPreviousEditor(
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const path = previousOpenEditorPath(
    workspace.editorHistory,
    workspace.openFilePaths,
    workspace.selectedFilePath,
  )
  if (!path) return false

  selectFile(path, workspaceStore, activation)
  return true
}

function renameLiveEditorDocument(
  from: string,
  to: string,
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const result = documentStore.getState().renameLiveEditorDocumentPath(from, to)
  const slices = updateWorkspaceDocuments(workspace, { path: from, replacement: to })
  const workbenchPanels = slices.workbenchPanels
  activateWorkbenchSelection(workbenchPanels, activation)
  workspaceStore.setState({
    ...slices,
    ...editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, workbenchPanels),
  })
  uiStore.getState().renameDefinitionTargetPath(from, to)
  uiStore.getState().renameLanguageServerReferencesPath(from, to)

  return result
}

function updateWorkspaceDocuments(
  workspace: EditorWorkspaceStore,
  change: WorkspaceDocumentChange,
) {
  const parkedWorkspaces = new Map(workspace.parkedWorkspaces)
  for (const [root, slice] of parkedWorkspaces) {
    const next = updateWorkspaceDocument(slice, change)
    if (next === slice) continue
    parkedWorkspaces.set(root, { ...slice, ...next })
  }
  return { ...updateWorkspaceDocument(workspace, change), parkedWorkspaces }
}

function reorderTab(tabId: string, targetIndex: number, workspaceStore: EditorWorkspaceStoreApi) {
  const workspace = workspaceStore.getState()
  const workbenchPanels = reorderEditorTabInWorkbenchPanels(
    workspace.workbenchPanels,
    tabId,
    targetIndex,
  )
  if (workbenchPanels === workspace.workbenchPanels) return false

  workspaceStore.setState(
    editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, workbenchPanels),
  )
  return true
}

function selectTab(
  tabId: string,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const workbenchPanels = selectEditorTabInWorkbenchPanels(workspace.workbenchPanels, tabId)
  if (workbenchPanels === workspace.workbenchPanels) return

  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(
    workspace,
    workbenchPanels,
  )
  const selectedFilePath = nextSelection.selectedFilePath

  activateWorkbenchSelection(workbenchPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory: editorHistoryForSelection(workspace.editorHistory, selectedFilePath),
  })
}

function editorWorkspaceSelectionForWorkbenchPanelsForState(
  workspace: EditorWorkspaceStore,
  workbenchPanels: WorkbenchPanels,
) {
  return editorWorkspaceSelectionForWorkbenchPanels(workbenchPanels, {
    currentOpenFilePaths: workspace.openFilePaths,
  })
}

function editorTabForId(panels: WorkbenchPanels, tabId: string) {
  return panels.editorTabs.find((tab) => tab.id === tabId) ?? null
}

function editorTabForPath(panels: WorkbenchPanels, path: string) {
  return panels.editorTabs.find((tab) => tab.path === path) ?? null
}

export function createEditorActivation(
  fileOpenIntent: FileOpenIntentActivation,
  documentStore: EditorDocumentStoreApi,
  rootOwner: Pick<FileOpenIntentServiceOwner, 'setRoot'>,
): EditorActivation {
  return {
    activate: (path, tabId) => {
      const filePath = fileBackedDocumentPath(path)
      if (!filePath) return

      const liveClaim = fileOpenIntent.claimLive(filePath)
      if (liveClaim) {
        documentStore.getState().ensureEditorViewForDocument(tabId, liveClaim.documentId, liveClaim)
        return
      }
      const cleanClaim = fileOpenIntent.claimReadyClean(filePath)
      if (cleanClaim) {
        documentStore.getState().ensureEditorView(tabId, cleanClaim.file, cleanClaim)
        return
      }

      const liveDocument = documentStore.getState().getLiveEditorDocument(filePath)
      if (liveDocument) {
        documentStore.getState().ensureEditorViewForDocument(tabId, liveDocument.id)
      }
    },
    setRoot: (rootPath) => rootOwner.setRoot(rootPath),
  }
}

function activateWorkbenchSelection(panels: WorkbenchPanels, activation: EditorActivation): void {
  const tab = activeEditorTabForWorkbenchPanels(panels)
  if (!tab) return

  activation.activate(tab.path, tab.id)
}

function activateRestoredWorkspace(
  rootPath: string,
  workspace: EditorWorkspaceStore,
  activation: EditorActivation,
): void {
  const restored = workspace.parkedWorkspaces.get(rootPath)
  if (!restored) return

  activateWorkbenchSelection(restored.workbenchPanels, activation)
}

function updateUiForClosedPath(
  path: string,
  selectedFilePath: string | null,
  remainingPathCount: number,
  uiStore: EditorUiStoreApi,
) {
  if (remainingPathCount === 0) {
    uiStore.getState().clearDefinitionTargetForPath(path)
  }
  if (path === selectedFilePath) return

  uiStore.getState().clearStatusBarSource()
}
