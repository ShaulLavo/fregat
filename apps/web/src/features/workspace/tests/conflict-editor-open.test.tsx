import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createConflictCompletionFixture } from '../../../../test/factories/conflict-completion'
import { observeDiffEditors } from '../../../../test/factories/diff-attachment'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { filesystemDiffAttachment } from '@/lib/diff-attachment'
import { EditorDocumentStateContext } from '@/features/editor/state/document-state'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { activeEditorTab as selectedGroupTab, allEditorTabs } from '@/lib/documents/utils/groups'
import { getClient } from '@/lib/client'
import { conflictId, documentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { documentSourcePath } from '@/lib/documents/utils/capabilities'
import { tabLabel } from '@/lib/documents/utils/labels'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import type { ReactNode } from 'react'
import { Toaster } from '@workspace/ui/components/sonner'

import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { languageIdForFilePath } from '@/lib/file-language'
import { notifyChangedFilesystemConflict } from '@/features/workspace/state/event-conflict-adapter'
import { createFileContent, ensureFolderPath, fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'

import { expect, test } from '../../../../test/fixtures'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { AppProviders, createTestQueryClient, renderWithProviders } from '../../../../test/render'

// The toast is the only door into the conflict editor, so this drives it the way a user does:
// dirty buffer, file changed underneath, Compare. What must come out is a tab of its own that
// names the file and can pick its language from it.
test('Compare on the conflict toast opens the conflict editor in its own tab', async ({
  client,
}) => {
  void client
  const path = filesystemPath('repo/src/a.ts')
  await ensureFolderPath(filesystemPath('repo/src'), getClient())
  await createFileContent(path, 'const a = 1\n', getClient())
  const file = await fetchFile(path, new AbortController().signal, getClient())
  const queryClient = createTestQueryClient()
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return (
      <AppProviders queryClient={queryClient}>
        <TestEditorStateProvider>{children}</TestEditorStateProvider>
      </AppProviders>
    )
  }
  const hook = renderHook(() => ({ commands: useEditorCommands(), runtime: useEditorRuntime() }), {
    wrapper: Wrapper,
  })
  const { conflictStore, documentStore, workspaceStore } = hook.result.current.runtime
  setFileSnapshotQueryData(queryClient, file)
  await act(async () => {
    await hook.result.current.commands.openFileSurface(path)
  })
  const fileTabId = (selectedGroupTab(workspaceStore.getState().workbenchPanels.editorGroups)?.id ??
    null)!
  const view = documentStore.getState().ensureEditorView(fileTabId, file)
  act(() => createEditorBufferSession(view.buffer, view.view).applyText('const b = 2\n'))

  render(<Toaster />)
  const { commands } = hook.result.current
  const documentState = documentStore.getState()
  act(() =>
    notifyChangedFilesystemConflict(
      path,
      { ...file, content: 'const a = 3\n', version: 'remote-2' },
      {
        comparisonScope: {
          environmentId: confirmedEnvironmentId(originForQueryClient(queryClient)),
          rootPath: filesystemPath('repo'),
        },
        acquireSnapshotComparison: documentState.acquireSnapshotComparison,
        signal: new AbortController().signal,
        client: getClient(),
        conflictStore,
        discardLiveEditorDocument: commands.discardLiveEditorDocument,
        ensureUnsyncedEditorDocument: documentState.ensureUnsyncedEditorDocument,
        fetchFile: (target, signal) => fetchFile(target, signal, getClient()),
        forceReplaceLiveEditorDocument: documentState.forceReplaceLiveEditorDocument,
        getLiveEditorDocument: documentState.getLiveEditorDocument,
        queryClient,
        renameLiveEditorDocument: commands.renameLiveEditorDocument,
        setFileOrphaned: documentState.setFileOrphaned,
        selectContent: commands.selectContent,
      },
    ),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close toast' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close toast' })).toBeNull())
  expect(Object.values(conflictStore.getState().conflicts)).toHaveLength(1)

  const panels = workspaceStore.getState().workbenchPanels
  const conflictTab = allEditorTabs(panels.editorGroups).find(
    (tab) => tab.content.kind === 'document' && tab.content.document.kind === 'conflict',
  )
  expect(conflictTab).toBeDefined()
  expect(selectedGroupTab(panels.editorGroups)?.id ?? null).toBe(conflictTab!.id)
  expect(allEditorTabs(panels.editorGroups).map((tab) => tab.id)).toEqual([
    fileTabId,
    conflictTab!.id,
  ])
  const document = conflictTab!.content.kind === 'document' ? conflictTab!.content.document : null
  expect(documentSourcePath(document!)).toBe(path)
  expect(languageIdForFilePath(documentSourcePath(document!)!)).toBe('typescript')
  expect(tabLabel(conflictTab!.content)).toBe('a.ts')
  const conflictDocument = documentStore.getState().getLiveEditorDocument(documentKey(document!))
  expect(conflictDocument?.buffer.materializeFullText()).toBe(
    [
      '<<<<<<< Local: repo/src/a.ts',
      'const a = 1',
      'const b = 2',
      '=======',
      'const a = 3',
      '>>>>>>> Remote: repo/src/a.ts',
      '',
    ].join('\n'),
  )
})

test('first capture seeds the actual resolution once; latest and two display interests remain independent', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  const originalEditing = createEditorBufferSession(f.destination.buffer)
  originalEditing.applyText(' captured')
  const originalSnapshot = f.destination.buffer.getTextSnapshot()
  const toaster = renderWithProviders(<Toaster />, {
    application: f.application,
    queryClient: f.queryClient,
  })
  act(() => notifyChangedFilesystemConflict(f.path, f.remote, f.context))
  const firstConflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  act(() => originalEditing.applyText(' later'))
  fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
  const seeded = f.editor.conflictStore.getState().conflicts[firstConflict.id]!
  const seed = seeded.seed!
  act(() =>
    f.editor.conflictStore
      .getState()
      .updateConflict(seeded.id, { toastId: 'metadata-clone-after-seed' }),
  )
  const metadataClone = f.editor.conflictStore.getState().conflicts[seeded.id]!
  expect(metadataClone.latest).toBe(seeded.latest)
  expect(metadataClone.seed).toBe(seed)
  const resolution = f.editor.documentStore.getState().getLiveEditorDocument(seed.resolutionKey)!
  expect(seed.buffer).toBe(resolution.buffer)
  expect(seed.comparison.input).toBe(firstConflict.latest.input)
  const local = seed.comparison.input.capture.local
  if (local.kind !== 'text') throw new RangeError('Actual immutable local required')
  expect(local.snapshot).toBe(originalSnapshot)
  const initial = resolution.buffer.materializeFullText()
  expect(initial).toContain('remote text captured')
  expect(initial).not.toContain(' later')
  const editing = createEditorBufferSession(resolution.buffer)
  act(() => editing.applyText(' edited'))
  const edited = resolution.buffer.materializeFullText()
  const observe = observeDiffEditors()
  const attachment = filesystemDiffAttachment(seed.comparison.lease.read(), 'seed')
  const firstView = renderWithProviders(
    <EditorDocumentStateContext value={f.editor.documentStore}>
      <DiffEditor attachment={attachment} mode='stacked' />
    </EditorDocumentStateContext>,
    { application: f.application, queryClient: f.queryClient },
  )
  const secondView = renderWithProviders(
    <EditorDocumentStateContext value={f.editor.documentStore}>
      <DiffEditor attachment={attachment} mode='stacked' />
    </EditorDocumentStateContext>,
    { application: f.application, queryClient: f.queryClient },
  )
  await waitFor(() => expect(observe.all()).toHaveLength(2))
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(4)
  for (const view of observe.all()) expect(view.editor.materializeFullText()).toContain('captured')
  await writeFile(join(server.root, f.path), 'new incoming')
  const incoming = await fetchFile(f.path, new AbortController().signal, f.context.client)
  act(() => notifyChangedFilesystemConflict(f.path, incoming, f.context))
  const latest = f.editor.conflictStore.getState().conflicts[firstConflict.id]!
  expect(latest.seed).toBe(seed)
  expect(latest.latest.input.capture).not.toBe(seed.comparison.input.capture)
  expect(latest.latest.input.capture.incoming.kind).toBe('text')
  expect(firstConflict.latest.lease.read().kind).toBe('released')
  expect(seed.comparison.lease.read().kind).toBe('ready')
  expect(resolution.buffer.materializeFullText()).toBe(edited)
  act(() => editing.undo())
  expect(resolution.buffer.materializeFullText()).toBe(initial)
  firstView.unmount()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(3)
  await waitFor(() => expect(observe.all()).toHaveLength(1))
  expect(observe.all()[0]!.editor.materializeFullText()).toContain('captured')
  act(() => f.editor.conflictStore.getState().clearConflicts())
  expect(seed.comparison.lease.read().kind).toBe('released')
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(1)
  expect(resolution.buffer.materializeFullText()).toBe(initial)
  secondView.unmount()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
  toaster.unmount()
})

test('first seed acquisition publication releases a candidate after reentrant clear', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' local')
  const rendered = renderWithProviders(<Toaster />, {
    application: f.application,
    queryClient: f.queryClient,
  })
  act(() => notifyChangedFilesystemConflict(f.path, f.remote, f.context))
  const original = Object.values(f.editor.conflictStore.getState().conflicts)[0]
  if (!original) throw new RangeError('Actual notified conflict required')
  let ended = false
  const stop = f.editor.documentStore.subscribe((state) => {
    if (ended || state.snapshotComparisons.size !== 2) return
    ended = true
    f.editor.conflictStore.getState().clearConflicts()
  })
  try {
    fireEvent.click(await rendered.findByRole('button', { name: 'Compare' }))
    expect(ended).toBe(true)
    expect(f.editor.conflictStore.getState().conflicts).toEqual({})
    expect(original.latest.lease.read().kind).toBe('released')
    expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
    const target = {
      kind: 'conflict',
      conflictId: conflictId(original.id),
      path: original.remotePath,
    } as const
    const resolution = f.documents.getLiveEditorDocument(documentKey(target))
    if (!resolution) throw new RangeError('Created resolution must survive source refusal')
    const text = resolution.buffer.materializeFullText()
    expect(text).toContain('<<<<<<<')
    expect(text).toContain('remote text local')
    const editing = createEditorBufferSession(resolution.buffer)
    act(() => editing.applyText('draft '))
    act(() => editing.undo())
    expect(resolution.buffer.materializeFullText()).toBe(text)
  } finally {
    stop()
    rendered.unmount()
    f.editor.conflictStore.getState().clearConflicts()
  }
})

for (const change of ['metadata', 'buffer'] as const) {
  test(`first seed acquisition publication checks the actual ${change} transfer`, async ({
    server,
  }) => {
    const f = await createConflictCompletionFixture(server)
    createEditorBufferSession(f.destination.buffer).applyText(' local')
    const rendered = renderWithProviders(<Toaster />, {
      application: f.application,
      queryClient: f.queryClient,
    })
    act(() => notifyChangedFilesystemConflict(f.path, f.remote, f.context))
    const original = Object.values(f.editor.conflictStore.getState().conflicts)[0]
    if (!original) throw new RangeError('Actual notified conflict required')
    const target = {
      kind: 'conflict',
      conflictId: conflictId(original.id),
      path: original.remotePath,
    } as const
    const key = documentKey(target)
    let changed = false
    const stop = f.editor.documentStore.subscribe((state) => {
      if (changed || state.snapshotComparisons.size !== 2) return
      changed = true
      if (change === 'metadata') {
        f.editor.conflictStore.getState().updateConflict(original.id, { toastId: 'seed-metadata' })
        return
      }
      const resolution = f.documents.getLiveEditorDocument(key)
      if (!resolution) throw new RangeError('Actual resolution required')
      const content = resolution.buffer.materializeFullText()
      f.documents.deleteLiveEditorDocument(key)
      f.documents.ensureUnsyncedEditorDocument({ target, content })
    })
    try {
      fireEvent.click(await rendered.findByRole('button', { name: 'Compare' }))
      const current = f.editor.conflictStore.getState().conflicts[original.id]
      expect(changed).toBe(true)
      expect(current?.latest).toBe(original.latest)
      expect(f.documents.getLiveEditorDocument(key)?.buffer.materializeFullText()).toContain(
        'remote text local',
      )
      if (change === 'metadata') {
        expect(current?.seed?.comparison.input).toBe(original.latest.input)
        expect(current?.seed?.buffer).toBe(f.documents.getLiveEditorDocument(key)?.buffer)
        expect(current?.seed?.comparison.lease.read().kind).toBe('ready')
        expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(2)
      }
      if (change === 'buffer') {
        expect(current?.seed).toBeUndefined()
        expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(1)
      }
    } finally {
      stop()
      rendered.unmount()
      f.editor.conflictStore.getState().clearConflicts()
    }
  })
}
