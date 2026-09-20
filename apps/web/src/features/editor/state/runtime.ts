import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { documentTab, sameTabContent } from '@/lib/documents/utils/tabs'
import { fileDocument } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { ScopedWorktreeRef } from '@workspace/contracts'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import {
  createGitStore,
  type CommitMessageDraft,
  type GitStoreApi,
} from '@/features/git/state/store'
import { workspaceLocationId } from '@/features/workspace/utils/location'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { LanguageServerDocumentSyncController } from '@singapore-editor/lsp-plugin'
import type { QueryClient } from '@tanstack/react-query'

import type { WorkspaceEditHost } from '@/features/editor/providers/workspace-edit-context'
import { createEditorConflictStore } from '@/features/editor/state/conflict-state'
import { createEditorActivation } from '@/features/editor/state/apply-actions'
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
  const editorActivation = createEditorActivation(
    fileOpenIntentOwner.activation,
    documentStore,
    fileOpenIntentOwner,
  )
  const documentSyncController = new LanguageServerDocumentSyncController()
  const fileSync = new FileSyncService(documentStore, queryClient)
  const historyPersistence = new HistoryPersistenceService(
    documentStore,
    queryClient,
    storage.environmentId,
  )
  let rootGeneration = 1
  let active = false
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
    workspaceEditService,
    workspaceEditHost,
    saveService,
    resume() {
      if (active || disposed) return
      active = true
      fileOpenIntentOwner.connect()
      discoverRecovery()
    },
    suspend,
    dispose() {
      if (disposed) return
      suspend()
      disposed = true
      for (const unsubscribe of subscriptions) unsubscribe()
      historyPersistence.dispose()
      fileOpenIntentOwner.disposeNow()
      workspaceEditService.dispose()
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
