import { act, waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Button } from '@workspace/ui/components/button'

import { useSearchBufferRuntime } from '@/features/search/hooks/use-buffer-runtime'
import { useWorkspaceSearchReplace } from '@/features/search/hooks/use-replace'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile, statPath } from '@/lib/file-server'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { textChangePreview } from '../../../../test/factories/workspace-text-changes'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const initial = 'export const renameMe = 1\n'
const dirtyComment = '// dirty\n'
const paths = ['a.ts', 'b.ts', 'c.ts']

test('invalidates Search before WorkspaceEdit Undo resolves and retains restored disk matches', async ({
  server,
  client,
}) => {
  await Promise.all(paths.map((path) => writeFile(join(server.root, path), initial)))
  const signal = new AbortController().signal
  const root = await statPath(filesystemPath(''), signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  const [fileA, fileB] = await Promise.all([
    fetchFile(filesystemPath('a.ts'), signal, client),
    fetchFile(filesystemPath('b.ts'), signal, client),
  ])
  const application = createTestApplicationRuntime()
  const { editor, queryClient } = application.getSnapshot()
  const search = editor.searchBufferStore
  editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const a = editor.documentStore.getState().ensureLiveEditorDocument(fileA)
  const b = editor.documentStore.getState().ensureLiveEditorDocument(fileB)
  createEditorBufferSession(a.buffer).applyText(dirtyComment)
  search.getState().setQuery('', 'renameMe')
  search.getState().setReplaceText('', 'renamedValue')
  const view = renderWithProviders(
    <TestEditorStateProvider>
      <SearchControl />
    </TestEditorStateProvider>,
    { application, queryClient },
  )
  try {
    const replace = await view.findByRole('button', { name: 'Replace all' })
    await waitForMatches(search, 3)
    expect(replace).toBeEnabled()
    act(() => replace.click())
    const operationId = await textChangePreview(editor.workspaceEditService)
    act(() => editor.workspaceEditService.confirmPreview(operationId))
    await waitFor(() => expect(search.getState().active?.replaceStatus).toBe('success'))
    await waitForMatches(search, 0)
    const replacedRevision = search.getState().active?.searchRevision ?? 0

    await act(async () => {
      expect(await editor.workspaceEditService.undo()).toBe(true)
      expect(search.getState().active?.searchRevision).toBeGreaterThan(replacedRevision)
      expect(search.getState().active?.status).toBe('loading')
    })
    await waitForMatches(search, 3)
    expectRestoredMatches(search)
    expect(a.buffer.materializeFullText()).toBe(initial + dirtyComment)
    expect(a.buffer.isDirty()).toBe(true)
    expect(b.buffer.materializeFullText()).toBe(initial)
    expect(b.buffer.isDirty()).toBe(false)
    await expectDisk(server.root, initial)
    const undoRevision = search.getState().active?.searchRevision ?? 0

    await act(async () => {
      expect(await editor.workspaceEditService.redo()).toBe(true)
      expect(search.getState().active?.searchRevision).toBeGreaterThan(undoRevision)
      expect(search.getState().active?.status).toBe('loading')
    })
    await waitForMatches(search, 0)
    expect(a.buffer.materializeFullText()).toBe(
      initial.replace('renameMe', 'renamedValue') + dirtyComment,
    )
    expect(b.buffer.materializeFullText()).toBe(initial.replace('renameMe', 'renamedValue'))
    expect(await readFile(join(server.root, 'c.ts'), 'utf8')).toBe(
      initial.replace('renameMe', 'renamedValue'),
    )

    await act(async () => expect(await editor.workspaceEditService.undo()).toBe(true))
    await waitForMatches(search, 3)
    const restoredRun = search.getState().active?.runId ?? 0
    act(() => createEditorBufferSession(a.buffer).applyText('// another comment\n'))
    await waitFor(() => expect(search.getState().active?.runId).toBeGreaterThan(restoredRun))
    await waitForMatches(search, 3)
    expectRestoredMatches(search)
    expect(a.buffer.materializeFullText()).toBe(initial + dirtyComment + '// another comment\n')
    await expectDisk(server.root, initial)
    const noOpRevision = search.getState().active?.searchRevision
    await act(async () => expect(await editor.workspaceEditService.undo()).toBe(false))
    expect(search.getState().active?.searchRevision).toBe(noOpRevision)
  } finally {
    view.unmount()
  }
})

function SearchControl() {
  useSearchBufferRuntime('')
  const { canReplace, replaceAll } = useWorkspaceSearchReplace('')
  return (
    <Button disabled={!canReplace} onClick={replaceAll}>
      Replace all
    </Button>
  )
}

async function waitForMatches(store: SearchBufferStoreApi, count: number) {
  await waitFor(() => {
    expect(store.getState().active?.status).toBe('ready')
    expect(store.getState().active?.resultsQuery).toBe('renameMe')
    expect(store.getState().active?.matches).toHaveLength(count)
  })
}

function expectRestoredMatches(store: SearchBufferStoreApi) {
  expect(
    store
      .getState()
      .active?.matches.toSorted((left, right) => left.path.localeCompare(right.path))
      .map((match) => [match.path, match.source]),
  ).toEqual([
    ['a.ts', 'open-buffer'],
    ['b.ts', 'disk'],
    ['c.ts', 'disk'],
  ])
}

async function expectDisk(root: string, content: string) {
  expect(await Promise.all(paths.map((path) => readFile(join(root, path), 'utf8')))).toEqual(
    paths.map(() => content),
  )
}
