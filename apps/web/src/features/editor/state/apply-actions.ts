import {
  documentKey,
  fileDocument,
  fileDocumentKey,
  fileResource,
  filesystemPath,
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import {
  documentTab,
  retainedTabDocuments,
  sameTabContent,
  settingsTab,
  tabContentKey,
  tabDocuments,
} from '@/lib/documents/utils/tabs'
import type {
  DocumentKey,
  DocumentRef,
  FilesystemPath,
  TabContent,
  TabId,
} from '@/lib/documents/utils/types'
import type {
  EditorSnapZone,
  EditorSplitDirection,
  EditorSplitScope,
} from '@/features/workspace/utils/tab-model'
import { type EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  editorHistoryForClosedContent,
  editorHistoryForSelection,
  previousOpenTabContent,
  recentlyClosedTabsForClose,
  recentlyClosedTabsForReopen,
} from '@/features/editor/utils/tab-history'
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
  editorOpenContentsForWorkbenchPanels,
  editorContentCountsForWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
  reorderEditorTabInWorkbenchPanels,
  selectEditorTabInWorkbenchPanels,
  activeEditorTabForWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { type SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { log } from '@/lib/client-logging'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin'
import type {
  FileOpenIntentActivation,
  FileOpenIntentServiceOwner,
} from '@/lib/file-open-intent/state/service'
import {
  updateWorkspaceDocument,
  type WorkspaceDocumentChange,
} from '@/features/editor/utils/workspace-document'

export type EditorApplyActions = {
  clearRootFolder: () => void
  closeTab: (tabId: TabId) => void
  discardAndCloseTab: (tabId: TabId) => { wasDirty: boolean }
  discardLiveEditorDocument: (document: DocumentRef) => { wasDirty: boolean }
  moveTabToPane: (tabId: TabId, paneId: string, targetIndex?: number) => boolean
  moveTabToSplit: (
    tabId: TabId,
    paneId: string,
    zone: Exclude<EditorSnapZone, 'center'>,
    scope?: EditorSplitScope,
  ) => boolean
  openDefinition: (target: LanguageServerDefinitionTarget) => boolean
  openFileSurface: (path: FilesystemPath) => void
  openTabContent: (content: TabContent) => void
  selectContent: (content: TabContent) => void
  openSearchEditor: (rootPath: FilesystemPath) => void
  openSettingsEditor: () => void
  reopenClosedEditor: () => boolean
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
  reorderTab: (paneId: string, tabId: TabId, targetIndex: number) => boolean
  selectFile: (path: FilesystemPath | null) => void
  selectPreviousEditor: () => boolean
  selectTab: (paneId: string, tabId: TabId) => void
  setActivePane: (paneId: string) => void
  splitTab: (tabId: TabId, direction: EditorSplitDirection) => boolean
  /** Parks the open project and restores the target's tabs, history and search results. */
  switchRootFolder: (rootFolder: PickedFsEntry) => void
}

export type EditorActivation = {
  activate(content: TabContent, tabId: TabId): void
  setRoot(rootPath: FilesystemPath | null): void
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
    discardLiveEditorDocument: (document) =>
      discardLiveEditorDocument(document, workspaceStore, documentStore, uiStore, activation),
    moveTabToPane: () => false,
    moveTabToSplit: () => false,
    openDefinition: (target) => openDefinition(target, workspaceStore, uiStore, activation),
    openFileSurface: (path) =>
      openTabContentSurface(
        documentTab(fileDocument(fileResource(path))),
        workspaceStore,
        activation,
      ),
    openTabContent: (content) => openTabContentSurface(content, workspaceStore, activation),
    selectContent: (content) => openTabContentSurface(content, workspaceStore, activation),
    openSearchEditor: (rootPath) =>
      openTabContentSurface(
        documentTab({ kind: 'search', root: workspaceRoot(rootPath) }),
        workspaceStore,
        activation,
      ),
    openSettingsEditor: () => openTabContentSurface(settingsTab(), workspaceStore, activation),
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
  path: FilesystemPath | null,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  if (path === null) return
  openTabContentSurface(documentTab(fileDocument(fileResource(path))), workspaceStore, activation)
}

function openTabContentSurface(
  selectedTabContent: TabContent,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const workbenchPanels = openEditorContentInWorkbenchPanels(
    workspace.workbenchPanels,
    selectedTabContent,
  )
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(
    workspace,
    workbenchPanels,
  )

  logSelectTabTransition({
    nextSelection,
    requestedContent: selectedTabContent,
    workbenchPanels,
    workspace,
  })

  activateWorkbenchSelection(workbenchPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory: editorHistoryForSelection(workspace.editorHistory, selectedTabContent),
  })
}

function logSelectTabTransition({
  nextSelection,
  requestedContent,
  workbenchPanels,
  workspace,
}: {
  nextSelection: ReturnType<typeof editorWorkspaceSelectionForWorkbenchPanelsForState>
  requestedContent: TabContent
  workbenchPanels: WorkbenchPanels
  workspace: EditorWorkspaceStore
}) {
  const existingTab = editorTabForContent(workspace.workbenchPanels, requestedContent)
  const requestedTab = editorTabForContent(workbenchPanels, requestedContent)

  log.info({
    action: 'editor.command.select_file',
    area: 'editor',
    existingTabId: existingTab?.id ?? null,
    nextActiveTabId: workbenchPanels.activeEditorTabId,
    nextOpenTabContents: nextSelection.openTabContents,
    nextSelectedTabContent: nextSelection.selectedTabContent,
    previousActiveTabId: workspace.workbenchPanels.activeEditorTabId,
    previousOpenTabContents: workspace.openTabContents,
    previousSelectedTabContent: workspace.selectedTabContent,
    requestedContent,
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
  openTabContentSurface(
    documentTab(fileDocument(fileResource(filesystemPath(definitionTarget.path)))),
    workspaceStore,
    activation,
  )
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
      editorRetention(
        workspace,
        workspace.workbenchPanels,
        documentSizes,
        byteBudget,
        documentStore.getState().unevictableEditorDocumentKeys(),
      ),
    )

  log.info({
    action: 'workspace.root_switched',
    area: 'workspace',
    byteBudget,
    documentSizeBeforeTrim: totalRetainedSize(documentSizes),
    evictedDocumentCount: evicted.evictedDocumentKeys.length,
    evictedTabCount: evicted.evictedTabIds.length,
    parkedCount: workspace.parkedWorkspaces.size,
    path: rootFolder.path,
    previousPath: previousRootPath,
    restoredTabCount: workspace.workbenchPanels.editorTabs.length,
    // Read after the trim: `documentSizes` is the pre-eviction snapshot.
    retainedDocumentSize: totalRetainedSize(documentStore.getState().editorDocumentSizes()),
  })
}

function totalRetainedSize(documentSizes: ReadonlyMap<DocumentKey, number>) {
  let total = 0
  for (const size of documentSizes.values()) total += size

  return total
}

/**
 * The keep set for both retention triggers: a project switch and a tab close.
 *
 * The active slice is built even when `rootPath` is null, or `clearRootFolder` and
 * rootless surfaces would put every open document outside it. That rootless slice
 * spends one of the `projectLimit` slots.
 */
function editorRetention(
  workspace: EditorWorkspaceStore,
  activePanels: WorkbenchPanels,
  documentSizes: ReadonlyMap<DocumentKey, number>,
  byteBudget: number,
  unevictableDocumentKeys: ReadonlySet<DocumentKey>,
) {
  const activeRootPath = workspace.rootFolder?.path ?? null
  const parked = Array.from(workspace.parkedWorkspaces, ([rootPath, entry]) =>
    retainedSlice(workspaceRoot(rootPath), entry.workbenchPanels, entry.lastActiveAt),
  )

  return retentionForProjects({
    activeRootPath,
    byteBudget,
    documentSizes,
    slices: [...parked, retainedSlice(activeRootPath, activePanels, Date.now())],
    unevictableDocumentKeys,
  })
}

function retainedSlice(
  rootPath: FilesystemPath | null,
  panels: WorkbenchPanels,
  lastActiveAt: number,
): RetainedWorkspaceSlice {
  return {
    documentKeys: editorOpenContentsForWorkbenchPanels(panels)
      .flatMap(retainedTabDocuments)
      .map(documentKey),
    lastActiveAt,
    rootPath,
    tabIds: panels.editorTabs.map((tab) => tab.id),
  }
}

function closeTab(
  tabId: TabId,
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
  const content = tab.content
  const nextPanels = closeEditorTabInWorkbenchPanels(workspace.workbenchPanels, tabId)
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, nextPanels)
  const remainingCount =
    editorContentCountsForWorkbenchPanels(nextPanels).get(tabContentKey(content)) ?? 0
  const result =
    options.discard && remainingCount === 0
      ? tabDocuments(content)
          .map((document) =>
            documentStore.getState().deleteLiveEditorDocument(documentKey(document)),
          )
          .reduce((all, one) => ({ wasDirty: all.wasDirty || one.wasDirty }), { wasDirty: false })
      : { wasDirty: false }

  if (!options.discard || remainingCount > 0) {
    documentStore.getState().removeEditorView(tabId)
    if (remainingCount === 0) {
      const documentSizes = documentStore.getState().editorDocumentSizes()
      const byteBudget = retainedTextBudget()
      const evicted = documentStore
        .getState()
        .retainEditorDocuments(
          editorRetention(
            workspace,
            nextPanels,
            documentSizes,
            byteBudget,
            documentStore.getState().unevictableEditorDocumentKeys(),
          ),
        )
      log.info({
        // Named for retention, not the command: fires only when the closed path
        // had no other tab, so `editor.command.*` would be uncountable.
        action: 'editor.retention.close_tab',
        area: 'editor',
        byteBudget,
        documentSizeBeforeTrim: totalRetainedSize(documentSizes),
        evictedDocumentCount: evicted.evictedDocumentKeys.length,
        evictedTabCount: evicted.evictedTabIds.length,
        parkedCount: workspace.parkedWorkspaces.size,
        path: content,
        retainedDocumentSize: totalRetainedSize(documentStore.getState().editorDocumentSizes()),
      })
    }
  }
  updateUiForClosedContent(content, nextSelection.selectedTabContent, remainingCount, uiStore)
  activateWorkbenchSelection(nextPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory:
      remainingCount === 0
        ? editorHistoryForClosedContent(workspace.editorHistory, content)
        : workspace.editorHistory,
    recentlyClosedTabs: recentlyClosedTabsForClose(workspace.recentlyClosedTabs, content),
  })

  return result
}

function discardLiveEditorDocument(
  document: DocumentRef,
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const result = documentStore.getState().deleteLiveEditorDocument(documentKey(document))
  const slices = updateWorkspaceDocuments(workspace, { kind: 'remove', document })
  const nextPanels = slices.workbenchPanels
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, nextPanels)
  if (document.kind !== 'settings-json')
    updateUiForClosedContent(documentTab(document), nextSelection.selectedTabContent, 0, uiStore)
  activateWorkbenchSelection(nextPanels, activation)
  workspaceStore.setState({ ...slices, ...nextSelection })
  return { wasDirty: result.wasDirty }
}

function reopenClosedEditor(workspaceStore: EditorWorkspaceStoreApi, activation: EditorActivation) {
  const workspace = workspaceStore.getState()
  const content = workspace.recentlyClosedTabs[0]
  if (!content) return false

  openTabContentSurface(content, workspaceStore, activation)
  workspaceStore.setState((state) => ({
    recentlyClosedTabs: recentlyClosedTabsForReopen(state.recentlyClosedTabs, content),
  }))
  return true
}

function selectPreviousEditor(
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const content = previousOpenTabContent(
    workspace.editorHistory,
    workspace.openTabContents,
    workspace.selectedTabContent,
  )
  if (!content) return false

  openTabContentSurface(content, workspaceStore, activation)
  return true
}

function renameLiveEditorDocument(
  from: FilesystemPath,
  to: FilesystemPath,
  workspaceStore: EditorWorkspaceStoreApi,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  const result = documentStore.getState().renameLiveEditorDocumentPath(from, to)
  const slices = updateWorkspaceDocuments(workspace, { kind: 'rename', from, to })
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

function reorderTab(tabId: TabId, targetIndex: number, workspaceStore: EditorWorkspaceStoreApi) {
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
  tabId: TabId,
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
  const selectedTabContent = nextSelection.selectedTabContent

  activateWorkbenchSelection(workbenchPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory: editorHistoryForSelection(workspace.editorHistory, selectedTabContent),
  })
}

function editorWorkspaceSelectionForWorkbenchPanelsForState(
  workspace: EditorWorkspaceStore,
  workbenchPanels: WorkbenchPanels,
) {
  return editorWorkspaceSelectionForWorkbenchPanels(workbenchPanels, {
    currentOpenTabContents: workspace.openTabContents,
  })
}

function editorTabForId(panels: WorkbenchPanels, tabId: TabId) {
  return panels.editorTabs.find((tab) => tab.id === tabId) ?? null
}

function editorTabForContent(panels: WorkbenchPanels, content: TabContent) {
  return panels.editorTabs.find((tab) => sameTabContent(tab.content, content)) ?? null
}

export function createEditorActivation(
  fileOpenIntent: FileOpenIntentActivation,
  documentStore: EditorDocumentStoreApi,
  rootOwner: Pick<FileOpenIntentServiceOwner, 'setRoot'>,
): EditorActivation {
  return {
    activate: (content, tabId) => {
      if (content.kind !== 'document' || content.document.kind !== 'file') return
      const filePath = content.document.resource.path

      const liveClaim = fileOpenIntent.claimLive(filePath)
      if (liveClaim) {
        documentStore
          .getState()
          .ensureEditorViewForDocument(tabId, liveClaim.documentKey, liveClaim)
        return
      }
      const cleanClaim = fileOpenIntent.claimReadyClean(filePath)
      if (cleanClaim) {
        documentStore.getState().ensureEditorView(tabId, cleanClaim.file, cleanClaim)
        return
      }

      const liveDocument = documentStore.getState().getLiveEditorDocument(fileDocumentKey(filePath))
      if (liveDocument) {
        documentStore.getState().ensureEditorViewForDocument(tabId, liveDocument.key)
      }
    },
    setRoot: (rootPath) => rootOwner.setRoot(rootPath),
  }
}

function activateWorkbenchSelection(panels: WorkbenchPanels, activation: EditorActivation): void {
  const tab = activeEditorTabForWorkbenchPanels(panels)
  if (!tab) return

  activation.activate(tab.content, tab.id)
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

function updateUiForClosedContent(
  content: TabContent,
  selected: TabContent | null,
  remainingCount: number,
  uiStore: EditorUiStoreApi,
) {
  if (remainingCount === 0 && content.kind === 'document' && content.document.kind === 'file') {
    uiStore.getState().clearDefinitionTargetForPath(content.document.resource.path)
  }
  if (selected !== null && sameTabContent(content, selected)) return
  uiStore.getState().clearStatusBarSource()
}
