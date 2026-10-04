import { SpellcheckService } from '@singapore-editor/spellcheck'
import { editorQueryKeys } from '@/features/editor/utils/query-keys'
import { LanguageServerDocuments } from '@/features/editor/state/language-server-documents'
import { openLanguageServerBuffers } from '@/features/editor/utils/open-language-server-buffers'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { documentTab, sameTabContent } from '@/lib/documents/utils/tabs'
import { fileDocument } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { createSnapshotComparisonOwner } from '@/features/editor/state/snapshot-comparison-owner'
import type { ScopedWorktreeRef } from '@workspace/contracts'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import {
  createGitStore,
  type CommitMessageDraft,
  type GitStoreApi,
} from '@/features/git/state/store'
import { workspaceLocationId } from '@/features/workspace/utils/location'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin/document-sync-controller'
import type { QueryClient } from '@tanstack/react-query'

import type { WorkspaceEditHost } from '@/features/editor/providers/workspace-edit-context'
import { createEditorConflictStore } from '@/features/editor/state/conflict-state'
import { createEditorActivation } from '@/features/editor/state/apply-actions'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createEditorOpenBenchmarkControl } from '@/features/editor/state/editor-open-benchmark-control'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { EditorSaveService } from '@/features/editor/state/save-service'
import { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'
import { createEditorUiStore } from '@/features/editor/state/ui-state'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import {
  createPlatformFileOpenPreparer,
  type EditorPreparedEnvironment,
} from '@/features/editor/utils/prepared-document'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import type { CachedWorkspaceState } from '@/features/workspace/state/cache'
import { log } from '@/lib/client-logging'
import { createHistoryBuffer } from '@/features/editor/state/history-buffer'
import { HistoryPersistenceService } from '@/features/editor/state/history-persistence'
import { createFileOpenIntentServiceOwner } from '@/lib/file-open-intent/state/service'
import { bindLanguageCensus } from '@/features/editor/state/language-census'
import { prepareDiffSyntaxForDiffs } from '@/features/editor/state/diff-syntax-preparation'
import { watchAdjacentTabIntents } from '@/features/editor/state/adjacent-tab-intent'
import { bindDiffSyntaxPreparer } from '@/lib/intent-prefetch/state/diff-syntax-preparer'
import { registerEditorOpenBenchmarkControl } from '@/features/editor/state/performance-trace'
import { watchFileAvailability } from '@/features/editor/state/file-availability'
import { getNavigation } from '@/state/navigation-binding'

export type EditorRuntime = ReturnType<typeof createEditorRuntime>

export function createEditorRuntime({
  queryClient,
  workspaceCache,
  storage,
  preparation,
}: {
  readonly queryClient: QueryClient
  readonly storage: ScopedStorage
  readonly workspaceCache: CachedWorkspaceState
  readonly preparation: EditorPreparedEnvironment
}) {
  const conflictStore = createEditorConflictStore()
  const workspaceStore = createEditorWorkspaceStore(workspaceCache)
  const gitStores = new Map<string, GitStoreApi>()
  const bindWorktrees = () => {
    const worktrees =
      useChatProjectionStore.getState().slices[storage.environmentId]?.worktreeById ?? {}
    workspaceStore.getState().bindWorktrees(Object.values(worktrees))
    for (const worktree of Object.values(worktrees)) {
      const folderKey = workspaceLocationId(worktree.path, null)
      const folderStore = gitStores.get(folderKey)
      if (!folderStore) continue
      gitStores.set(workspaceLocationId(worktree.path, worktree.id), folderStore)
      gitStores.delete(folderKey)
    }
  }
  bindWorktrees()
  const documentStore = createEditorDocumentStore({
    environmentId: storage.environmentId,
    scrollPositionSeeds: workspaceStore.getState().reopenScrollPositions,
    viewScrollPositionSeeds: workspaceStore.getState().viewScrollPositions,
  })
  const searchBufferStore = createSearchBufferStore({
    cachedByRootPath: workspaceCache.searchBuffers,
    rootPath: workspaceCache.rootFolder?.path ?? null,
  })
  const uiStore = createEditorUiStore()
  const mountedEditors = new MountedEditorRegistry()
  const fileOpenIntentOwner = createFileOpenIntentServiceOwner({
    createBuffer: createHistoryBuffer,
    getLiveDocument: (path) =>
      documentStore.getState().getLiveEditorDocument(fileDocumentKey(path)),
    getRetainedScrollPosition: (path) =>
      retainedScrollPosition(path, documentStore, workspaceStore),
    isActive: (path) =>
      tabFileResource(workspaceStore.getState().selectedTabContent)?.path === path,
    mountedEditors,
    preparer: createPlatformFileOpenPreparer(preparation),
    prefetchRelated: () => undefined,
    queryClient,
    subscribeLiveDocuments: (listener) => documentStore.subscribe(() => listener()),
  })
  const snapshotComparisonOwner = createSnapshotComparisonOwner(documentStore, queryClient)
  const syncSnapshotComparisons = () => {
    const state = workspaceStore.getState()
    const workspaces = [...state.parkedWorkspaces].map(([rootPath, slice]) => ({
      rootPath: filesystemPath(rootPath),
      panels: slice.workbenchPanels,
    }))
    if (state.rootFolder)
      workspaces.push({ rootPath: state.rootFolder.path, panels: state.workbenchPanels })
    const keep = new Set<TabId>()
    for (const workspace of workspaces) {
      for (const tab of allEditorTabs(workspace.panels.editorGroups)) {
        const target = tab.content.kind === 'document' ? tab.content.document : null
        if (target?.kind !== 'git-diff' || target.source.kind !== 'snapshot') continue
        keep.add(tab.id)
        snapshotComparisonOwner.prepare(
          tab.id,
          { environmentId: storage.environmentId, rootPath: workspace.rootPath },
          target.source,
        )
      }
    }
    snapshotComparisonOwner.retain(keep)
  }
  syncSnapshotComparisons()
  const editorActivation = createEditorActivation(
    fileOpenIntentOwner.activation,
    documentStore,
    fileOpenIntentOwner,
    (path, tabId) => {
      const rootPath = workspaceStore.getState().rootFolder?.path
      const saved = queryClient.getQueryData<import('@/lib/file-snapshot').FileSnapshot>(
        fileSnapshotQueryOptions(path).queryKey,
      )
      if (!rootPath || !saved || saved.seemsBinary) return
      documentStore.getState().prepareSavedComparisonTab(tabId, {
        scope: { environmentId: storage.environmentId, rootPath },
        saved,
        signal: new AbortController().signal,
      })
    },
    (comparison, tabId) => {
      const rootPath = workspaceStore.getState().rootFolder?.path
      if (rootPath)
        snapshotComparisonOwner.prepare(
          tabId,
          { environmentId: storage.environmentId, rootPath },
          comparison,
        )
    },
  )
  const documentSyncController = new LanguageServerDocumentSyncController()
  const languageServerDocuments = new LanguageServerDocuments(preparation.analysisLimitMiCodeUnits)
  // One dictionary worker for every editor on the page; it starts on the first word checked.
  const spellcheck = new SpellcheckService()
  spellcheck.onDidChangeAcceptedWords(() => {
    const filters = { queryKey: editorQueryKeys.allSpellingSuggestions }
    // Cancel first so an old dictionary reply cannot repopulate the invalidated cache.
    void queryClient.cancelQueries(filters)
    void queryClient.invalidateQueries(filters)
  })
  const retainLanguageServers = () =>
    languageServerDocuments.retain(
      openLanguageServerBuffers(workspaceStore.getState(), documentStore.getState()),
    )
  const fileSync = new FileSyncService(documentStore, queryClient)
  const historyPersistence = new HistoryPersistenceService(
    documentStore,
    queryClient,
    storage.environmentId,
  )
  let rootGeneration = 1
  let active = false
  let stopActive: readonly (() => void)[] = []
  let disposed = false
  let recoveryDiscovery: { readonly generation: number; readonly promise: Promise<void> } | null =
    null
  const workspaceEditService = new WorkspaceEditService({
    owner: clientLogContext(clientForQueryClient(queryClient)),
    documentStore,
    documentSyncController,
    fileSync,
    getRoot: () => workspaceRoot(workspaceStore, rootGeneration),
  })
  const workspaceEditHost: WorkspaceEditHost = {
    documentSyncController,
    isOwnEvent: (writeId) =>
      workspaceEditService.isOwnEvent(writeId) || fileSync.isOwnWriteEvent(writeId),
    onApplyWorkspaceEdit: workspaceEditService.onApplyWorkspaceEdit,
  }
  const saveService = new EditorSaveService(
    documentStore,
    queryClient,
    fileSync,
    new SettingsSyncService(documentStore, queryClient),
    workspaceEditService,
  )
  const editorOpenBenchmarkControl = createEditorOpenBenchmarkControl({
    storage,
    activation: editorActivation,
    documentStore,
    fileOpenIntentOwner,
    mountedEditors,
    queryClient,
    searchStore: searchBufferStore,
    uiStore,
    workspaceStore,
  })
  const discoverRecovery = () => {
    const generation = rootGeneration
    if (recoveryDiscovery?.generation === generation) return
    const promise = workspaceEditService
      .discoverRecovery()
      .catch(reportRecoveryFailure)
      .finally(() => {
        if (recoveryDiscovery?.generation === generation) recoveryDiscovery = null
      })
    recoveryDiscovery = { generation, promise }
  }
  const subscriptions = [
    workspaceStore.subscribe((state, previous) => {
      if (
        state.workbenchPanels === previous.workbenchPanels &&
        state.parkedWorkspaces === previous.parkedWorkspaces &&
        state.rootFolder === previous.rootFolder
      )
        return
      syncSnapshotComparisons()
    }),
    documentStore.subscribe((state) => state.liveDocumentsByKey, retainLanguageServers),
    workspaceStore.subscribe((state, previous) => {
      if (
        state.openTabContents === previous.openTabContents &&
        state.parkedWorkspaces === previous.parkedWorkspaces
      )
        return
      retainLanguageServers()
    }),
    useChatProjectionStore.subscribe((state, previous) => {
      if (
        state.slices[storage.environmentId]?.worktreeById ===
        previous.slices[storage.environmentId]?.worktreeById
      )
        return
      bindWorktrees()
    }),
    workspaceStore.subscribe(
      (state) => state.rootFolder?.path ?? null,
      (rootPath) => {
        rootGeneration += 1
        fileOpenIntentOwner.setRoot(rootPath)
        workspaceEditService.resetForRoot()
        if (active) discoverRecovery()
      },
    ),
    workspaceStore.subscribe(
      (state) => state.viewScrollPositions,
      (positions) => documentStore.getState().seedEditorViewScrollPositions(positions),
    ),
    workspaceStore.subscribe(
      (state) => state.reopenScrollPositions,
      (positions) => documentStore.getState().seedEditorScrollPositions(positions),
    ),
  ]
  fileOpenIntentOwner.setRoot(workspaceStore.getState().rootFolder?.path ?? null)

  const suspend = () => {
    if (!active) return
    active = false
    for (const stop of stopActive) stop()
    stopActive = []
    fileOpenIntentOwner.scheduleDisconnect()
  }

  return {
    getOperationRoot: () => workspaceRoot(workspaceStore, rootGeneration),
    issueFileWriteId: fileSync.issueWriteId,
    storage,
    queryClient,
    worktreeRefForRoot(rootPath: FilesystemPath): ScopedWorktreeRef | null {
      const worktreeId = workspaceStore.getState().worktreeIdByRootPath[rootPath]
      return worktreeId ? { environmentId: storage.environmentId, worktreeId } : null
    },
    gitStoreForRoot(rootPath: FilesystemPath) {
      const worktreeId = workspaceStore.getState().worktreeIdByRootPath[rootPath] ?? null
      const key = workspaceLocationId(rootPath, worktreeId)
      const store = gitStores.get(key) ?? createGitStore(commitMessageDraft(storage, key))
      gitStores.set(key, store)
      return store
    },
    conflictStore,
    workspaceStore,
    documentStore,
    searchBufferStore,
    uiStore,
    mountedEditors,
    fileOpenIntentOwner,
    fileOpenIntent: { service: fileOpenIntentOwner.service },
    editorActivation,
    editorOpenBenchmarkControl,
    documentSyncController,
    languageServerDocuments,
    spellcheck,
    workspaceEditService,
    workspaceEditHost,
    saveService,
    resume() {
      if (active || disposed) return
      active = true
      stopActive = [
        bindLanguageCensus({
          queryClient,
          root: () => workspaceStore.getState().rootFolder?.path ?? null,
        }),
        bindDiffSyntaxPreparer(prepareDiffSyntaxForDiffs),
        watchAdjacentTabIntents(workspaceStore, fileOpenIntentOwner.service),
        registerEditorOpenBenchmarkControl(editorOpenBenchmarkControl),
        watchFileAvailability({
          documentStore,
          workspaceStore,
          queryClient,
          forgetFile: (document) => {
            void getNavigation().editorCommands(workspaceStore).discardLiveEditorDocument(document)
              .settled
          },
        }),
      ]
      fileOpenIntentOwner.connect()
      discoverRecovery()
    },
    suspend,
    dispose() {
      if (disposed) return
      suspend()
      disposed = true
      for (const unsubscribe of subscriptions) unsubscribe()
      languageServerDocuments.dispose()
      spellcheck.dispose()
      historyPersistence.dispose()
      fileOpenIntentOwner.disposeNow()
      workspaceEditService.dispose()
      snapshotComparisonOwner.dispose()
      documentStore.getState().disposeEditorDocuments()
    },
    hasUnsavedDocuments() {
      const state = documentStore.getState()
      return (
        state.dirtyDocumentKeys.size > 0 ||
        Object.values(state.liveDocumentsByKey).some((document) => document.buffer.isDirty())
      )
    },
  }
}

function retainedScrollPosition(
  path: FilesystemPath,
  documentStore: ReturnType<typeof createEditorDocumentStore>,
  workspaceStore: ReturnType<typeof createEditorWorkspaceStore>,
) {
  const documents = documentStore.getState()
  const workspace = workspaceStore.getState()
  const selected = activeEditorTabForWorkbenchPanels(workspace.workbenchPanels)
  if (
    selected?.content.kind === 'document' &&
    selected.content.document.kind === 'file' &&
    selected.content.document.resource.path === path
  ) {
    const exact =
      documents.scrollPositionByTabId[selected.id] ??
      workspace.viewScrollPositions.find((entry) => entry.tabId === selected.id)?.position
    if (exact) return exact
  }
  const document = Object.values(documents.liveDocumentsByKey).find(
    (candidate) => candidate.target.kind === 'file' && candidate.target.resource.path === path,
  )
  if (document) {
    const view = Object.values(documents.viewsByTabId).find(
      (candidate) => candidate.documentKey === document.key && candidate.scrollPosition,
    )
    if (view?.scrollPosition) return view.scrollPosition
  }

  return (
    workspaceStore
      .getState()
      .reopenScrollPositions.find((entry) =>
        sameTabContent(entry.content, documentTab(fileDocument({ path }))),
      )?.position ?? null
  )
}

function workspaceRoot(store: ReturnType<typeof createEditorWorkspaceStore>, generation: number) {
  const root = store.getState().rootFolder
  if (!root) return null
  const normalized = root.path.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
  return {
    generation,
    path: root.path,
    uriPath: filesystemPath(normalized ? `/${normalized}` : '/'),
    workspacePath: root.path,
  }
}

function reportRecoveryFailure(error: unknown): void {
  log.warn({ action: 'workspace_edit.recovery_discovery_failed', area: 'workspace-edit', error })
}

function commitMessageDraft(storage: ScopedStorage, locationId: string): CommitMessageDraft {
  const key = `git-commit-message:${locationId}`
  return {
    read: () => storage.getItem(key) ?? '',
    write(message) {
      if (message) storage.setItem(key, message)
      else storage.removeItem(key)
    },
  }
}
