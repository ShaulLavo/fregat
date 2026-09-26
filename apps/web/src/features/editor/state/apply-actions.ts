import { isDirtyLiveEditorDocument } from '@/features/editor/utils/save'
import { captureEditorScrollPositions } from '@/features/editor/state/scroll-persistence'
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
import type { GroupId } from '@/lib/documents/utils/group-types'
import { groupForTab, selectEditorGroupTab } from '@/lib/documents/utils/groups'
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
  editorTabRecordsForWorkbenchPanels,
  activeEditorTabForWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { type SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { log } from '@/lib/client-logging'
import { createWideEventScope } from '@/lib/wide-event-scope'
import {
  beginPressPaint,
  notePressPrefetch,
  type PressPrefetch,
} from '@/lib/intent-prefetch/state/press-paint'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
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
  openDefinition: (target: LanguageServerDefinitionTarget) => boolean
  openFileSurface: (path: FilesystemPath) => void
  openTabContent: (content: TabContent) => void
  selectContent: (content: TabContent) => void
  openSearchEditor: (rootPath: FilesystemPath) => void
  openSettingsEditor: () => void
  reopenClosedEditor: () => boolean
  renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => { wasDirty: boolean }
  selectFile: (path: FilesystemPath | null) => void
  selectPreviousEditor: () => boolean
  selectTab: (selection: { groupId: GroupId; tabId: TabId }) => void
  /** Parks the open project and restores the target's tabs, history and search results. */
  switchRootFolder: (rootFolder: PickedFsEntry) => void
}

export type EditorActivation = {
  /** What an intent had ready for a file; null for content that is not a file. */
  activate(content: TabContent, tabId: TabId): PressPrefetch | null
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
      captureEditorScrollPositions(workspaceStore, documentStore)
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
    selectFile: (path) => selectFile(path, workspaceStore, activation),
    selectPreviousEditor: () => selectPreviousEditor(workspaceStore, activation),
    selectTab: ({ groupId, tabId }) => selectTab(groupId, tabId, workspaceStore, activation),
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

  const press = beginSelectFilePress({
    nextSelection,
    requestedContent: selectedTabContent,
    workbenchPanels,
    workspace,
  })

  const prefetch = activateWorkbenchSelection(workbenchPanels, activation)
  if (press && prefetch) notePressPrefetch('files', press, prefetch)
  workspaceStore.setState({
    ...nextSelection,
    editorHistory: editorHistoryForSelection(workspace.editorHistory, selectedTabContent),
  })
}

/** Opens the `select_file` event; it ends when the file paints colour (see `press-paint`). */
function beginSelectFilePress({
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
  const previousActiveTabId = activeEditorTabForWorkbenchPanels(workspace.workbenchPanels)?.id

  const scope = createWideEventScope({
    action: 'editor.command.select_file',
    area: 'editor',
    existingTabId: existingTab?.id ?? null,
    nextActiveTabId: activeEditorTabForWorkbenchPanels(workbenchPanels)?.id ?? null,
    nextOpenTabContents: nextSelection.openTabContents,
    nextSelectedTabContent: nextSelection.selectedTabContent,
    previousActiveTabId: previousActiveTabId ?? null,
    previousOpenTabContents: workspace.openTabContents,
    previousSelectedTabContent: workspace.selectedTabContent,
    requestedContent,
    requestedTabActive: requestedTab?.id === activeEditorTabForWorkbenchPanels(workbenchPanels)?.id,
    requestedTabId: requestedTab?.id ?? null,
  })
  const target = filePathForContent(requestedContent)
  if (target === null || (existingTab && existingTab.id === previousActiveTabId)) {
    scope.end()
    return null
  }
  beginPressPaint('files', target, scope)
  return target
}

export function filePathForContent(content: TabContent): FilesystemPath | null {
  if (content.kind !== 'document' || content.document.kind !== 'file') return null
  return content.document.resource.path
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
  const tab = activeEditorTabForWorkbenchPanels(workspaceStore.getState().workbenchPanels)
  if (!tab) return false
  uiStore.setState({
    definitionTarget: { tabId: tab.id, target: definitionTarget },
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
  captureEditorScrollPositions(workspaceStore, documentStore)
  workspaceStore.getState().switchWorkspace(rootFolder)
  activateWorkbenchSelection(workspaceStore.getState().workbenchPanels, activation)
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

  retainTabPresentation(workspace, workspace.workbenchPanels, documentStore, uiStore, byteBudget)
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
    restoredTabCount: editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels).length,
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

function retainTabPresentation(
  workspace: EditorWorkspaceStore,
  panels: WorkbenchPanels,
  documentStore: EditorDocumentStoreApi,
  uiStore: EditorUiStoreApi,
  byteBudget: number,
) {
  const documents = documentStore.getState()
  const retained = editorRetention(
    workspace,
    panels,
    documents.editorDocumentSizes(),
    byteBudget,
    documents.unevictableEditorDocumentKeys(),
  )
  uiStore.getState().retainTabPresentation(retained.tabIds)
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
    tabIds: editorTabRecordsForWorkbenchPanels(panels).map((tab) => tab.id),
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
  captureEditorScrollPositions(workspaceStore, documentStore)
  const workspace = workspaceStore.getState()
  const tab = editorTabForId(workspace.workbenchPanels, tabId)
  if (!tab) return { wasDirty: false }
  const content = tab.content
  const nextPanels = closeEditorTabInWorkbenchPanels(workspace.workbenchPanels, tabId)
  const nextSelection = editorWorkspaceSelectionForWorkbenchPanelsForState(workspace, nextPanels)
  const remainingCount =
    editorContentCountsForWorkbenchPanels(nextPanels).get(tabContentKey(content)) ?? 0
  const discard =
    options.discard ||
    tabDocuments(content).some((target) => {
      const document = documentStore.getState().getLiveEditorDocument(documentKey(target))
      return (
        document?.sync.kind === 'file' &&
        document.sync.orphaned &&
        !isDirtyLiveEditorDocument(documentStore.getState(), document.key)
      )
    })
  const result =
    discard && remainingCount === 0
      ? tabDocuments(content)
          .map((document) =>
            documentStore.getState().deleteLiveEditorDocument(documentKey(document)),
          )
          .reduce((all, one) => ({ wasDirty: all.wasDirty || one.wasDirty }), { wasDirty: false })
      : { wasDirty: false }

  if (!discard || remainingCount > 0) {
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
  retainTabPresentation(workspace, nextPanels, documentStore, uiStore, retainedTextBudget())
  updateUiForClosedContent(content, nextSelection.selectedTabContent, remainingCount, uiStore)
  activateWorkbenchSelection(nextPanels, activation)
  workspaceStore.setState({
    ...nextSelection,
    viewScrollPositions: workspace.viewScrollPositions.filter((entry) => entry.tabId !== tabId),
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

function selectTab(
  groupId: GroupId,
  tabId: TabId,
  workspaceStore: EditorWorkspaceStoreApi,
  activation: EditorActivation,
) {
  const workspace = workspaceStore.getState()
  if (groupForTab(workspace.workbenchPanels.editorGroups, tabId)?.id !== groupId) return
  const editorGroups = selectEditorGroupTab(workspace.workbenchPanels.editorGroups, groupId, tabId)
  const workbenchPanels = { ...workspace.workbenchPanels, editorGroups }
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
  return editorTabRecordsForWorkbenchPanels(panels).find((tab) => tab.id === tabId) ?? null
}

function editorTabForContent(panels: WorkbenchPanels, content: TabContent) {
  return (
    editorTabRecordsForWorkbenchPanels(panels).find((tab) =>
      sameTabContent(tab.content, content),
    ) ?? null
  )
}

export function createEditorActivation(
  fileOpenIntent: FileOpenIntentActivation,
  documentStore: EditorDocumentStoreApi,
  rootOwner: Pick<FileOpenIntentServiceOwner, 'setRoot'>,
): EditorActivation {
  return {
    activate: (content, tabId) => {
      if (content.kind !== 'document' || content.document.kind !== 'file') return null
      const filePath = content.document.resource.path

      const liveClaim = fileOpenIntent.claimLive(filePath)
      if (liveClaim) {
        documentStore
          .getState()
          .ensureEditorViewForDocument(tabId, liveClaim.documentKey, liveClaim)
        return liveClaim.preparedDocument ? 'hit' : 'live'
      }
      const cleanClaim = fileOpenIntent.claimReadyClean(filePath)
      if (cleanClaim) {
        documentStore.getState().ensureEditorView(tabId, cleanClaim.file, cleanClaim)
        return 'hit'
      }

      const liveDocument = documentStore.getState().getLiveEditorDocument(fileDocumentKey(filePath))
      if (!liveDocument) return 'miss'
      documentStore.getState().ensureEditorViewForDocument(tabId, liveDocument.key)
      return 'live'
    },
    setRoot: (rootPath) => rootOwner.setRoot(rootPath),
  }
}

export function activateWorkbenchSelection(
  panels: WorkbenchPanels,
  activation: EditorActivation,
): PressPrefetch | null {
  const tab = activeEditorTabForWorkbenchPanels(panels)
  if (!tab) return null

  return activation.activate(tab.content, tab.id)
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
