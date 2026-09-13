import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { documentTab } from '@/lib/documents/utils/tabs'
import type { StandaloneDocumentRef } from '@/lib/documents/utils/types'
import { testDocumentKey } from '../../../../test/factories/document-targets'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createEditorBufferSession } from '@singapore-editor/core'
import { QueryClient } from '@tanstack/react-query'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createEditorRuntime } from '@/features/editor/state/runtime'
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

const preparation = {
  appliedThemeContentHash: null,
  appliedThemeId: null,
  selectedThemeId: 'dark',
  syntaxHighlightingEnabled: false,
}

const preparationPath = filesystemPath('repo/review.ts')

test.for([
  { kind: 'git-ref', source: { path: preparationPath, ref: 'HEAD' } },
  { kind: 'git-diff', source: { kind: 'snapshot', path: preparationPath } },
  { kind: 'compare-saved', file: { path: preparationPath } },
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

    try {
      runtime.workspaceStore.getState().switchWorkspace({
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
      expect(queriesA.getQueryData(fileSystemKeys.fileSnapshot(path))).toMatchObject({
        content: 'A savededited ',
      })
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
