import { sameItems as sameQueryKey } from '@workspace/utils/collections'
import {
  filterGroupTabs,
  groupForTab,
  openTabInGroups,
  selectEditorGroupTab,
} from '@/lib/documents/utils/groups'
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
  awaitEditorSyntaxRuntimeSessionIdle,
  awaitEditorSyntaxWorkerIdleFences,
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
  workspaceRoot,
} from '@/lib/documents/utils/identity'
import { filesystemResource } from '@/lib/documents/utils/capabilities'
import { documentTab, sameTabContent, settingsTab } from '@/lib/documents/utils/tabs'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { closeEditorTabInWorkbenchPanels } from '@/features/workbench/utils/panels'
import { editorHistoryForClosedContent } from '@/features/editor/utils/tab-history'

type EditorOpenSampleTarget = { readonly path: FilesystemPath; readonly rootPath: FilesystemPath }
type EditorOpenSampleResetRequest = EditorOpenSampleTarget & { readonly sampleId: string }

const BENCHMARK_TARGET_TAB_PREFIX = 'editor-open-benchmark-target:'
const BENCHMARK_GUARD_TAB_PREFIX = 'editor-open-benchmark-guard:'

type EditorOpenSample = {
  readonly sample: FileOpenIntentBenchmarkSample
  readonly inertTabId: TabId
  readonly guardTabIds: readonly TabId[]
}

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
  const samples = new Map<string, EditorOpenSample>()
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
      const layout = inactiveTargetLayout(request.path, workspaceStore)
      const sample = fileOpenIntentOwner.beginBenchmarkSample(request)
      samples.set(request.sampleId, {
        sample,
        inertTabId: layout.inertTabId,
        guardTabIds: layout.guardTabIds,
      })
      const workspace = workspaceStore.getState()
      workspace.setEditorHistory(
        editorHistoryForClosedContent(workspace.editorHistory, documentTab(fileDocument(request))),
      )
      workspace.setWorkbenchPanels({
        ...workspace.workbenchPanels,
        editorGroups: layout.editorGroups,
      })
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
        const ownedSample = samples.get(request.sampleId)
        if (!ownedSample) {
          throw createClientInvariantError('Editor-open benchmark sample is not active')
        }
        const { sample } = ownedSample
        assertSampleTarget(request, sample)
        const result = await resetEditorOpenSample({
          storage,
          commands,
          documentStore,
          mountedEditors,
          queryClient,
          request,
          sample,
          inertTabId: ownedSample.inertTabId,
          guardTabIds: ownedSample.guardTabIds,
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
  inertTabId,
  guardTabIds,
  workspaceStore,
}: {
  readonly commands: EditorApplyActions
  readonly storage: ScopedStorage
  readonly documentStore: EditorDocumentStoreApi
  readonly mountedEditors: MountedEditorRegistry
  readonly queryClient: QueryClient
  readonly request: EditorOpenSampleResetRequest
  readonly sample: FileOpenIntentBenchmarkSample
  readonly inertTabId: TabId
  readonly guardTabIds: readonly TabId[]
  readonly workspaceStore: EditorWorkspaceStoreApi
}) {
  assertTargetRoot(request, workspaceStore)
  sample.quarantine()
  assertTargetIsClean(request.path, documentStore)
  activateInertAndCloseTarget(request.path, commands, workspaceStore, inertTabId, guardTabIds)
  await nextTaskAndFrame()
  if (mountedEditors.has(request.path)) {
    throw createClientInvariantError('Editor-open benchmark target remained mounted after close')
  }

  await clearTargetQueries(request, queryClient)
  const result = await sample.quiesce()
  deleteCleanTargetDocument(request.path, documentStore)
  removeEditorVisibleSnapshotCacheForPath(storage, request)
  await Promise.all(
    result.highlighterRuntimeSessionIds
      .concat(result.structuralRuntimeSessionIds)
      .map(awaitEditorSyntaxRuntimeSessionIdle),
  )
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
  inertTabId: TabId,
  guardTabIds: readonly TabId[],
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
      tab.id === inertTabId &&
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

  const current = workspaceStore.getState()
  const closed = closeEditorTabInWorkbenchPanels(current.workbenchPanels, targetTab.id)
  current.setEditorHistory(editorHistoryForClosedContent(current.editorHistory, targetTab.content))
  current.setWorkbenchPanels({
    ...closed,
    editorGroups: filterGroupTabs(closed.editorGroups, (tab) => !guardTabIds.includes(tab.id)),
  })

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
  samples: ReadonlyMap<string, EditorOpenSample>,
): void {
  for (const { sample } of samples.values()) {
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

function inactiveTargetLayout(path: FilesystemPath, workspaceStore: EditorWorkspaceStoreApi) {
  const workspace = workspaceStore.getState()
  const panels = workspace.workbenchPanels
  const inert = activeEditorTabForWorkbenchPanels(panels)
  if (!inert || (inert.content.kind === 'document' && filesystemResource(inert.content.document))) {
    throw createClientInvariantError('Editor-open benchmark requires a selected inert surface')
  }

  const before = {
    id: tabId(`${BENCHMARK_GUARD_TAB_PREFIX}${crypto.randomUUID()}`),
    content: settingsTab(),
  }
  const after = {
    id: tabId(`${BENCHMARK_GUARD_TAB_PREFIX}${crypto.randomUUID()}`),
    content: documentTab({
      kind: 'search',
      root: workspaceRoot(
        inert.content.kind === 'document' &&
          inert.content.document.kind === 'search' &&
          inert.content.document.root === ''
          ? '/'
          : '',
      ),
    }),
  }
  if (
    editorTabRecordsForWorkbenchPanels(panels).some(
      (tab) =>
        sameTabContent(tab.content, before.content) || sameTabContent(tab.content, after.content),
    )
  ) {
    throw createClientInvariantError('Editor-open benchmark requires unused inert guard contents')
  }

  const tab = {
    id: tabId(`${BENCHMARK_TARGET_TAB_PREFIX}${crypto.randomUUID()}`),
    content: documentTab(fileDocument({ path })),
  }
  const groupId = panels.editorGroups.activeGroupId
  const withBefore = openTabInGroups(panels.editorGroups, before)
  const withTarget = openTabInGroups(withBefore, tab)
  const editorGroups = selectEditorGroupTab(openTabInGroups(withTarget, after), groupId, inert.id)
  return { editorGroups, inertTabId: inert.id, guardTabIds: [before.id, after.id] }
}

async function nextTaskAndFrame(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  if (typeof requestAnimationFrame !== 'function') return

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
