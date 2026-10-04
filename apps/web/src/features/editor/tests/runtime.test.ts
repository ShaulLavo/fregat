import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { materializeFileSnapshotText, type FileSnapshot } from '@/lib/file-snapshot'
import { filesystemPath, settingsJsonDocument, tabId } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { StandaloneDocumentRef } from '@/lib/documents/utils/types'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createEditorPreparedDocument } from '@singapore-editor/core/editor'
import { QueryClient } from '@tanstack/react-query'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createEditorRuntime } from '@/features/editor/state/runtime'
import { createEditorApplyActions } from '@/features/editor/state/apply-actions'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import { allEditorTabs } from '@/lib/documents/utils/groups'
import { fetchDiff } from '@/features/git/utils/api'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { openEditorContentInWorkbenchPanels } from '@/features/workbench/utils/panels'
import { getClient, setClient } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import { fileSystemKeys } from '@/lib/query-keys'
import { createInProcessClient } from '../../../../test/client'
import { createDeferredFileWriteClient } from '../../../../test/factories/deferred-file-write-client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'
import { vi } from 'vitest'

const preparation = {
  appliedThemeContentHash: null,
  appliedThemeId: null,
  selectedThemeId: 'dark',
  syntaxHighlightingEnabled: false,
  analysisLimitMiCodeUnits: 10,
  tabSize: 4,
}

const preparationPath = filesystemPath('repo/review.ts')

test.for([
  { kind: 'git-ref', source: { path: preparationPath, ref: 'HEAD' } },
  { kind: 'git-diff', source: { kind: 'snapshot', path: preparationPath } },
  { kind: 'compare-saved', file: { path: preparationPath } },
  { kind: 'history', file: { path: preparationPath } },
] satisfies readonly StandaloneDocumentRef[])(
  'prepares the working file while a $kind tab is selected',
  async (target, { server, client }) => {
    await mkdir(join(server.root, 'repo'))
    await writeFile(join(server.root, preparationPath), 'const answer = 42\n')
    const queryClient = new QueryClient()
    registerEnvironmentQueryClient(queryClient, 'http://localhost:7077', client)
    const runtime = createEditorRuntime({
      storage: testScopedStorage,
      preparation,
      queryClient,
      workspaceCache: readWorkspaceCache(testScopedStorage),
    })
    const rootPath = filesystemPath('repo')
    const workspaceAddress = await registerTestWorkspaceAddress(client, rootPath)

    try {
      runtime.workspaceStore.getState().switchWorkspace({
        workspaceAddress,
        birthtimeMs: 0,
        mtimeMs: 0,
        name: 'repo',
        path: rootPath,
        size: 0,
        type: 'directory',
        version: '',
      })
      const workspace = runtime.workspaceStore.getState()
      workspace.setWorkbenchPanels(
        openEditorContentInWorkbenchPanels(workspace.workbenchPanels, documentTab(target)),
      )
      runtime.fileOpenIntentOwner.connect()
      expect(runtime.mountedEditors.has(preparationPath)).toBe(false)

      runtime.fileOpenIntent.service.prepare({
        path: preparationPath,
        rootPath,
        source: 'file-tree',
      })

      await expect
        .poll(() => queryClient.getQueryData(fileSystemKeys.fileSnapshot(preparationPath)))
        .toMatchObject({ path: preparationPath, content: 'const answer = 42\n' })
    } finally {
      runtime.dispose()
      queryClient.clear()
    }
  },
)

test('retains dirty buffers, editor views, and undo history through A/B/A at the same path', async ({
  server,
  client,
}) => {
  const path = 'same.ts'
  await writeFile(join(server.root, path), 'saved')
  const file = await fetchFile(filesystemPath(path), new AbortController().signal, client)
  const queriesA = new QueryClient()
  const queriesB = new QueryClient()
  registerEnvironmentQueryClient(queriesA, 'http://localhost:7077', client)
  registerEnvironmentQueryClient(queriesB, 'http://localhost:7078', client)
  const workspaceCache = readWorkspaceCache(testScopedStorage)
  const a = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queriesA,
    workspaceCache,
  })
  const b = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queriesB,
    workspaceCache,
  })

  try {
    a.resume()
    const viewA = a.documentStore.getState().ensureEditorView(tabId('tab-a'), file)
    const sessionA = createEditorBufferSession(viewA.buffer, viewA.view)
    sessionA.applyText('A ')
    const textA = viewA.buffer.materializeFullText()
    a.documentStore.getState().setEditorViewScrollPosition(tabId('tab-a'), { left: 2, top: 91 })
    a.suspend()
    b.resume()
    const viewB = b.documentStore.getState().ensureEditorView(tabId('tab-b'), file)
    createEditorBufferSession(viewB.buffer, viewB.view).applyText('B ')
    const textB = viewB.buffer.materializeFullText()

    expect(viewB.buffer).not.toBe(viewA.buffer)
    expect(a.hasUnsavedDocuments()).toBe(true)
    expect(b.hasUnsavedDocuments()).toBe(true)
    b.suspend()
    a.resume()
    const restored = a.documentStore.getState().ensureEditorView(tabId('tab-a'), file)
    expect(restored.buffer).toBe(viewA.buffer)
    expect(restored.view).toBe(viewA.view)
    expect(restored.buffer.materializeFullText()).toBe(textA)
    expect(a.documentStore.getState().scrollPositionByTabId[tabId('tab-a')]).toEqual({
      left: 2,
      top: 91,
    })
    restored.buffer.undo()
    expect(restored.buffer.materializeFullText()).toBe('saved')
    expect(a.hasUnsavedDocuments()).toBe(false)
    restored.buffer.redo()
    expect(restored.buffer.materializeFullText()).toBe(textA)
    expect(a.hasUnsavedDocuments()).toBe(true)
    expect(viewB.buffer.materializeFullText()).toBe(textB)
  } finally {
    a.dispose()
    b.dispose()
    queriesA.clear()
    queriesB.clear()
  }
})

test('document removal disposes its analysis and preserves externally held text and undo', async ({
  server,
  client,
}) => {
  const path = filesystemPath('released.ts')
  await writeFile(join(server.root, path), 'saved')
  const file = await fetchFile(path, new AbortController().signal, client)
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, 'http://localhost:7077', client)
  const runtime = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient,
    workspaceCache: readWorkspaceCache(testScopedStorage),
  })

  try {
    const document = runtime.documentStore.getState().ensureLiveEditorDocument(file)
    createEditorBufferSession(document.buffer).applyText(' edited')
    const release = vi.spyOn(document.analysis, 'dispose')
    runtime.documentStore.getState().deleteLiveEditorDocument(document.key)

    expect(release).toHaveBeenCalledOnce()
    expect(document.buffer.materializeFullText()).toBe('saved edited')
    document.buffer.undo()
    expect(document.buffer.materializeFullText()).toBe('saved')
    runtime.dispose()
    expect(release).toHaveBeenCalledOnce()
  } finally {
    runtime.dispose()
    queryClient.clear()
  }
})

test('final disposal releases shared prepared interests before analysis and preserves held buffers', async ({
  server,
  client,
}) => {
  const path = filesystemPath('disposed.ts')
  await writeFile(join(server.root, path), 'saved')
  const file = await fetchFile(path, new AbortController().signal, client)
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, 'http://localhost:7077', client)
  const runtime = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient,
    workspaceCache: readWorkspaceCache(testScopedStorage),
  })

  try {
    const document = runtime.documentStore.getState().ensureLiveEditorDocument(file)
    const prepared = createEditorPreparedDocument({
      analysis: document.analysis,
      buffer: document.buffer,
      documentId: document.key,
      configuredTabSize: 4,
      documentConfigurationTag: [],
      languageId: 'typescript',
      tabSizePolicy: 'fixed',
    })
    const claim = {
      buffer: document.buffer,
      documentKey: document.key,
      kind: 'live' as const,
      localRevision: document.localRevision,
      path,
      preparedDocument: prepared,
      snapshot: document.buffer.getSnapshot(),
    }
    runtime.documentStore
      .getState()
      .ensureEditorViewForDocument(tabId('first'), document.key, claim)
    runtime.documentStore
      .getState()
      .ensureEditorViewForDocument(tabId('second'), document.key, claim)
    createEditorBufferSession(document.buffer).applyText(' edited')
    runtime.documentStore.getState().markWorkspaceDocumentRecoveryConflict([path], 'final')
    const settings = runtime.documentStore
      .getState()
      .ensureSettingsDocument(settingsJsonDocument('user'), {
        content: '{}',
        revision: 'settings-v1',
      })
    const releasePrepared = vi.spyOn(prepared, 'dispose')
    const releaseAnalysis = vi.spyOn(document.analysis, 'dispose')
    const releaseSettings = vi.spyOn(settings.analysis, 'dispose')
    runtime.resume()
    runtime.suspend()
    expect(releasePrepared).not.toHaveBeenCalled()
    expect(releaseAnalysis).not.toHaveBeenCalled()

    runtime.dispose()
    runtime.dispose()

    expect(releasePrepared).toHaveBeenCalledOnce()
    expect(releaseAnalysis).toHaveBeenCalledOnce()
    expect(releaseSettings).toHaveBeenCalledOnce()
    expect(releasePrepared.mock.invocationCallOrder[0]).toBeLessThan(
      releaseAnalysis.mock.invocationCallOrder[0]!,
    )
    expect(runtime.documentStore.getState().liveDocumentsByKey).toEqual({})
    expect(runtime.documentStore.getState().viewsByTabId).toEqual({})
    expect(runtime.documentStore.getState().dirtyDocumentKeys.size).toBe(0)
    expect(document.buffer.materializeFullText()).toBe('saved edited')
    document.buffer.undo()
    expect(document.buffer.materializeFullText()).toBe('saved')
    expect(runtime.documentStore.getState().liveDocumentsByKey).toEqual({})
  } finally {
    runtime.dispose()
    queryClient.clear()
  }
})

test('blocks saving the same file during recovery and restores saving without replacing its buffer', async ({
  server,
  client,
}) => {
  const path = 'recovery.ts'
  await writeFile(join(server.root, path), 'saved')
  const file = await fetchFile(filesystemPath(path), new AbortController().signal, client)
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, 'http://localhost:7077', client)
  const runtime = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient,
    workspaceCache: readWorkspaceCache(testScopedStorage),
  })

  try {
    const view = runtime.documentStore.getState().ensureEditorView(tabId('recovery-tab'), file)
    createEditorBufferSession(view.buffer, view.view).applyText(' edited')
    runtime.documentStore
      .getState()
      .markWorkspaceDocumentRecoveryConflict([filesystemPath(path)], 'partial')

    await expect(runtime.saveService.save(testDocumentKey(path))).resolves.toBe(false)
    expect(await readFile(join(server.root, path), 'utf8')).toBe('saved')
    expect(
      runtime.documentStore.getState().getLiveEditorDocument(testDocumentKey(path))?.buffer,
    ).toBe(view.buffer)
    expect(view.buffer.isDirty()).toBe(true)

    runtime.documentStore.getState().clearWorkspaceDocumentRecoveryConflict('partial')
    await expect(runtime.saveService.save(testDocumentKey(path))).resolves.toBe(true)

    expect(await readFile(join(server.root, path), 'utf8')).toBe('saved edited')
    expect(
      runtime.documentStore.getState().getLiveEditorDocument(testDocumentKey(path))?.buffer,
    ).toBe(view.buffer)
    expect(runtime.documentStore.getState().getEditorView(tabId('recovery-tab'))?.view).toBe(
      view.view,
    )
    expect(
      runtime.documentStore.getState().getLiveEditorDocument(testDocumentKey(path))?.sync.kind,
    ).toBe('file')
    expect(view.buffer.isDirty()).toBe(false)
  } finally {
    runtime.dispose()
    queryClient.clear()
  }
})

test('finishes every A save and cache update on A after its first write is delayed across a switch to B', async ({
  server,
}) => {
  const serverB = await makeTestServer({ filesystemWatch: false })
  const previousClient = getClient()
  const deferredA = createDeferredFileWriteClient(server)
  const deferredB = createDeferredFileWriteClient(serverB)
  deferredB.release()
  const queriesA = new QueryClient()
  const queriesB = new QueryClient()
  registerEnvironmentQueryClient(queriesA, 'http://localhost:7077', deferredA.client)
  registerEnvironmentQueryClient(queriesB, 'http://localhost:7078', deferredB.client)
  const workspaceCache = readWorkspaceCache(testScopedStorage)
  const a = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queriesA,
    workspaceCache,
  })
  const b = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queriesB,
    workspaceCache,
  })
  const pathsA = ['first.ts', 'second.ts']
  const pathB = 'first.ts'

  try {
    await Promise.all([
      ...pathsA.map((path) => writeFile(join(server.root, path), 'A saved')),
      writeFile(join(serverB.root, pathB), 'B saved'),
    ])
    for (const path of pathsA) {
      const file = await fetchFile(
        filesystemPath(path),
        new AbortController().signal,
        deferredA.client,
      )
      const document = a.documentStore.getState().ensureLiveEditorDocument(file)
      createEditorBufferSession(document.buffer).applyText('edited ')
    }
    const fileB = await fetchFile(
      filesystemPath(pathB),
      new AbortController().signal,
      createInProcessClient(serverB),
    )
    const documentB = b.documentStore.getState().ensureLiveEditorDocument(fileB)
    createEditorBufferSession(documentB.buffer).applyText('unsaved ')
    const unsavedB = documentB.buffer.materializeFullText()
    a.resume()
    setClient(deferredA.client)
    const saving = a.saveService.saveMany(pathsA.map((path) => testDocumentKey(path)))
    await deferredA.firstWrite
    a.suspend()
    setClient(deferredB.client)
    b.resume()
    expect(a.hasUnsavedDocuments()).toBe(true)
    deferredA.release()
    await expect(saving).resolves.toEqual([true, true])

    expect(deferredA.writePaths).toEqual(pathsA)
    expect(deferredB.writePaths).toEqual([])
    for (const path of pathsA) {
      expect(await readFile(join(server.root, path), 'utf8')).toBe('A savededited ')
      expect(
        materializeFileSnapshotText(
          queriesA.getQueryData<FileSnapshot>(fileSystemKeys.fileSnapshot(path))!,
        ),
      ).toBe('A savededited ')
      expect(queriesB.getQueryData(fileSystemKeys.fileSnapshot(path))).toBeUndefined()
    }
    expect(await readFile(join(serverB.root, pathB), 'utf8')).toBe('B saved')
    expect(documentB.buffer.materializeFullText()).toBe(unsavedB)
    expect(b.hasUnsavedDocuments()).toBe(true)
    expect(a.hasUnsavedDocuments()).toBe(false)
    b.suspend()
    a.resume()
    expect(
      a.documentStore
        .getState()
        .getLiveEditorDocument(testDocumentKey(pathsA[0]!))
        ?.buffer.canUndo(),
    ).toBe(true)
  } finally {
    deferredA.release()
    setClient(previousClient)
    a.dispose()
    b.dispose()
    queriesA.clear()
    queriesB.clear()
    await serverB.cleanup()
  }
})

test('a trimmed snapshot stays released through unrelated query and workspace publication until explicit activation', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = new QueryClient()
  registerEnvironmentQueryClient(queries, 'http://localhost:7077', client)
  const runtime = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queries,
    workspaceCache: readWorkspaceCache(testScopedStorage),
  })
  const actions = createEditorApplyActions({
    activation: runtime.editorActivation,
    documentStore: runtime.documentStore,
    searchStore: runtime.searchBufferStore,
    uiStore: runtime.uiStore,
    workspaceStore: runtime.workspaceStore,
    retainedTextBudget: () => 10000000,
  })
  try {
    const key = blobDiffQueryOptions(f.comparison).queryKey
    const data = [f.worktree]
    queries.setQueryData(key, data)
    const workspaceAddress = await registerTestWorkspaceAddress(client, f.scope.rootPath)
    actions.switchRootFolder({
      workspaceAddress,
      birthtimeMs: 0,
      mtimeMs: 0,
      name: 'repo',
      path: f.scope.rootPath,
      size: 0,
      type: 'directory',
      version: '',
    })
    const content = documentTab({ kind: 'git-diff', source: f.comparison })
    actions.openTabContent(content)
    const [tab] = allEditorTabs(runtime.workspaceStore.getState().workbenchPanels.editorGroups)
    expect(tab).toBeDefined()
    if (!tab) return
    const documents = runtime.documentStore.getState()
    const lease = documents.snapshotComparisonTabs.get(tab.id)
    expect(lease?.read().kind).toBe('ready')
    documents.retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
    expect(lease?.read().kind).toBe('released')
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
    queries.setQueryData(['unrelated-query'], { settled: true })
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
    const workspace = runtime.workspaceStore.getState()
    workspace.setWorkbenchPanels({ ...workspace.workbenchPanels })
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
    actions.openTabContent(content)
    const renewed = runtime.documentStore.getState().snapshotComparisonTabs.get(tab.id)
    expect(renewed?.read().kind).toBe('ready')
    expect(renewed).not.toBe(lease)
    expect(queries.getQueryData(key)).toBe(data)
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(1)
  } finally {
    runtime.dispose()
    queries.clear()
  }
})

test('normal four-project navigation retains three snapshot interests and explicit revisit reacquires warm data', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = new QueryClient()
  registerEnvironmentQueryClient(queries, 'http://localhost:7077', client)
  const runtime = createEditorRuntime({
    storage: testScopedStorage,
    preparation,
    queryClient: queries,
    workspaceCache: readWorkspaceCache(testScopedStorage),
  })
  const actions = createEditorApplyActions({
    activation: runtime.editorActivation,
    documentStore: runtime.documentStore,
    searchStore: runtime.searchBufferStore,
    uiStore: runtime.uiStore,
    workspaceStore: runtime.workspaceStore,
    retainedTextBudget: () => 10000000,
  })
  const root = { birthtimeMs: 0, mtimeMs: 0, size: 0, type: 'directory' as const, version: '' }
  const firstAddress = await registerTestWorkspaceAddress(client, f.scope.rootPath)
  try {
    for (const [index, name] of ['repo', 'repo-2', 'repo-3', 'repo-4'].entries()) {
      if (index > 0)
        await cp(join(server.root, 'repo'), join(server.root, name), { recursive: true })
      const [diff] = await fetchDiff(`${name}/source.ts`, false, undefined, client)
      expect(diff).toBeDefined()
      if (!diff) return
      const target = snapshotDocument(diff)
      expect(target).not.toBeNull()
      if (!target || target.source.kind !== 'snapshot') return
      queries.setQueryData(blobDiffQueryOptions(target.source).queryKey, [diff])
      const path = filesystemPath(name)
      const workspaceAddress = await registerTestWorkspaceAddress(client, path)
      actions.switchRootFolder({ ...root, workspaceAddress, name, path })
      if (index === 3) expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(2)
      actions.openTabContent(documentTab(target))
      expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(Math.min(index + 1, 3))
    }
    expect(runtime.workspaceStore.getState().parkedWorkspaces.size).toBe(3)
    const retained = [...runtime.documentStore.getState().snapshotComparisons.values()]
    expect(
      retained.flatMap((read) =>
        read.kind === 'ready'
          ? [{ scope: read.input.scope, path: read.input.comparison.path }]
          : [],
      ),
    ).toEqual(
      ['repo-2', 'repo-3', 'repo-4'].map((rootPath) => ({
        scope: { ...f.scope, rootPath },
        path: `${rootPath}/source.ts`,
      })),
    )
    const firstKey = blobDiffQueryOptions(f.comparison).queryKey
    const warmData = queries.getQueryData(firstKey)
    expect(warmData).toBeDefined()
    actions.switchRootFolder({
      ...root,
      workspaceAddress: firstAddress,
      name: 'repo',
      path: f.scope.rootPath,
    })
    const [selected] = allEditorTabs(runtime.workspaceStore.getState().workbenchPanels.editorGroups)
    const read =
      selected && runtime.documentStore.getState().snapshotComparisonTabs.get(selected.id)?.read()
    expect(read?.kind).toBe('ready')
    if (read?.kind === 'ready') {
      expect(read.input.scope).toEqual(f.scope)
      expect(read.input.comparison).toEqual(f.comparison)
    }
    expect(queries.getQueryData(firstKey)).toBe(warmData)
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(3)
  } finally {
    runtime.dispose()
    queries.clear()
  }
})
