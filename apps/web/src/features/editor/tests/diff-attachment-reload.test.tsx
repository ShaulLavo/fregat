import { waitFor } from '@testing-library/react'
import { createTextDiff } from '@singapore-editor/diff'
import { TabPresentations } from '@/features/editor/state/tab-presentation'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import type { DiffReloadView } from '@/features/git/utils/reload-schema'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkpointRefForSessionTurn } from 'server/testing'
import { DiffView } from '@/features/git/components/diff-view'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { prepareGitReload, captureGitView, savedGitView } from '@/features/git/state/reload'
import { checkpointTurnDocument } from '@/lib/checkpoint-diff-query'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { documentTab } from '@/lib/documents/utils/tabs'
import { tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { fetchDiff } from '@/lib/git-diff-query'
import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import {
  writeRootFolderCache,
  writeWorkspaceSliceCache,
  emptyWorkspaceSlice,
} from '@/features/workspace/state/cache'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { checkpointTurn } from '../../../../test/factories/checkpoint-turn'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import {
  observeDiffEditors,
  mountDiffProjectionControl,
  projectionControl,
} from '../../../../test/factories/diff-attachment'
import { testDiffLanguageHost } from '../../../../test/factories/diff-language-host'
import { runGit } from '../../../../test/factories/git'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'

test('actual checkpoint reload keeps exact pair offsets and refuses changed refs under the same target', async ({
  client,
  server,
}) => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const text =
    Array.from(
      { length: 80 },
      (_, index) => `export const retained${index + 1} = "${'x'.repeat(80)}"`,
    ).join('\n') + '\n'
  const h = await checkpointTurn(client, server, [text, 'after\n'])
  const runtime = h.application.getSnapshot().editor
  const root = workspaceRoot(runtime.workspaceStore.getState().rootFolder!.path)
  const comparison = checkpointTurnDocument(h.summary, root, false)
  const id = tabId('reload-attached')
  const observed = observeDiffEditors()
  const queries = runtime.queryClient
  const storage = environmentWindowStorage(runtime.storage.environmentId)
  await queries.query(snapshotComparisonQueryOptions(comparison.source))
  runtime.editorActivation.activate(documentTab(comparison), id)
  prepareGitReload(queries, storage, root)
  captureGitView(queries, root, { activeId: 'turn:app.txt', scrollTop: 320 })
  const first = renderWithProviders(
    <EditorStateProvider runtime={runtime}>
      <DiffView
        comparison={comparison.source}
        rootPath={root}
        languageHost={testDiffLanguageHost}
        tabId={id}
      />
    </EditorStateProvider>,
    { application: h.application, queryClient: queries },
  )
  await waitFor(() =>
    expect(observed.read('stacked').editor.materializeFullText()).toContain('retained80'),
  )
  await waitFor(() => expect(first.container.querySelector('[aria-busy="true"]')).toBeNull())
  const editor = observed.read('stacked').editor
  editor.setSelection(100, 80, { reveal: false })
  editor.setScrollPosition({ top: 240, left: 40 })
  const offset = editor.getScrollPosition()
  const selection = editor.getSelections()
  expect(offset.top).toBeGreaterThan(0)
  await waitFor(() =>
    expect(runtime.uiStore.getState().tabPresentation.get(id).diffPanes.stacked.scroll).toEqual(
      offset,
    ),
  )
  const firstRead = runtime.documentStore.getState().snapshotComparisonTabs.get(id)!.read()
  if (firstRead.kind !== 'ready' || firstRead.input.kind !== 'checkpoint')
    throw new RangeError('Actual captured checkpoint required')
  const state = runtime.workspaceStore.getState()
  window.dispatchEvent(new Event('pagehide'))
  writeRootFolderCache(runtime.storage, state.rootFolder)
  writeWorkspaceSliceCache(runtime.storage, root, {
    ...emptyWorkspaceSlice(),
    workbenchPanels: state.workbenchPanels,
  })
  first.unmount()
  h.application.dispose()
  queries.clear()

  const fresh = createTestApplicationRuntime()
  const resumed = fresh.getSnapshot().editor
  await queries.query(snapshotComparisonQueryOptions(comparison.source))
  resumed.editorActivation.activate(documentTab(comparison), id)
  prepareGitReload(queries, storage, root)
  const same = renderWithProviders(
    <EditorStateProvider runtime={resumed}>
      <DiffView
        comparison={comparison.source}
        rootPath={root}
        languageHost={testDiffLanguageHost}
        tabId={id}
      />
    </EditorStateProvider>,
    { application: fresh, queryClient: queries },
  )
  await waitFor(() =>
    expect(observed.read('stacked').editor.materializeFullText()).toContain('retained80'),
  )
  await waitFor(() => expect(same.container.querySelector('[aria-busy="true"]')).toBeNull())
  expect(observed.read('stacked').editor.getScrollPosition()).toEqual(offset)
  expect(observed.read('stacked').editor.getSelections()).toEqual(selection)
  expect(savedGitView(queries, root)).toEqual({ activeId: 'turn:app.txt', scrollTop: 320 })
  same.unmount()
  fresh.dispose()
  queries.clear()

  await writeFile(join(server.root, 'app.txt'), '// changed checkpoint ref\n' + text)
  runGit(server.root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qam',
    'new checkpoint capture',
  ])
  runGit(server.root, ['update-ref', checkpointRefForSessionTurn(h.sessionIds[0]!, 1), 'HEAD'])
  const changed = createTestApplicationRuntime()
  const replaced = changed.getSnapshot().editor
  await queries.query(snapshotComparisonQueryOptions(comparison.source))
  replaced.editorActivation.activate(documentTab(comparison), id)
  prepareGitReload(queries, storage, root)
  const next = renderWithProviders(
    <EditorStateProvider runtime={replaced}>
      <DiffView
        comparison={comparison.source}
        rootPath={root}
        languageHost={testDiffLanguageHost}
        tabId={id}
      />
    </EditorStateProvider>,
    { application: changed, queryClient: queries },
  )
  try {
    await waitFor(() =>
      expect(observed.read('stacked').editor.materializeFullText()).toContain(
        'changed checkpoint ref',
      ),
    )
    const nextRead = replaced.documentStore.getState().snapshotComparisonTabs.get(id)!.read()
    if (nextRead.kind !== 'ready' || nextRead.input.kind !== 'checkpoint')
      throw new RangeError('Actual replacement checkpoint required')
    expect(nextRead.input.comparison).toEqual(firstRead.input.comparison)
    expect(nextRead.input.files[0]?.revision).not.toEqual(firstRead.input.files[0]?.revision)
    expect(nextRead.input.files[0]?.hunks).not.toEqual(firstRead.input.files[0]?.hunks)
    expect(observed.read('stacked').editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    expect(observed.read('stacked').editor.getSelections()[0]).toMatchObject({
      anchorOffset: 0,
      headOffset: 0,
    })
    expect(savedGitView(queries, root)).toEqual({ activeId: 'turn:app.txt', scrollTop: 320 })
    observed.read('stacked').editor.setScrollPosition(offset)
    observed.read('stacked').editor.setSelection(100, 80, { reveal: false })
    window.dispatchEvent(new Event('pagehide'))
  } finally {
    next.unmount()
    changed.dispose()
    queries.clear()
  }
  const policy = { ...comparison, source: { ...comparison.source, ignoreWhitespace: true } }
  const policyApp = createTestApplicationRuntime()
  const policyRuntime = policyApp.getSnapshot().editor
  await queries.query(snapshotComparisonQueryOptions(policy.source))
  policyRuntime.editorActivation.activate(documentTab(policy), id)
  prepareGitReload(queries, storage, root)
  const policyView = renderWithProviders(
    <EditorStateProvider runtime={policyRuntime}>
      <DiffView
        comparison={policy.source}
        rootPath={root}
        languageHost={testDiffLanguageHost}
        tabId={id}
      />
    </EditorStateProvider>,
    { application: policyApp, queryClient: queries },
  )
  try {
    await waitFor(() => expect(policyView.container.querySelector('[aria-busy="true"]')).toBeNull())
    await waitFor(() =>
      expect(observed.read('stacked').editor.materializeFullText()).toContain(
        'changed checkpoint ref',
      ),
    )
    const policyRead = policyRuntime.documentStore.getState().snapshotComparisonTabs.get(id)!.read()
    if (policyRead.kind !== 'ready' || policyRead.input.kind !== 'checkpoint')
      throw new RangeError('Actual policy-qualified checkpoint required')
    expect(policyRead.input.comparison.ignoreWhitespace).toBe(true)
    expect(observed.read('stacked').editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    expect(observed.read('stacked').editor.getSelections()[0]).toMatchObject({
      anchorOffset: 0,
      headOffset: 0,
    })
    expect(savedGitView(queries, root)).toEqual({ activeId: 'turn:app.txt', scrollTop: 320 })
  } finally {
    policyView.unmount()
    policyApp.dispose()
    queries.clear()
  }
})

test('an admitted reload is one shot, copied independently and withdrawn on semantic or file mismatch', async () => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const text = Array.from(
    { length: 80 },
    (_, index) => `const source${index} = "${'x'.repeat(100)}"`,
  ).join('\n')
  const file = createTextDiff({
    oldFile: { path: 'source.ts', text: 'base' },
    newFile: { path: 'source.ts', text },
  })
  const a = projectionControl(file, 'source-a', 'revision-a')
  const b = projectionControl(file, 'source-b', 'revision-a')
  const tabs = new TabPresentations()
  const original = tabs.get(tabId('reload-first'))
  const state: DiffReloadView = {
    expanded: [],
    old: null,
    new: null,
    stacked: { top: 240, left: 40 },
    stackedSelections: [
      { anchorOffset: 8, headOffset: 5, startOffset: 5, endOffset: 8, affinity: 'after' },
    ],
  }
  original.restoreDiffView(a, state)
  tabs.copy(tabId('reload-first'), tabId('reload-copy'))
  const copy = tabs.get(tabId('reload-copy'))
  const first = mountDiffProjectionControl(a, 'stacked', original.diffPanes.stacked)
  await waitFor(() => expect(first.snapshot().viewport.clientHeight).toBe(120))
  expect(first.editor.getScrollPosition()).toEqual(state.stacked)
  expect(first.editor.getSelections()).toEqual(state.stackedSelections)
  expect(original.diffPanes.stacked.reload).toBeNull()
  expect(copy.diffPanes.stacked.reload).not.toBeNull()
  const second = mountDiffProjectionControl(a, 'stacked', copy.diffPanes.stacked)
  await waitFor(() => expect(second.snapshot().viewport.clientHeight).toBe(120))
  expect(second.editor.getScrollPosition()).toEqual(state.stacked)
  expect(copy.diffPanes.stacked.reload).toBeNull()
  original.restoreDiffView(a, { ...state, stacked: { top: 360, left: 20 } })
  first.publish(a)
  expect(first.editor.getScrollPosition()).toEqual({ top: 360, left: 20 })
  first.editor.setScrollPosition({ top: 480, left: 30 })
  first.publish(a)
  expect(first.editor.getScrollPosition()).toEqual({ top: 480, left: 30 })
  expect(second.editor.getScrollPosition()).toEqual(state.stacked)
  original.restoreDiffView(a, state)
  first.publish(b)
  expect(first.editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
  expect(original.diffPanes.stacked.reload).toBeNull()
  first.publish(a)
  expect(first.editor.getScrollPosition()).toEqual({ top: 480, left: 30 })
  original.restoreDiffView(a, state)
  first.publish(projectionControl({ ...file }, 'source-a', 'revision-b'))
  expect(first.editor.getScrollPosition()).not.toEqual(state.stacked)
  expect(original.diffPanes.stacked.reload).toBeNull()
  first.binding.detach()
  first.editor.dispose()
  original.restoreDiffView(a, state)
  const marker = original.diffPanes.stacked.reload
  const departing = mountDiffProjectionControl(b, 'stacked', original.diffPanes.stacked)
  expect(departing.presentation.reload).toBeNull()
  expect(marker).not.toBeNull()
  const unmatched = tabs.get(tabId('reload-unmatched'))
  unmatched.restoreDiffView(a, state)
  const other = mountDiffProjectionControl(b, 'stacked', unmatched.diffPanes.stacked)
  expect(other.editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
  other.publish(a)
  expect(other.editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
  unmatched.restoreDiffView(a, state)
  other.binding.detach()
  expect(unmatched.diffPanes.stacked.reload).toBeNull()
})

test('an attached moving pair restores from its actual cache while dirty Undo survives and a new pair refuses offsets', async ({
  client,
  server,
}) => {
  stubEditorViewport({ height: 120, width: 300 })
  stubHighlightApi()
  const f = await createSnapshotComparisonFixture(server.root, client)
  const text =
    Array.from(
      { length: 80 },
      (_, index) => `export const moving${index} = "${'x'.repeat(80)}"`,
    ).join('\n') + '\n'
  await writeFile(join(server.root, f.path), text)
  const [diff] = await fetchDiff(f.path, false, undefined, client)
  const document = snapshotDocument(diff!, f.scope.rootPath, 'worktree')!
  const application = createTestApplicationRuntime()
  expect(
    await application.openEnvironmentWorkspaceRoot(f.scope.environmentId, f.scope.rootPath),
  ).toBe('opened')
  const runtime = application.getSnapshot().editor
  const queries = runtime.queryClient
  const storage = environmentWindowStorage(runtime.storage.environmentId)
  const id = tabId('moving-reload')
  const observed = observeDiffEditors()
  const disk = await fetchFile(f.path, new AbortController().signal, client)
  const live = runtime.documentStore.getState().ensureLiveEditorDocument(disk)
  const editing = createEditorBufferSession(live.buffer)
  editing.setSelection(0)
  editing.applyText('// parked dirty\n')
  editing.breakTypingRun()
  const body = () => (
    <EditorStateProvider runtime={runtime}>
      <DiffView
        comparison={document.source}
        rootPath={f.scope.rootPath}
        languageHost={testDiffLanguageHost}
        tabId={id}
      />
    </EditorStateProvider>
  )
  await queries.query(snapshotComparisonQueryOptions(document.source))
  runtime.editorActivation.activate(documentTab(document), id)
  prepareGitReload(queries, storage, f.scope.rootPath)
  captureGitView(queries, f.scope.rootPath, { activeId: 'worktree:source.ts', scrollTop: 320 })
  const first = renderWithProviders(body(), { application, queryClient: queries })
  await waitFor(() => expect(first.container.querySelector('[aria-busy="true"]')).toBeNull())
  await waitFor(() =>
    expect(observed.read('stacked').editor.materializeFullText()).toContain('moving79'),
  )
  observed.read('stacked').editor.setScrollPosition({ top: 240, left: 40 })
  observed.read('stacked').editor.setSelection(100, 80, { reveal: false })
  const position = observed.read('stacked').editor.getScrollPosition()
  const selection = observed.read('stacked').editor.getSelections()
  window.dispatchEvent(new Event('pagehide'))
  first.unmount()
  prepareGitReload(queries, storage, f.scope.rootPath)
  const resumed = renderWithProviders(body(), { application, queryClient: queries })
  await waitFor(() => expect(resumed.container.querySelector('[aria-busy="true"]')).toBeNull())
  await waitFor(() =>
    expect(observed.read('stacked').editor.materializeFullText()).toContain('moving79'),
  )
  expect(observed.read('stacked').editor.getScrollPosition()).toEqual(position)
  expect(observed.read('stacked').editor.getSelections()).toEqual(selection)
  expect(runtime.documentStore.getState().getLiveEditorDocument(live.key)?.buffer).toBe(live.buffer)
  expect(live.buffer.materializeFullText()).toBe('// parked dirty\n' + text)
  editing.undo()
  expect(live.buffer.materializeFullText()).toBe(text)
  expect(savedGitView(queries, f.scope.rootPath)).toEqual({
    activeId: 'worktree:source.ts',
    scrollTop: 320,
  })
  window.dispatchEvent(new Event('pagehide'))
  resumed.unmount()
  runtime.uiStore.getState().tabPresentation.retain(new Set())
  await writeFile(join(server.root, f.path), '// actual new pair\n' + text)
  queries.removeQueries({
    queryKey: snapshotComparisonQueryOptions(document.source).queryKey,
    exact: true,
  })
  await queries.query(snapshotComparisonQueryOptions(document.source))
  runtime.editorActivation.activate(documentTab(document), id)
  prepareGitReload(queries, storage, f.scope.rootPath)
  const changed = renderWithProviders(body(), { application, queryClient: queries })
  try {
    await waitFor(() => expect(changed.container.querySelector('[aria-busy="true"]')).toBeNull())
    await waitFor(() =>
      expect(observed.read('stacked').editor.materializeFullText()).toContain('actual new pair'),
    )
    expect(observed.read('stacked').editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    expect(observed.read('stacked').editor.getSelections()[0]).toMatchObject({
      anchorOffset: 0,
      headOffset: 0,
    })
    expect(savedGitView(queries, f.scope.rootPath)).toEqual({
      activeId: 'worktree:source.ts',
      scrollTop: 320,
    })
  } finally {
    changed.unmount()
    application.dispose()
    queries.clear()
  }
})
