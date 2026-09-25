import { activeEditorTab as selectedGroupTab } from '@/lib/documents/utils/groups'
import { getClient } from '@/lib/client'
import { testDocumentKey, testTabContent } from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { act, renderHook, waitFor } from '@testing-library/react'
import { matchMutation } from '@tanstack/react-query'
import { FileTreeModel } from '@workspace/tree'
import { open } from 'node:fs/promises'
import path from 'node:path'
import type { ReactNode } from 'react'
import { createEditorBufferSession } from '@singapore-editor/core/document'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { useFsActions } from '@/features/workspace/hooks/use-fs-actions'
import {
  fileOperationDocuments,
  fileOperationHistoryQuery,
  reverseLatestFileOperation,
  type FileOperationRuntime,
} from '@/features/workspace/state/file-operations'
import {
  createFileContent,
  ensureFolderPath,
  fetchFile,
  fetchTree,
  statPath,
} from '@/lib/file-server'
import type { TreeEntry } from '@/lib/file-system-types'
import { treeModel } from '@/lib/tree-model'
import { fileOperationWriteId } from '@workspace/contracts'
import {
  projectedTreeModel,
  resetTreeIntents,
  treeIntents,
} from '@/features/workspace/state/tree-intents'

import { expect, test } from '../../../../test/fixtures'
import { AppProviders, createTestQueryClient } from '../../../../test/render'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fileSystemKeys } from '@/lib/query-keys'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'

for (const { isFolder, dirty } of [
  { isFolder: false, dirty: false },
  { isFolder: false, dirty: true },
  { isFolder: true, dirty: true },
]) {
  test(`open tabs follow a tree rename and its undo, directory: ${isFolder}, dirty: ${dirty}`, async ({
    client,
  }) => {
    void client
    await ensureFolderPath(filesystemPath('repo/src'), getClient())
    const from = 'repo/src/a.ts'
    const to = isFolder ? 'repo/renamed/a.ts' : 'repo/src/b.ts'
    await createFileContent(filesystemPath(from), 'original\n', getClient())
    const sibling = 'repo/src/c.ts'
    const unrelated = 'repo/src-other.ts'
    await createFileContent(filesystemPath(sibling), 'sibling\n', getClient())
    await createFileContent(filesystemPath(unrelated), 'unrelated\n', getClient())
    const file = await fetchFile(filesystemPath(from), signal(), getClient())
    const harness = await renderFsActions('repo')
    const { documentStore, workspaceStore } = harness.result.current.runtime
    setFileSnapshotQueryData(harness.queryClient, file)
    await act(async () => {
      await harness.result.current.commands.openFileSurface(filesystemPath(sibling))
      await harness.result.current.commands.openFileSurface(filesystemPath(unrelated))
      await harness.result.current.commands.openFileSurface(filesystemPath(from))
    })
    const tabId = (selectedGroupTab(workspaceStore.getState().workbenchPanels.editorGroups)?.id ??
      null)!
    const view = documentStore.getState().ensureEditorView(tabId, file)
    if (dirty) act(() => createEditorBufferSession(view.buffer, view.view).applyText('unsaved\n'))
    const text = view.buffer.materializeFullText()

    await runJournaled(harness, 1, () =>
      harness.result.current.completeRename({
        sourcePath: isFolder ? 'src' : 'src/a.ts',
        destinationPath: isFolder ? 'renamed' : 'src/b.ts',
        isFolder,
      }),
    )

    expect(workspaceStore.getState().selectedTabContent).toEqual(testTabContent(to))
    expect(workspaceStore.getState().openTabContents).toEqual(
      [isFolder ? 'repo/renamed/c.ts' : sibling, unrelated, to].map((path) => testTabContent(path)),
    )
    expect(workspaceStore.getState().editorHistory).toContainEqual(testTabContent(to))
    expect(workspaceStore.getState().editorHistory).not.toContainEqual(testTabContent(from))
    expect(
      selectedGroupTab(workspaceStore.getState().workbenchPanels.editorGroups)?.id ?? null,
    ).toBe(tabId)
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(from))).toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(to))?.buffer).toBe(
      view.buffer,
    )
    expect(view.buffer.materializeFullText()).toBe(text)
    expect(documentStore.getState().dirtyDocumentKeys.has(testDocumentKey(to))).toBe(dirty)
    expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(from))).toBeUndefined()
    expect(harness.queryClient.getQueryData(fileSystemKeys.fileSnapshot(to))).toMatchObject({
      path: to,
    })
    await expect(readContent(to)).resolves.toBe('original\n')
    await expect(treePaths('repo')).resolves.not.toContain(from)

    await act(async () => {
      expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
    })
    expect(workspaceStore.getState().selectedTabContent).toEqual(testTabContent(from))
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(from))?.buffer).toBe(
      view.buffer,
    )
    expect(view.buffer.materializeFullText()).toBe(text)
    expect(documentStore.getState().dirtyDocumentKeys.has(testDocumentKey(from))).toBe(dirty)
    await expect(readContent(from)).resolves.toBe('original\n')

    await act(async () => {
      expect(await reverseLatestFileOperation(harness.fileOperations(), 'redo')).toBe(true)
    })
    expect(workspaceStore.getState().selectedTabContent).toEqual(testTabContent(to))
    await act(async () => {
      expect(await harness.result.current.runtime.saveService.save(testDocumentKey(to))).toBe(true)
    })
    await expect(readContent(to)).resolves.toBe(text)

    harness.cleanUp()
  })
}

test('journals create, rename, duplicate and delete as one undoable operation each', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/rename.ts'), 'rename\n', getClient())
  await createFileContent(filesystemPath('repo/copy.ts'), 'copy\n', getClient())
  await createFileContent(filesystemPath('repo/delete.ts'), 'delete\n', getClient())
  const harness = await renderFsActions('repo')

  await runJournaled(harness, 1, () => {
    harness.result.current.actions.createEntry('', false)
    harness.result.current.completeRename({
      destinationPath: 'created.ts',
      isFolder: false,
      sourcePath: 'untitled',
    })
  })
  await runJournaled(harness, 2, () => {
    harness.result.current.completeRename({
      destinationPath: 'renamed.ts',
      isFolder: false,
      sourcePath: 'rename.ts',
    })
  })
  await runJournaled(harness, 3, () =>
    harness.result.current.actions.duplicateEntry('copy.ts', false),
  )
  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: false,
      name: 'delete.ts',
      path: filesystemPath('repo/delete.ts'),
    })
  })
  await waitFor(() => expect(harness.result.current.deleteDialog.target).not.toBeNull())
  await runJournaled(harness, 4, () => harness.result.current.deleteDialog.onConfirm())

  const history = await harness.history()
  expect(history.undo.map((entry) => entry.label)).toEqual([
    'Delete delete.ts',
    'Duplicate copy.ts',
    'Rename rename.ts to renamed.ts',
    'New file created.ts',
  ])
  await expect(readContent('repo/created.ts')).resolves.toBe('')
  await expect(readContent('repo/renamed.ts')).resolves.toBe('rename\n')
  await expect(readContent('repo/copy copy.ts')).resolves.toBe('copy\n')
  await expect(treePaths('repo')).resolves.not.toContain('repo/delete.ts')

  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
    })
  }
  await expect(treePaths('repo')).resolves.toEqual([
    'repo/copy.ts',
    'repo/delete.ts',
    'repo/rename.ts',
  ])
  await expect(readContent('repo/delete.ts')).resolves.toBe('delete\n')
  expect((await harness.history()).redo).toHaveLength(4)

  harness.cleanUp()
})

test('a dragged selection moves as one operation and a deleted folder comes back whole', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo/target'), getClient())
  await ensureFolderPath(filesystemPath('repo/two'), getClient())
  await createFileContent(filesystemPath('repo/one.ts'), 'one\n', getClient())
  await createFileContent(filesystemPath('repo/two/nested.ts'), 'nested\n', getClient())
  const harness = await renderFsActions('repo')

  await runJournaled(harness, 1, () =>
    harness.result.current.actions.moveEntries([
      { fromTreePath: 'one.ts', toTreePath: 'target/one.ts' },
      { fromTreePath: 'two', toTreePath: 'target/two' },
    ]),
  )
  expect((await harness.history()).undo[0]).toMatchObject({
    label: 'Move 2 items into target',
    legs: [
      { kind: 'rename', newPath: 'target/one.ts', oldPath: 'one.ts' },
      { kind: 'rename', newPath: 'target/two', oldPath: 'two' },
    ],
  })
  await expect(readContent('repo/target/two/nested.ts')).resolves.toBe('nested\n')

  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: true,
      name: 'target',
      path: filesystemPath('repo/target'),
    })
  })
  await runJournaled(harness, 2, () => harness.result.current.deleteDialog.onConfirm())
  await expect(treePaths('repo')).resolves.not.toContain('repo/target')

  await act(async () => {
    expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
  })
  await expect(readContent('repo/target/one.ts')).resolves.toBe('one\n')
  await expect(readContent('repo/target/two/nested.ts')).resolves.toBe('nested\n')
  await act(async () => {
    expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
  })
  await expect(readContent('repo/one.ts')).resolves.toBe('one\n')
  await expect(readContent('repo/two/nested.ts')).resolves.toBe('nested\n')

  harness.cleanUp()
})

test('withdraws the projected rename when the journal refuses an occupied destination', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/old.ts'), 'old\n', getClient())
  const harness = await renderFsActions('repo')
  // Lands after the tree loaded, so the tree still thinks the name is free.
  await createFileContent(filesystemPath('repo/new.ts'), 'someone else\n', getClient())
  const rootPath = filesystemPath('repo')

  act(() => {
    harness.result.current.completeRename({
      destinationPath: 'new.ts',
      isFolder: false,
      sourcePath: 'old.ts',
    })
  })

  await waitFor(() => expect(harness.queryClient.isMutating()).toBe(0))
  expect(treeIntents.getState().active).toHaveLength(0)
  expect(treeIntents.getState().failed).toHaveLength(0)
  expect(projectedTreeModel(harness.model, rootPath)).toBe(harness.model)
  await expect(readContent('repo/old.ts')).resolves.toBe('old\n')
  await expect(readContent('repo/new.ts')).resolves.toBe('someone else\n')
  expect((await harness.history()).undo).toEqual([])

  harness.cleanUp()
})

test('a delete too large to undo asks again before deleting permanently', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo/big'), getClient())
  await createFileContent(filesystemPath('repo/big/small.ts'), 'small\n', getClient())
  const sparse = await open(path.join(server.root, 'repo/big/sparse.bin'), 'w')
  await sparse.truncate(129 * 1024 * 1024)
  await sparse.close()
  const harness = await renderFsActions('repo')

  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: true,
      name: 'big',
      path: filesystemPath('repo/big'),
    })
  })
  act(() => harness.result.current.deleteDialog.onConfirm())
  await waitFor(() => expect(harness.result.current.deleteDialog.permanent).toBe(true))
  await expect(readContent('repo/big/small.ts')).resolves.toBe('small\n')
  expect(harness.result.current.deleteDialog.target).not.toBeNull()

  act(() => harness.result.current.deleteDialog.onConfirm())
  await waitFor(async () => expect(await treePaths('repo')).not.toContain('repo/big'))
  expect((await harness.history()).undo).toEqual([])

  harness.cleanUp()
})

test('an undo survives a history refresh cancelling its read', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/old.ts'), 'old\n', getClient())
  const harness = await renderFsActions('repo')
  await runJournaled(harness, 1, () =>
    harness.result.current.completeRename({
      destinationPath: 'new.ts',
      isFolder: false,
      sourcePath: 'old.ts',
    }),
  )
  const historyKey = fileSystemKeys.fileOperationHistory('repo')
  // As after a reload: nothing cached, so a cancelled read has no older answer to fall back on.
  harness.queryClient.removeQueries({ queryKey: historyKey })
  let cancelled = false
  // What another window's event does: a fresher read replaces the one the undo is waiting on.
  const unsubscribe = harness.queryClient.getQueryCache().subscribe((event) => {
    if (cancelled || event.type !== 'updated' || event.action.type !== 'fetch') return
    if (event.query.queryHash !== JSON.stringify(historyKey)) return
    cancelled = true
    // After the dispatch: the read it announces starts only once this listener returns.
    queueMicrotask(() => void harness.queryClient.cancelQueries({ queryKey: historyKey }))
  })

  await act(async () => {
    expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
  })
  unsubscribe()
  expect(cancelled).toBe(true)
  await expect(readContent('repo/old.ts')).resolves.toBe('old\n')

  harness.cleanUp()
})

test('a window claims the events of its own transitions and no others', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/old.ts'), 'old\n', getClient())
  const harness = await renderFsActions('repo')
  await runJournaled(harness, 1, () =>
    harness.result.current.completeRename({
      destinationPath: 'new.ts',
      isFolder: false,
      sourcePath: 'old.ts',
    }),
  )
  const [moved] = (await harness.history()).undo
  await act(async () => {
    expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
  })
  const [undone] = (await harness.history()).redo
  const service = harness.result.current.runtime.workspaceEditService

  // A late event from this window's own move must not move the document back after the undo.
  expect(service.isOwnEvent(fileOperationWriteId(moved!.operationId, moved!.generation))).toBe(true)
  expect(service.isOwnEvent(fileOperationWriteId(undone!.operationId, undone!.generation))).toBe(
    true,
  )
  // Another window's redo of the same operation is not this window's to ignore.
  expect(
    service.isOwnEvent(fileOperationWriteId(undone!.operationId, undone!.generation + 2)),
  ).toBe(false)

  harness.cleanUp()
})

test('deleting an open file orphans its document here and undo brings it back', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo/dir'), getClient())
  await createFileContent(filesystemPath('repo/dir/open.ts'), 'open\n', getClient())
  const file = await fetchFile(filesystemPath('repo/dir/open.ts'), signal(), getClient())
  const harness = await renderFsActions('repo')
  const { documentStore, workspaceStore } = harness.result.current.runtime
  setFileSnapshotQueryData(harness.queryClient, file)
  await act(async () => {
    await harness.result.current.commands.openFileSurface(file.path)
  })
  const tabId = selectedGroupTab(workspaceStore.getState().workbenchPanels.editorGroups)!.id
  documentStore.getState().ensureEditorView(tabId, file)
  const orphaned = () => {
    const document = documentStore.getState().getLiveEditorDocument(testDocumentKey(file.path))
    return document?.sync.kind === 'file' && document.sync.orphaned
  }

  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: true,
      name: 'dir',
      path: filesystemPath('repo/dir'),
    })
  })
  await runJournaled(harness, 1, () => harness.result.current.deleteDialog.onConfirm())
  await waitFor(() => expect(orphaned()).toBe(true))

  await act(async () => {
    expect(await reverseLatestFileOperation(harness.fileOperations(), 'undo')).toBe(true)
  })
  expect(orphaned()).toBe(false)
  await expect(readContent('repo/dir/open.ts')).resolves.toBe('open\n')

  harness.cleanUp()
})

test('saved rows cannot start mutations until the tree is confirmed', async ({ client }) => {
  await ensureFolderPath(filesystemPath('repo'), client)
  const harness = await renderFsActions('repo')
  harness.queryClient.removeQueries({ queryKey: fileSystemKeys.tree('repo') })
  harness.rerender()
  expect(harness.result.current.actions.mutationsEnabled).toBe(false)
  act(() => harness.result.current.actions.createEntry('', false))
  expect(harness.tree.getItem('untitled')).toBeNull()
  harness.queryClient.setQueryData(fileSystemKeys.tree('repo'), harness.model)
  harness.rerender()
  expect(harness.result.current.actions.mutationsEnabled).toBe(true)
  harness.cleanUp()
})

async function renderFsActions(rootPath: string) {
  // The queue is global; an earlier test's unacknowledged intents must not leak in.
  resetTreeIntents()
  const model = treeModel(
    await fetchTree(filesystemPath(rootPath), signal(), getClient()),
    rootPath,
  )
  const tree = new FileTreeModel({ paths: model.paths, renaming: true })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(fileSystemKeys.tree(rootPath), model)

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>{children}</TestEditorStateProvider>
      </AppProviders>
    )
  }

  const modelRef = { current: model }
  const treeRef = { current: tree }
  const hook = renderHook(
    () => ({
      ...useFsActions({ modelRef, rootPath: filesystemPath(rootPath), treeRef }),
      commands: useEditorCommands(),
      runtime: useEditorRuntime(),
    }),
    { wrapper: Wrapper },
  )
  const root = await statPath(filesystemPath(rootPath), signal(), getClient())
  const workspaceAddress = await registerTestWorkspaceAddress(getClient(), rootPath)
  act(() =>
    hook.result.current.runtime.workspaceStore
      .getState()
      .switchWorkspace({ ...root, name: rootPath, type: 'directory', workspaceAddress }),
  )

  function fileOperations(): FileOperationRuntime {
    const { commands, runtime } = hook.result.current
    return {
      documents: fileOperationDocuments({
        documentStore: runtime.documentStore,
        queryClient,
        renameLiveEditorDocument: commands.renameLiveEditorDocument,
        workspaceStore: runtime.workspaceStore,
      }),
      queryClient,
      rootPath: filesystemPath(rootPath),
      workspaceEdits: runtime.workspaceEditService,
    }
  }

  return {
    ...hook,
    fileOperations,
    history: () =>
      queryClient.query(fileOperationHistoryQuery(queryClient, filesystemPath(rootPath))),
    model,
    queryClient,
    rootPath: filesystemPath(rootPath),
    cleanUp: () => {
      hook.unmount()
      queryClient.clear()
      tree.cleanUp()
    },
    tree,
  }
}

/**
 * Runs a tree action and waits for its journaled operation to settle. Polling the history on a
 * deadline fails on a slow disk: the journal fsyncs every step.
 */
async function runJournaled(
  harness: Awaited<ReturnType<typeof renderFsActions>>,
  count: number,
  action: () => void,
) {
  const mutations = harness.queryClient.getMutationCache()
  const operation = { mutationKey: workspaceMutationKeys.fileOperation(harness.rootPath) }
  const settled = Promise.withResolvers<void>()
  let started = false
  const unsubscribe = mutations.subscribe((event) => {
    if (event.type === 'added' && matchMutation(treeIntent, event.mutation)) started = true
    if (event.type !== 'updated' || !matchMutation(operation, event.mutation)) return
    if (event.action.type === 'success' || event.action.type === 'error') settled.resolve()
  })
  try {
    await act(async () => {
      action()
      // A tree action that mutations do not allow returns silently; fail here, not on a hang.
      expect(started, 'the action started no tree intent').toBe(true)
      await settled.promise
    })
  } finally {
    unsubscribe()
  }
  expect((await harness.history()).undo).toHaveLength(count)
}

const treeIntent = { mutationKey: ['workspace', 'tree'] }

async function readContent(path: string) {
  const result = await fetchFile(filesystemPath(path), signal(), getClient())
  return result.content
}

async function treePaths(path: string) {
  const result = await fetchTree(filesystemPath(path), signal(), getClient())
  return flattenedPaths(result.entries)
}

function flattenedPaths(entries: readonly TreeEntry[]) {
  const paths: string[] = []
  for (const entry of entries) {
    paths.push(entry.path)
    if (!entry.children) continue

    paths.push(...flattenedPaths(entry.children))
  }
  return paths
}

function signal() {
  return new AbortController().signal
}
