import { getClient } from '@/lib/client'
import { testDocumentKey, testTabContent } from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { act, renderHook, waitFor } from '@testing-library/react'
import { FileTreeModel } from '@workspace/tree'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { createEditorBufferSession } from '@singapor/core'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { WorkspaceEditServiceContext } from '@/features/editor/providers/workspace-edit-context'
import type { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { useFsActions } from '@/features/workspace/hooks/use-fs-actions'
import { createFileContent, ensureFolderPath, fetchFile, fetchTree } from '@/lib/file-server'
import type { TreeEntry } from '@/lib/file-system-types'
import { createClientError } from '@workspace/client-core/errors'
import { treeModel } from '@/lib/tree-model'

import { expect, test } from '../../../../test/fixtures'
import { AppProviders, createTestQueryClient } from '../../../../test/render'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import { fileSystemKeys } from '@/lib/query-keys'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'

for (const { isFolder, dirty } of [
  { isFolder: false, dirty: false },
  { isFolder: false, dirty: true },
  { isFolder: true, dirty: true },
]) {
  test(`retargets open tabs after a tree rename, directory: ${isFolder}, dirty: ${dirty}`, async ({
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
    const modelRef = {
      current: treeModel(await fetchTree(filesystemPath('repo'), signal(), getClient()), 'repo'),
    }
    const treeRef = {
      current: new FileTreeModel({ paths: modelRef.current.paths, renaming: true }),
    }
    const queryClient = createTestQueryClient()
    function Wrapper({ children }: { readonly children: ReactNode }) {
      return (
        <AppProviders queryClient={queryClient}>
          <TestEditorStateProvider>{children}</TestEditorStateProvider>
        </AppProviders>
      )
    }
    const hook = renderHook(
      () => ({
        commands: useEditorCommands(),
        fs: useFsActions({ modelRef, rootPath: filesystemPath('repo'), treeRef }),
        runtime: useEditorRuntime(),
      }),
      { wrapper: Wrapper },
    )
    const { documentStore, workspaceStore } = hook.result.current.runtime
    setFileSnapshotQueryData(queryClient, file)
    await act(async () => {
      await hook.result.current.commands.openFileSurface(filesystemPath(sibling))
      await hook.result.current.commands.openFileSurface(filesystemPath(unrelated))
      await hook.result.current.commands.openFileSurface(filesystemPath(from))
    })
    const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
    const view = documentStore.getState().ensureEditorView(tabId, file)
    if (dirty) act(() => createEditorBufferSession(view.buffer, view.view).applyText('unsaved\n'))
    const text = view.buffer.materializeFullText()

    act(() =>
      hook.result.current.fs.completeRename({
        sourcePath: isFolder ? 'src' : 'src/a.ts',
        destinationPath: isFolder ? 'renamed' : 'src/b.ts',
        isFolder,
      }),
    )

    await waitFor(() =>
      expect(workspaceStore.getState().selectedTabContent).toEqual(testTabContent(to)),
    )
    expect(workspaceStore.getState().openTabContents).toEqual(
      [isFolder ? 'repo/renamed/c.ts' : sibling, unrelated, to].map((path) => testTabContent(path)),
    )
    expect(workspaceStore.getState().editorHistory).toContainEqual(testTabContent(to))
    expect(workspaceStore.getState().editorHistory).not.toContainEqual(testTabContent(from))
    expect(workspaceStore.getState().workbenchPanels.activeEditorTabId).toBe(tabId)
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(from))).toBeNull()
    expect(documentStore.getState().getLiveEditorDocument(testDocumentKey(to))?.buffer).toBe(
      view.buffer,
    )
    expect(view.buffer.materializeFullText()).toBe(text)
    expect(documentStore.getState().dirtyDocumentKeys.has(testDocumentKey(to))).toBe(dirty)
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(from))).toBeUndefined()
    expect(queryClient.getQueryData(fileSystemKeys.fileSnapshot(to))).toMatchObject({ path: to })
    await expect(readContent(to)).resolves.toBe('original\n')
    await act(async () => {
      expect(await hook.result.current.runtime.saveService.save(testDocumentKey(to))).toBe(true)
    })
    await expect(readContent(to)).resolves.toBe(text)
    await expect(treePaths('repo')).resolves.not.toContain(from)

    hook.unmount()
    treeRef.current.cleanUp()
    queryClient.clear()
  })
}

test('gates file create, rename, copy, and delete with their exact mutated paths', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/rename.ts'), 'rename\n', getClient())
  await createFileContent(filesystemPath('repo/copy.ts'), 'copy\n', getClient())
  await createFileContent(filesystemPath('repo/delete.ts'), 'delete\n', getClient())
  const harness = await renderFsActions('repo')

  act(() => {
    harness.result.current.actions.createEntry('', false)
    harness.result.current.completeRename({
      destinationPath: 'created.ts',
      isFolder: false,
      sourcePath: 'untitled',
    })
  })
  await harness.service.waitForSettled(1)

  act(() => {
    harness.result.current.completeRename({
      destinationPath: 'renamed.ts',
      isFolder: false,
      sourcePath: 'rename.ts',
    })
  })
  await harness.service.waitForSettled(2)

  act(() => harness.result.current.actions.duplicateEntry('copy.ts', false))
  await harness.service.waitForSettled(3)

  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: false,
      name: 'delete.ts',
      path: filesystemPath('repo/delete.ts'),
    })
  })
  await waitFor(() => expect(harness.result.current.deleteDialog.target).not.toBeNull())
  act(() => harness.result.current.deleteDialog.onConfirm())
  await harness.service.waitForSettled(4)

  expect(harness.service.affectedPaths).toEqual([
    ['repo/created.ts'],
    ['repo/rename.ts', 'repo/renamed.ts'],
    ['repo/copy copy.ts'],
    ['repo/delete.ts'],
  ])
  await expect(readContent('repo/created.ts')).resolves.toBe('')
  await expect(readContent('repo/renamed.ts')).resolves.toBe('rename\n')
  await expect(readContent('repo/copy copy.ts')).resolves.toBe('copy\n')
  await expect(treePaths('repo')).resolves.not.toContain('repo/delete.ts')

  harness.cleanUp()
})

test('invalidates all workspace-edit history for directory tree mutations', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo/rename-dir'), getClient())
  await ensureFolderPath(filesystemPath('repo/copy-dir'), getClient())
  await ensureFolderPath(filesystemPath('repo/delete-dir'), getClient())
  await createFileContent(filesystemPath('repo/rename-dir/a.ts'), 'rename\n', getClient())
  await createFileContent(filesystemPath('repo/copy-dir/a.ts'), 'copy\n', getClient())
  await createFileContent(filesystemPath('repo/delete-dir/a.ts'), 'delete\n', getClient())
  const harness = await renderFsActions('repo')

  act(() => {
    harness.result.current.completeRename({
      destinationPath: 'renamed-dir',
      isFolder: true,
      sourcePath: 'rename-dir',
    })
  })
  await harness.service.waitForSettled(1)

  act(() => harness.result.current.actions.duplicateEntry('copy-dir', true))
  await harness.service.waitForSettled(2)

  act(() => {
    harness.result.current.actions.requestDelete({
      isDirectory: true,
      name: 'delete-dir',
      path: filesystemPath('repo/delete-dir'),
    })
  })
  await waitFor(() => expect(harness.result.current.deleteDialog.target).not.toBeNull())
  act(() => harness.result.current.deleteDialog.onConfirm())
  await harness.service.waitForSettled(3)

  expect(harness.service.affectedPaths).toEqual(['all', 'all', 'all'])
  await expect(readContent('repo/renamed-dir/a.ts')).resolves.toBe('rename\n')
  await expect(readContent('repo/copy-dir copy/a.ts')).resolves.toBe('copy\n')
  await expect(treePaths('repo')).resolves.not.toContain('repo/delete-dir')

  harness.cleanUp()
})

test('keeps optimistic rollback when the authoritative mutation reservation rejects', async ({
  client,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/old.ts'), 'old\n', getClient())
  const service = new RecordingWorkspaceEditService({ reject: true })
  const harness = await renderFsActions('repo', service)
  const file = await fetchFile(filesystemPath('repo/old.ts'), signal(), getClient())
  setFileSnapshotQueryData(harness.queryClient, file)
  act(() => harness.result.current.commands.openFileSurface(file.path))
  const { documentStore, workspaceStore } = harness.result.current.runtime
  const tabId = workspaceStore.getState().workbenchPanels.activeEditorTabId!
  const view = documentStore.getState().ensureEditorView(tabId, file)
  harness.tree.move('old.ts', 'new.ts')
  const move = vi.spyOn(harness.tree, 'move')

  act(() => {
    harness.result.current.completeRename({
      destinationPath: 'new.ts',
      isFolder: false,
      sourcePath: 'old.ts',
    })
  })

  await waitFor(() => expect(move).toHaveBeenCalledWith('new.ts', 'old.ts'))
  expect(service.affectedPaths).toEqual([['repo/old.ts', 'repo/new.ts']])
  expect(workspaceStore.getState().selectedTabContent).toEqual(testTabContent('repo/old.ts'))
  expect(
    documentStore.getState().getLiveEditorDocument(testDocumentKey('repo/old.ts'))?.buffer,
  ).toBe(view.buffer)
  expect(documentStore.getState().getLiveEditorDocument(testDocumentKey('repo/new.ts'))).toBeNull()
  await expect(readContent('repo/old.ts')).resolves.toBe('old\n')
  await expect(treePaths('repo')).resolves.not.toContain('repo/new.ts')

  harness.cleanUp()
})

async function renderFsActions(rootPath: string, service = new RecordingWorkspaceEditService()) {
  const model = treeModel(
    await fetchTree(filesystemPath(rootPath), signal(), getClient()),
    rootPath,
  )
  const tree = new FileTreeModel({ paths: model.paths, renaming: true })
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>
          <WorkspaceEditServiceContext value={service.asService()}>
            {children}
          </WorkspaceEditServiceContext>
        </TestEditorStateProvider>
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

  return {
    ...hook,
    queryClient,
    cleanUp: () => {
      hook.unmount()
      queryClient.clear()
      tree.cleanUp()
    },
    service,
    tree,
  }
}

class RecordingWorkspaceEditService {
  readonly affectedPaths: Array<readonly string[] | 'all'> = []
  readonly canMutateWorkspace = () => true
  readonly subscribe = () => () => undefined
  #settled = 0
  readonly #reject: boolean

  constructor({ reject = false }: { readonly reject?: boolean } = {}) {
    this.#reject = reject
  }

  asService() {
    return this as unknown as WorkspaceEditService
  }

  async runWorkspaceMutation<T>(
    affectedPaths: readonly string[] | 'all',
    operation: () => Promise<T>,
  ): Promise<T> {
    this.affectedPaths.push(affectedPaths)
    if (this.#reject) throw busyError()

    const result = await operation()
    this.#settled += 1
    return result
  }

  async waitForSettled(count: number) {
    await waitFor(() => expect(this.#settled).toBe(count))
  }
}

function busyError() {
  return createClientError({
    code: 'workspace-edit-busy',
    fix: 'Retry after the active workspace mutation finishes.',
    message: 'Another workspace mutation is active',
    status: 409,
    why: 'The workspace mutation coordinator is already reserved.',
  })
}

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
