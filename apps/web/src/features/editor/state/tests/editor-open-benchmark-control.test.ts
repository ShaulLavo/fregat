import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
// @vitest-environment happy-dom

import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'

import { createEditorOpenBenchmarkControl } from '@/features/editor/state/editor-open-benchmark-control'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createEditorUiStore } from '@/features/editor/state/ui-state'
import { createEditorWorkspaceStore } from '@/features/editor/state/workspace-state'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import { createDefaultWorkbenchPanels } from '@/features/workbench/utils/panels'
import { createEditorTabRecord } from '@/features/workspace/utils/tab-model'
import type {
  FileOpenIntentBenchmarkSample,
  FileOpenIntentServiceOwner,
} from '@/lib/file-open-intent/state/service'
import { MountedEditorRegistry } from '@/features/editor/state/mounted-editor-registry'
import type { EditorActivation } from '@/features/editor/state/commands'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'

describe('editor-open benchmark control', () => {
  test('rejects a target shared by multiple tabs before closing either tab', async () => {
    const path = '/repo/a.ts'
    const inert = createEditorTabRecord('search-buffer:%2Frepo')
    const workspaceStore = createEditorWorkspaceStore()
    workspaceStore.getState().switchWorkspace(rootFolder())
    workspaceStore.getState().setWorkbenchPanels({
      ...createDefaultWorkbenchPanels(),
      activeEditorTabId: inert.id,
      editorTabs: [inert],
    })
    const sample = benchmarkSample({ path, rootPath: '/repo' })
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation: inertActivation,
      documentStore: createEditorDocumentStore(),
      fileOpenIntentOwner: benchmarkOwner(sample),
      mountedEditors: new MountedEditorRegistry(),
      queryClient: new QueryClient(),
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    control.begin({ path, rootPath: '/repo', sampleId: 'shared-target' })
    const first = workspaceStore
      .getState()
      .workbenchPanels.editorTabs.find((tab) => tab.path === path)!
    const second = createEditorTabRecord(path)
    workspaceStore.getState().setWorkbenchPanels({
      ...workspaceStore.getState().workbenchPanels,
      activeEditorTabId: first.id,
      editorTabs: [inert, first, second],
    })

    await expect(
      control.reset({ path, rootPath: '/repo', sampleId: 'shared-target' }),
    ).rejects.toThrow('Editor-open benchmark target is shared by multiple tabs')

    expect(sample.quarantine).toHaveBeenCalledOnce()
    expect(sample.release).not.toHaveBeenCalled()
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([inert, first, second])
  })

  test('waits for the next task and frame before requiring the target editor to unmount', async () => {
    const path = '/repo/a.ts'
    const inert = createEditorTabRecord('search-buffer:%2Frepo')
    const workspaceStore = createEditorWorkspaceStore()
    workspaceStore.getState().switchWorkspace(rootFolder())
    workspaceStore.getState().setWorkbenchPanels({
      ...createDefaultWorkbenchPanels(),
      activeEditorTabId: inert.id,
      editorTabs: [inert],
    })
    const mountedEditors = new MountedEditorRegistry()
    const sample = benchmarkSample({ path, rootPath: '/repo' })
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation: inertActivation,
      documentStore: createEditorDocumentStore(),
      fileOpenIntentOwner: benchmarkOwner(sample),
      mountedEditors,
      queryClient: new QueryClient(),
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    control.begin({ path, rootPath: '/repo', sampleId: 'async-unmount' })
    const target = workspaceStore
      .getState()
      .workbenchPanels.editorTabs.find((tab) => tab.path === path)!
    workspaceStore.getState().setWorkbenchPanels({
      ...workspaceStore.getState().workbenchPanels,
      activeEditorTabId: target.id,
    })
    const unregisterTarget = mountedEditors.register(path)

    setTimeout(() => requestAnimationFrame(unregisterTarget), 0)

    await expect(
      control.reset({ path, rootPath: '/repo', sampleId: 'async-unmount' }),
    ).resolves.toMatchObject({ quiescent: true })
    expect(sample.release).toHaveBeenCalledOnce()
    expect(workspaceStore.getState().workbenchPanels.editorTabs).toEqual([inert])
  })

  test('rejects a reset target that does not match the immutable sample target', async () => {
    const path = '/repo/a.ts'
    const workspaceStore = workspaceWithInertTab()
    const sample = benchmarkSample({ path, rootPath: '/repo' })
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation: inertActivation,
      documentStore: createEditorDocumentStore(),
      fileOpenIntentOwner: benchmarkOwner(sample),
      mountedEditors: new MountedEditorRegistry(),
      queryClient: new QueryClient(),
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    control.begin({ path, rootPath: '/repo', sampleId: 'target-mismatch' })

    await expect(
      control.reset({
        path: '/repo/other.ts',
        rootPath: '/repo',
        sampleId: 'target-mismatch',
      }),
    ).rejects.toThrow('reset target does not match its sample')

    expect(sample.quarantine).not.toHaveBeenCalled()
    expect(sample.release).not.toHaveBeenCalled()
  })

  test('primes only the exact file query without activation or preparation side effects', async () => {
    const path = '/repo/a.ts'
    const rootPath = '/repo'
    const workspaceStore = workspaceWithInertTab()
    const documentStore = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const sample = benchmarkSample({ path, rootPath })
    const owner = benchmarkOwner(sample)
    const activation: EditorActivation = {
      activate: vi.fn(),
      setRoot: vi.fn(),
    }
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation,
      documentStore,
      fileOpenIntentOwner: owner,
      mountedEditors: new MountedEditorRegistry(),
      queryClient,
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    await expect(control.prime({ path, rootPath })).rejects.toThrow('requires an active sample')

    control.begin({ path, rootPath, sampleId: 'query-primer' })
    const panelsBeforePrime = workspaceStore.getState().workbenchPanels
    const queryKey = fileSnapshotQueryOptions(path).queryKey
    queryClient.setQueryData(queryKey, fileResult(path))

    await expect(control.prime({ path, rootPath })).resolves.toEqual({ ready: true })

    expect(workspaceStore.getState().workbenchPanels).toBe(panelsBeforePrime)
    expect(documentStore.getState().liveDocumentsById).toEqual({})
    expect(documentStore.getState().viewsByTabId).toEqual({})
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([queryKey])
    expect(activation.activate).not.toHaveBeenCalled()
    expect(owner.service.prepare).not.toHaveBeenCalled()
    expect(sample.quarantine).not.toHaveBeenCalled()
    expect(sample.quiesce).not.toHaveBeenCalled()
    expect(sample.release).not.toHaveBeenCalled()
  })

  test('keeps a failed reset quarantined and never releases it', async () => {
    const path = '/repo/a.ts'
    const workspaceStore = workspaceWithInertTab()
    const sample = benchmarkSample({ path, rootPath: '/repo' }, new Error('quiesce failed'))
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation: inertActivation,
      documentStore: createEditorDocumentStore(),
      fileOpenIntentOwner: benchmarkOwner(sample),
      mountedEditors: new MountedEditorRegistry(),
      queryClient: new QueryClient(),
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    control.begin({ path, rootPath: '/repo', sampleId: 'failed-reset' })

    await expect(
      control.reset({ path, rootPath: '/repo', sampleId: 'failed-reset' }),
    ).rejects.toThrow('quiesce failed')

    expect(sample.quarantine).toHaveBeenCalledOnce()
    expect(sample.release).not.toHaveBeenCalled()
  })

  test('removes every target query generation before quiescence and preserves unrelated queries', async () => {
    const path = '/repo/a.ts'
    const rootPath = '/repo'
    const workspaceStore = workspaceWithInertTab()
    const documentStore = createEditorDocumentStore()
    const queryClient = new QueryClient()
    const sample = benchmarkSample({ path, rootPath })
    const control = createEditorOpenBenchmarkControl({
      storage: testScopedStorage,
      activation: inertActivation,
      documentStore,
      fileOpenIntentOwner: benchmarkOwner(sample),
      mountedEditors: new MountedEditorRegistry(),
      queryClient,
      searchStore: createSearchBufferStore(),
      uiStore: createEditorUiStore(),
      workspaceStore,
    })
    control.begin({ path, rootPath, sampleId: 'query-order' })
    const target = workspaceStore
      .getState()
      .workbenchPanels.editorTabs.find((tab) => tab.path === path)!
    workspaceStore.getState().setWorkbenchPanels({
      ...workspaceStore.getState().workbenchPanels,
      activeEditorTabId: target.id,
    })
    const file = fileResult(path)
    documentStore.getState().ensureEditorView(target.id, file)
    const targetFileKey = fileSnapshotQueryOptions(path).queryKey
    const firstTargetLsp = ['language-server-matches', rootPath, path, 1] as const
    const secondTargetLsp = ['language-server-matches', rootPath, path, 2] as const
    const unrelatedLsp = ['language-server-matches', rootPath, '/repo/other.ts', 1] as const
    queryClient.setQueryData(targetFileKey, file)
    queryClient.setQueryData(firstTargetLsp, [])
    queryClient.setQueryData(secondTargetLsp, [])
    queryClient.setQueryData(unrelatedLsp, ['keep'])
    vi.mocked(sample.quiesce).mockImplementation(async () => {
      expect(queryClient.getQueryData(targetFileKey)).toBeUndefined()
      expect(queryClient.getQueryData(firstTargetLsp)).toBeUndefined()
      expect(queryClient.getQueryData(secondTargetLsp)).toBeUndefined()
      expect(documentStore.getState().getLiveEditorDocument(path)).not.toBeNull()
      return benchmarkSampleResult()
    })

    await control.reset({ path, rootPath, sampleId: 'query-order' })

    expect(documentStore.getState().getLiveEditorDocument(path)).toBeNull()
    expect(queryClient.getQueryData(unrelatedLsp)).toEqual(['keep'])
    expect(sample.release).toHaveBeenCalledOnce()
  })
})

function benchmarkSampleResult() {
  return {
    evictions: 0,
    highlighterRuntimeSessionIds: [],
    nonTargetIntents: 0,
    preparedClaims: 0,
    promotedBytes: 0,
    structuralRuntimeSessionIds: [],
    targetIntents: 0,
    transferredHighlighterRuntimeSessionIds: [],
    transferredStructuralRuntimeSessionIds: [],
    wastedIntents: 0,
  }
}

function benchmarkSample(
  target: FileOpenIntentBenchmarkSample['target'],
  failure?: Error,
): FileOpenIntentBenchmarkSample {
  return {
    id: 'owner-sample',
    target,
    quarantine: vi.fn(),
    quiesce: vi.fn(() =>
      failure ? Promise.reject(failure) : Promise.resolve(benchmarkSampleResult()),
    ),
    release: vi.fn(),
  }
}

function benchmarkOwner(sample: FileOpenIntentBenchmarkSample): FileOpenIntentServiceOwner {
  return {
    activation: {
      claimLive: () => null,
      claimReadyClean: () => null,
    },
    beginBenchmarkSample: vi.fn(() => sample),
    connect: () => undefined,
    disposeNow: () => undefined,
    scheduleDisconnect: () => undefined,
    service: {
      claimLive: () => null,
      claimReadyClean: () => null,
      prepare: vi.fn(),
      recordInitialPaint: () => undefined,
    },
    setEnvironment: () => undefined,
    setRelatedPrefetch: () => undefined,
    setRoot: () => undefined,
  }
}

const inertActivation: EditorActivation = {
  activate: () => undefined,
  setRoot: () => undefined,
}

function workspaceWithInertTab() {
  const inert = createEditorTabRecord('search-buffer:%2Frepo')
  const workspaceStore = createEditorWorkspaceStore()
  workspaceStore.getState().switchWorkspace(rootFolder())
  workspaceStore.getState().setWorkbenchPanels({
    ...createDefaultWorkbenchPanels(),
    activeEditorTabId: inert.id,
    editorTabs: [inert],
  })
  return workspaceStore
}

function rootFolder() {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: 'repo',
    path: '/repo',
    size: 0,
    type: 'directory' as const,
    version: 'test',
  }
}

function fileResult(path: string) {
  return {
    content: 'alpha\n',
    mtimeMs: 1,
    path,
    size: 6,
    version: 'v1',
  }
}
