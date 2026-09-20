import { sameItems as sameQueryKey } from '@workspace/utils/collections'
import { groupForTab, openTabInGroups, selectEditorGroupTab } from '@/lib/documents/utils/groups'
import {
  activeEditorTabForWorkbenchPanels,
  editorTabRecordsForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { retainedTextBudgetFromSettings } from '@/features/editor/utils/retained-text-budget'
import type { Query, QueryClient } from '@tanstack/react-query'

import {
  createEditorApplyActions,
  type EditorActivation,
  type EditorApplyActions,
} from '@/features/editor/state/apply-actions'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { type EditorOpenBenchmarkControl } from '@/features/editor/state/performance-trace'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  awaitEditorShikiRuntimeSessionIdle,
  awaitEditorSyntaxWorkerIdleFences,
  awaitEditorTreeSitterRuntimeSessionIdle,
} from '@/features/editor/state/syntax-highlighting'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { removeEditorVisibleSnapshotCacheForPath } from '@/lib/editor-visible-snapshot-cache'
import { ensureFileSnapshotQuery, fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import type {
  FileOpenIntentBenchmarkSample,
  FileOpenIntentServiceOwner,
} from '@/lib/file-open-intent/state/service'
import type { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'
import { createClientInvariantError } from '@/lib/structured-errors'
import {
  fileDocumentKey,
  filesystemPath,
  fileDocument,
  tabId,
} from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import { documentTab, sameTabContent } from '@/lib/documents/utils/tabs'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { closeEditorTabInWorkbenchPanels } from '@/features/workbench/utils/panels'

type EditorOpenSampleTarget = { readonly path: FilesystemPath; readonly rootPath: FilesystemPath }
type EditorOpenSampleResetRequest = EditorOpenSampleTarget & { readonly sampleId: string }

const BENCHMARK_TARGET_TAB_PREFIX = 'editor-open-benchmark-target:'

export function createEditorOpenBenchmarkControl({
  storage,
  activation,
  documentStore,
  fileOpenIntentOwner,
  mountedEditors,
  queryClient,
  searchStore,
  uiStore,
  workspaceStore,
}: {
  readonly storage: ScopedStorage
  readonly activation: EditorActivation
  readonly documentStore: EditorDocumentStoreApi
  readonly fileOpenIntentOwner: FileOpenIntentServiceOwner
  readonly mountedEditors: MountedEditorRegistry
  readonly queryClient: QueryClient
  readonly searchStore: SearchBufferStoreApi
  readonly uiStore: EditorUiStoreApi
  readonly workspaceStore: EditorWorkspaceStoreApi
}): EditorOpenBenchmarkControl {
  // Reset is fixture setup; measured tab selection uses the normal navigation command.
  const commands = createEditorApplyActions({
    retainedTextBudget: retainedTextBudgetFromSettings,
    activation,
    documentStore,
    searchStore,
    uiStore,
    workspaceStore,
  })
  const samples = new Map<string, FileOpenIntentBenchmarkSample>()
  let resetRunning = false

  return {
    begin: (input) => {
      const request = {
        ...input,
        path: filesystemPath(input.path),
        rootPath: filesystemPath(input.rootPath),
      }
      assertTargetRoot(request, workspaceStore)
      assertTargetStateCleared(request, documentStore, mountedEditors, queryClient, workspaceStore)
      if (samples.has(request.sampleId)) {
        throw createClientInvariantError('Editor-open benchmark sample id is already active')
      }
      const sample = fileOpenIntentOwner.beginBenchmarkSample(request)
      samples.set(request.sampleId, sample)
      installInactiveTargetTab(request.path, workspaceStore)
    },
    prime: async (input) => {
      const request = {
        ...input,
        path: filesystemPath(input.path),
        rootPath: filesystemPath(input.rootPath),
      }
      assertTargetRoot(request, workspaceStore)
      assertActiveSampleTarget(request, samples)
      await ensureFileSnapshotQuery(queryClient, request.path)
      return { ready: true }
    },
    reset: async (input) => {
      const request = {
        ...input,
        path: filesystemPath(input.path),
        rootPath: filesystemPath(input.rootPath),
      }
      if (resetRunning) {
        throw createClientInvariantError('Editor-open benchmark reset is already running')
      }

      resetRunning = true
      try {
        const sample = samples.get(request.sampleId)
        if (!sample) {
          throw createClientInvariantError('Editor-open benchmark sample is not active')
        }
        assertSampleTarget(request, sample)
        const result = await resetEditorOpenSample({
          storage,
          commands,
          documentStore,
          mountedEditors,
          queryClient,
          request,
          sample,
          workspaceStore,
        })
        samples.delete(request.sampleId)
        return result
      } finally {
        resetRunning = false
      }
    },
  }
}

async function resetEditorOpenSample({
  storage,
  commands,
  documentStore,
  mountedEditors,
  queryClient,
  request,
  sample,
  workspaceStore,
}: {
  readonly commands: EditorApplyActions
  readonly storage: ScopedStorage
  readonly documentStore: EditorDocumentStoreApi
  readonly mountedEditors: MountedEditorRegistry
  readonly queryClient: QueryClient
  readonly request: EditorOpenSampleResetRequest
  readonly sample: FileOpenIntentBenchmarkSample
  readonly workspaceStore: EditorWorkspaceStoreApi
}) {
  assertTargetRoot(request, workspaceStore)
  sample.quarantine()
  assertTargetIsClean(request.path, documentStore)
  activateInertAndCloseTarget(request.path, commands, workspaceStore)
  await nextTaskAndFrame()
  if (mountedEditors.has(request.path)) {
    throw createClientInvariantError('Editor-open benchmark target remained mounted after close')
  }

  await clearTargetQueries(request, queryClient)
  const result = await sample.quiesce()
  deleteCleanTargetDocument(request.path, documentStore)
  removeEditorVisibleSnapshotCacheForPath(storage, request)
  await Promise.all([
    ...result.highlighterRuntimeSessionIds.map((runtimeSessionId) =>
      awaitEditorShikiRuntimeSessionIdle(runtimeSessionId),
    ),
    ...result.structuralRuntimeSessionIds.map((runtimeSessionId) =>
      awaitEditorTreeSitterRuntimeSessionIdle(runtimeSessionId),
    ),
  ])
  await awaitEditorSyntaxWorkerIdleFences()
  await nextTaskAndFrame()
  removeEditorVisibleSnapshotCacheForPath(storage, request)
  assertTargetStateCleared(request, documentStore, mountedEditors, queryClient, workspaceStore)
  sample.release()
  return { ...result, quiescent: true as const }
}

function assertTargetRoot(
  request: EditorOpenSampleTarget,
  workspaceStore: EditorWorkspaceStoreApi,
): void {
  if (workspaceStore.getState().rootFolder?.path === request.rootPath) return

  throw createClientInvariantError('Editor-open benchmark target root is not active')
}

function assertTargetIsClean(path: FilesystemPath, documentStore: EditorDocumentStoreApi): void {
  const document = documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))
  if (!document || !document.buffer.isDirty()) return

  throw createClientInvariantError('Editor-open benchmark cannot reset a dirty target')
}

function activateInertAndCloseTarget(
  path: FilesystemPath,
  commands: EditorApplyActions,
  workspaceStore: EditorWorkspaceStoreApi,
): void {
  const workspace = workspaceStore.getState()
  const targetTabs = editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels).filter((tab) =>
    sameTabContent(tab.content, documentTab(fileDocument({ path }))),
  )
  if (targetTabs.length > 1) {
    throw createClientInvariantError('Editor-open benchmark target is shared by multiple tabs')
  }
  const targetTab = targetTabs[0]
  if (!targetTab) {
    throw createClientInvariantError('Editor-open benchmark target tab is missing')
  }

  const inertTab = editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels).find(
    (tab) =>
      tab.id !== targetTab.id &&
      (tab.content.kind !== 'document' || !filesystemResource(tab.content.document)),
  )
  if (!inertTab) {
    throw createClientInvariantError('Editor-open benchmark requires a dedicated inert surface')
  }

  const group = groupForTab(workspace.workbenchPanels.editorGroups, inertTab.id)
  if (!group) throw createClientInvariantError('Benchmark inert group is missing')
  commands.selectTab({ groupId: group.id, tabId: inertTab.id })
  const selectedInert = activeEditorTabForWorkbenchPanels(
    workspaceStore.getState().workbenchPanels,
  )?.id
  if (selectedInert !== inertTab.id) {
    throw createClientInvariantError('Editor-open benchmark could not activate its inert surface')
  }

  workspaceStore
    .getState()
    .setWorkbenchPanels(
      closeEditorTabInWorkbenchPanels(workspaceStore.getState().workbenchPanels, targetTab.id),
    )

  const activeTabId = activeEditorTabForWorkbenchPanels(
    workspaceStore.getState().workbenchPanels,
  )?.id
  if (activeTabId === inertTab.id) return

  throw createClientInvariantError('Editor-open benchmark requires an inert editor surface')
}

function assertSampleTarget(
  request: EditorOpenSampleResetRequest,
  sample: FileOpenIntentBenchmarkSample,
): void {
  if (sample.target.path !== request.path || sample.target.rootPath !== request.rootPath) {
    throw createClientInvariantError('Editor-open benchmark reset target does not match its sample')
  }
}

function assertActiveSampleTarget(
  target: EditorOpenSampleTarget,
  samples: ReadonlyMap<string, FileOpenIntentBenchmarkSample>,
): void {
  for (const sample of samples.values()) {
    if (sample.target.path !== target.path) continue
    if (sample.target.rootPath === target.rootPath) return
  }

  throw createClientInvariantError('Editor-open benchmark query primer requires an active sample')
}

function deleteCleanTargetDocument(
  path: FilesystemPath,
  documentStore: EditorDocumentStoreApi,
): void {
  const document = documentStore.getState().getLiveEditorDocument(fileDocumentKey(path))
  if (!document) return
  if (document.buffer.isDirty()) {
    throw createClientInvariantError('Editor-open benchmark target became dirty during reset')
  }

  documentStore.getState().deleteLiveEditorDocument(document.key)
}

async function clearTargetQueries(
  request: EditorOpenSampleTarget,
  queryClient: QueryClient,
): Promise<void> {
  const queries = targetQueries(request, queryClient)
  if (queries.some((query) => query.getObserversCount() > 0)) {
    throw createClientInvariantError('Editor-open benchmark target query is still observed')
  }

  await Promise.all(
    queries.map((query) => queryClient.cancelQueries({ exact: true, queryKey: query.queryKey })),
  )
  if (queries.some((query) => query.state.fetchStatus !== 'idle')) {
    throw createClientInvariantError('Editor-open benchmark target query did not become idle')
  }
  for (const query of queries) {
    queryClient.removeQueries({ exact: true, queryKey: query.queryKey })
  }
}

function targetQueries(request: EditorOpenSampleTarget, queryClient: QueryClient): Query[] {
  const fileQueryKey = fileSnapshotQueryOptions(request.path).queryKey
  return queryClient.getQueryCache().findAll({
    predicate: (query) => {
      if (sameQueryKey(query.queryKey, fileQueryKey)) return true
      return (
        query.queryKey[0] === 'language-server-matches' &&
        query.queryKey[1] === request.rootPath &&
        query.queryKey[2] === request.path
      )
    },
  })
}

function assertTargetStateCleared(
  request: EditorOpenSampleTarget,
  documentStore: EditorDocumentStoreApi,
  mountedEditors: MountedEditorRegistry,
  queryClient: QueryClient,
  workspaceStore: EditorWorkspaceStoreApi,
): void {
  const workspace = workspaceStore.getState()
  if (
    editorTabRecordsForWorkbenchPanels(workspace.workbenchPanels).some((tab) =>
      sameTabContent(tab.content, documentTab(fileDocument({ path: request.path }))),
    )
  ) {
    throw createClientInvariantError('Editor-open benchmark target tab reappeared during reset')
  }
  if (documentStore.getState().getLiveEditorDocument(fileDocumentKey(request.path))) {
    throw createClientInvariantError(
      'Editor-open benchmark target document reappeared during reset',
    )
  }
  if (
    Object.values(documentStore.getState().viewsByTabId).some(
      (view) => view.documentKey === fileDocumentKey(request.path),
    )
  ) {
    throw createClientInvariantError('Editor-open benchmark target view reappeared during reset')
  }
  if (mountedEditors.has(request.path)) {
    throw createClientInvariantError('Editor-open benchmark target host reappeared during reset')
  }
  if (targetQueries(request, queryClient).length > 0) {
    throw createClientInvariantError('Editor-open benchmark target query reappeared during reset')
  }
}

function installInactiveTargetTab(
  path: FilesystemPath,
  workspaceStore: EditorWorkspaceStoreApi,
): void {
  const workspace = workspaceStore.getState()
  const panels = workspace.workbenchPanels
  if (
    editorTabRecordsForWorkbenchPanels(panels).some((tab) =>
      sameTabContent(tab.content, documentTab(fileDocument({ path }))),
    )
  )
    return

  const tab = {
    id: tabId(`${BENCHMARK_TARGET_TAB_PREFIX}${crypto.randomUUID()}`),
    content: documentTab(fileDocument({ path })),
  }
  const groupId = panels.editorGroups.activeGroupId
  const selected = activeEditorTabForWorkbenchPanels(panels)?.id ?? null
  const editorGroups = selectEditorGroupTab(
    openTabInGroups(panels.editorGroups, tab),
    groupId,
    selected,
  )
  workspace.setWorkbenchPanels({ ...panels, editorGroups })
}

async function nextTaskAndFrame(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (typeof requestAnimationFrame !== 'function') return

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
