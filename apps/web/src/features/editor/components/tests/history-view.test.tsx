import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { createEditorBufferSession, type EditorTextBuffer } from '@singapore-editor/core/document'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HistoryView } from '@/features/editor/components/history-view'
import {
  EditorDocumentStateContext,
  createEditorDocumentStore,
} from '@/features/editor/state/document-state'
import { createEditorUiStore, EditorUiStateContext } from '@/features/editor/state/ui-state'
import { FocusService } from '@/lib/focus/state/service'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import {
  commitHistoryBarrier,
  historyDocument,
} from '../../../../../test/factories/history-document'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { holdToConfirm } from '../../../../../test/hold'

const FILE = filesystemPath('repo/a.ts')
const SAVED = 'alpha\nbeta\n'

test('a file that was never opened asks for it to be opened', async () => {
  await renderHistory({ edits: null })

  expect(await screen.findByText('Open the file to browse its history.')).toBeInTheDocument()
})

test('lists every retained state and diffs a focused one against the current text', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one', 'two'] })
  const buffer = requireBuffer(rendered.buffer)
  const states = screen.getByRole('listbox', { name: 'Versions' })
  const options = await screen.findAllByRole('option')
  expect(options).toHaveLength(3)
  expect(screen.getByText('This is the current version.')).toBeInTheDocument()

  await user.click(options[1]!)
  await waitFor(() => {
    expect(diffRowTexts()).toEqual(expect.arrayContaining(['alphaonetwo', 'alphaone']))
  })
  const read = rendered.store.getState().snapshotComparisonTabs.get(tabId('tab-history'))?.read()
  expect(read?.kind).toBe('ready')
  if (read?.kind !== 'ready' || read.input.kind !== 'history')
    throw new RangeError('retained history capture required')
  const input = read.input
  const graph = buffer.getHistoryGraph()
  const current = graph.nodes.find((node) => node.id === graph.currentId)!
  const focused = graph.nodes[1]!
  expect(read.input.buffer).toBe(buffer)
  expect(read.input.old.id).toBe(current.id)
  expect(read.input.old.revision).toBe(current.revision)
  expect(input.old.snapshot).toBe(current.snapshot)
  expect(read.input.new.id).toBe(focused.id)
  expect(read.input.new.snapshot).toBe(focused.snapshot)
  const session = createEditorBufferSession(buffer)
  session.setSelection(5)
  session.applyText('A')
  session.applyText('B')
  await waitFor(() => {
    const latest = rendered.store
      .getState()
      .snapshotComparisonTabs.get(tabId('tab-history'))
      ?.read()
    expect(latest?.kind).toBe('ready')
    if (latest?.kind !== 'ready' || latest.input.kind !== 'history')
      throw new RangeError('retained replacement history required')
    expect(latest.input.old.snapshot).not.toBe(input.old.snapshot)
  })
  session.undo()
  expect(input.old.snapshot).toBe(current.snapshot)
  expect(read.input.new.snapshot).toBe(focused.snapshot)
  expect(states).toHaveAttribute('aria-activedescendant', options[1]!.id)

  await user.click(screen.getByRole('button', { name: 'Use this version' }))
  await waitFor(() => expect(buffer.materializeFullText()).toBe('alphaone\nbeta\n'))
  expect(await screen.findByText('This is the current version.')).toBeInTheDocument()
})

test('retains the editor when arrows turn a focused diff into a selected-pair comparison', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  await renderHistory({ edits: ['one', 'two', 'three'] })
  const options = await screen.findAllByRole('option')
  await user.click(options[0]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alphaonetwothree'))
  const host = document.querySelector('.editor-diff-pane .editor-virtualized')
  expect(host).not.toBeNull()
  const states = screen.getByRole('listbox', { name: 'Versions' })
  states.focus()
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await waitFor(() => expect(diffRowTexts()).toContain('alphaone'))
  expect(document.querySelector('.editor-diff-pane .editor-virtualized')).toBe(host)
  expect(screen.queryByRole('status', { name: 'Comparing versions' })).not.toBeInTheDocument()
})

test('clears history after confirmation and leaves the text alone', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one', 'two'] })
  const buffer = requireBuffer(rendered.buffer)

  await user.click(screen.getByRole('button', { name: 'Clear history' }))
  holdToConfirm(await screen.findByRole('button', { name: 'Clear history' }))

  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
  expect(buffer.materializeFullText()).toBe('alphaonetwo\nbeta\n')
  expect(buffer.canUndo()).toBe(false)
})

test('keeps the focused history state when its tab moves into another group', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one', 'two'] })
  const options = await screen.findAllByRole('option')
  await user.click(options[1]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alphaone'))

  rendered.remount()

  await waitFor(() => {
    expect(screen.getByRole('listbox', { name: 'Versions' })).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[1]!.id,
    )
    expect(diffRowTexts()).toContain('alphaone')
  })
})

test('focuses the history graph or its diff without registering competing tab targets', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const { focus } = await renderHistory({ edits: ['one'] })
  await screen.findByText('This is the current version.')
  const destination = {
    kind: 'match' as const,
    matches: (target: { id: { kind: string; tabId?: string; side?: string } }) =>
      target.id.kind === 'editor' && target.id.tabId === 'tab-history' && target.id.side !== 'old',
  }

  await expect(focus.request(destination).completion).resolves.toMatchObject({
    status: 'acknowledged',
    targetId: { surface: 'history', tabId: 'tab-history' },
  })
  const options = await screen.findAllByRole('option')
  await user.click(options[0]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alpha'))
  await expect(focus.request(destination).completion).resolves.toMatchObject({
    status: 'acknowledged',
    targetId: { surface: 'diff', tabId: 'tab-history' },
  })
})

test('the barrier before a workspace edit is a state of its own', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one'] })
  const buffer = requireBuffer(rendered.buffer)
  const committed = commitHistoryBarrier(buffer, [{ from: 0, to: 1, text: 'A' }])
  expect(committed.status).toBe('committed')

  const barrier = await screen.findByRole('option', { name: /Multi-file edit/ })
  await user.click(barrier)
  expect(await screen.findByText('A multi-file edit blocks earlier versions.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Use this version' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Undo multi-file edit' })).not.toBeInTheDocument()
})

test('moving into a group with another history tab preserves the selected barrier', async () => {
  stubEditorViewport()
  stubHighlightApi()
  const store = createEditorDocumentStore({ environmentId: testScopedStorage.environmentId })
  const uiStore = createEditorUiStore()
  const otherFile = filesystemPath('repo/b.ts')
  for (const path of [FILE, otherFile]) {
    const { buffer } = historyDocument({ store, path, content: SAVED })
    expect(commitHistoryBarrier(buffer, [{ from: 0, to: 1, text: 'A' }]).status).toBe('committed')
  }

  function body(moved: boolean) {
    return (
      <EditorDocumentStateContext value={store}>
        <EditorUiStateContext value={uiStore}>
          <section aria-label='Source group'>
            {moved ? (
              <div>Another selected tab</div>
            ) : (
              <HistoryView rootPath={filesystemPath('repo')} path={FILE} tabId={tabId('a')} />
            )}
          </section>
          <section aria-label='Destination group'>
            <HistoryView
              rootPath={filesystemPath('repo')}
              path={moved ? FILE : otherFile}
              tabId={tabId(moved ? 'a' : 'b')}
            />
          </section>
        </EditorUiStateContext>
      </EditorDocumentStateContext>
    )
  }

  const rendered = renderWithProviders(body(false))
  const user = userEvent.setup()
  const source = within(await screen.findByRole('region', { name: 'Source group' }))
  const destination = within(screen.getByRole('region', { name: 'Destination group' }))
  await user.click(await source.findByRole('option', { name: /Multi-file edit/ }))
  expect(source.getByText('A multi-file edit blocks earlier versions.')).toBeInTheDocument()

  rendered.rerender(body(true))

  expect(
    await destination.findByText('A multi-file edit blocks earlier versions.'),
  ).toBeInTheDocument()
  rendered.rerender(body(false))
  expect(await destination.findByText('This is the current version.')).toBeInTheDocument()
  expect(await source.findByText('A multi-file edit blocks earlier versions.')).toBeInTheDocument()
})

test('replacing the actual live buffer clears the former logical history capture', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one', 'two'] })
  await user.click((await screen.findAllByRole('option'))[1]!)
  await waitFor(() => expect(rendered.store.getState().snapshotComparisons.size).toBe(2))
  const old = rendered.store.getState().snapshotComparisonTabs.get(tabId('tab-history'))!
  rendered.store.getState().forceReplaceLiveEditorDocument({
    path: FILE,
    content: 'replacement\n',
    version: 'v2',
    mtimeMs: 2,
    size: 12,
  })
  await screen.findByText('This is the current version.')
  expect(old.read().kind).toBe('released')
  expect(rendered.store.getState().snapshotComparisons.size).toBe(0)
  expect(rendered.store.getState().getLiveEditorDocument(fileDocumentKey(FILE))?.buffer).not.toBe(
    rendered.buffer,
  )
})

test('a held history header stays captured while current restore availability changes', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  let live: EditorTextBuffer | null = null
  let store: ReturnType<typeof createEditorDocumentStore> | null = null
  let injected = false
  let target: ReturnType<EditorTextBuffer['getHistoryGraph']>['currentId'] | null = null
  let currentBefore: ReturnType<EditorTextBuffer['getHistoryGraph']>['currentId'] | null = null
  let currentAfter: ReturnType<EditorTextBuffer['getHistoryGraph']>['currentId'] | null = null
  const titles: string[] = []
  const restoreStates: boolean[] = []
  const rendered = await renderHistory({
    edits: ['one', 'two', 'three'],
    onRender() {
      if (!live || !store || !screen.queryByRole('status', { name: 'Comparing versions' })) return
      const button = screen.getByRole('button', { name: 'Use this version' })
      restoreStates.push(button.hasAttribute('disabled'))
      const header = button.closest('[data-slot="pane-bar"]')?.querySelector('[title]')
      titles.push(header?.getAttribute('title') ?? 'MISSING')
      if (injected) return
      if (target === null) return
      currentBefore = live.getHistoryGraph().currentId
      injected = true
      live.checkoutHistoryState(target)
      currentAfter = live.getHistoryGraph().currentId
    },
  })
  live = rendered.buffer
  store = rendered.store
  const options = await screen.findAllByRole('option')
  await user.click(options[1]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alphaonetwothree'))
  const read = store.getState().snapshotComparisonTabs.get(tabId('tab-history'))?.read()
  if (read?.kind !== 'ready' || read.input.kind !== 'history')
    throw new RangeError('Actual focused capture required')
  target = read.input.new.id
  expect(target).not.toBe(live!.getHistoryGraph().currentId)
  expect(screen.getByRole('button', { name: 'Use this version' })).toBeEnabled()
  const states = screen.getByRole('listbox', { name: 'Versions' })
  states.focus()
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(injected).toBe(true)
  expect(currentBefore).not.toBe(target)
  expect(currentAfter).toBe(target)
  expect(live!.getHistoryGraph().currentId).toBe(target)
  expect(titles.length).toBeGreaterThan(0)
  expect(titles).not.toContain('MISSING')
  expect(titles.every((title) => !title.includes(', current'))).toBe(true)
  expect(restoreStates).toContain(false)
  expect(restoreStates).toContain(true)
})

test('pruning actual pending history withdraws current Restore authority and the former attachment', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  let buffer: EditorTextBuffer | null = null
  let injected = false
  let removed = false
  let target: number | null = null
  const rendered = await renderHistory({
    edits: ['one', 'two', 'three'],
    onRender() {
      if (
        !buffer ||
        injected ||
        target === null ||
        !screen.queryByRole('status', { name: 'Comparing versions' })
      )
        return
      expect(buffer.getHistoryGraph().nodes.some((node) => node.id === target)).toBe(true)
      injected = true
      buffer.clearHistory()
      removed = !buffer.getHistoryGraph().nodes.some((node) => node.id === target)
    },
  })
  buffer = requireBuffer(rendered.buffer)
  const options = await screen.findAllByRole('option')
  await user.click(options[1]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alphaonetwothree'))
  const lease = rendered.store.getState().snapshotComparisonTabs.get(tabId('tab-history'))!
  const read = lease.read()
  if (read.kind !== 'ready' || read.input.kind !== 'history')
    throw new RangeError('Actual focused source required')
  target = read.input.new.id
  expect(screen.getByRole('button', { name: 'Use this version' })).toBeEnabled()
  screen.getByRole('listbox', { name: 'Versions' }).focus()
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(injected).toBe(true)
  expect(removed).toBe(true)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Use this version' })).toBeDisabled(),
  )
  await waitFor(() => expect(rendered.store.getState().snapshotComparisons.size).toBe(0))
  expect(document.querySelector('.editor-diff-pane')).toBeNull()
})

test('actual current amendments leave the pending displayed history source captured', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  let buffer: EditorTextBuffer | null = null
  let injected = false
  let amended = false
  const samples: string[][] = []
  const rendered = await renderHistory({
    edits: ['one', 'two', 'three'],
    onRender() {
      if (!buffer || !screen.queryByRole('status', { name: 'Comparing versions' })) return
      samples.push(diffRowTexts())
      if (injected) return
      injected = true
      const editing = createEditorBufferSession(buffer)
      editing.setSelection(5)
      editing.applyText('A')
      const graph = buffer.getHistoryGraph()
      const before = graph.nodes.find((node) => node.id === graph.currentId)!
      editing.applyText('B')
      const after = buffer
        .getHistoryGraph()
        .nodes.find((node) => node.id === buffer!.getHistoryGraph().currentId)!
      amended =
        before.id === after.id &&
        before.revision < after.revision &&
        before.snapshot !== after.snapshot
    },
  })
  buffer = requireBuffer(rendered.buffer)
  await user.click((await screen.findAllByRole('option'))[1]!)
  await waitFor(() => expect(diffRowTexts()).toContain('alphaonetwothree'))
  const read = rendered.store.getState().snapshotComparisonTabs.get(tabId('tab-history'))?.read()
  if (read?.kind !== 'ready' || read.input.kind !== 'history')
    throw new RangeError('Actual focused capture required')
  const old = read.input.old.snapshot
  screen.getByRole('listbox', { name: 'Versions' }).focus()
  await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
  expect(injected).toBe(true)
  expect(amended).toBe(true)
  expect(samples.length).toBeGreaterThan(0)
  expect(samples.every((sample) => sample.includes('alphaonetwothree'))).toBe(true)
  expect(buffer.materializeFullText()).toContain('alphaAB')
  expect(read.input.old.snapshot).toBe(old)
  expect(samples.flat().some((line) => line.includes('alphaAB'))).toBe(false)
})

async function renderHistory({
  edits,
  onRender,
}: {
  edits: readonly string[] | null
  onRender?: ProfilerOnRenderCallback
}) {
  stubHighlightApi()
  const store = createEditorDocumentStore({ environmentId: testScopedStorage.environmentId })
  const uiStore = createEditorUiStore()
  const focus = new FocusService()
  const document =
    edits === null
      ? null
      : historyDocument({
          store,
          content: SAVED,
          path: FILE,
          cursorOffset: 5,
          insertions: edits,
        })

  // renderWithProviders mounts under StrictMode, as the app does: the viewer must survive the
  // mount, unmount, mount rehearsal.
  function body(key: string) {
    return (
      <EditorDocumentStateContext.Provider value={store}>
        <EditorUiStateContext value={uiStore}>
          <Profiler id='actual-history-control' onRender={onRender ?? (() => undefined)}>
            <HistoryView
              rootPath={filesystemPath('repo')}
              key={key}
              path={FILE}
              tabId={tabId('tab-history')}
            />
          </Profiler>
        </EditorUiStateContext>
      </EditorDocumentStateContext.Provider>
    )
  }
  const rendered = renderWithProviders(body('before-move'), { focusService: focus })
  return {
    ...rendered,
    buffer: document?.buffer ?? null,
    store,
    focus,
    remount: () => rendered.rerender(body('after-move')),
  }
}

function requireBuffer(buffer: EditorTextBuffer | null): EditorTextBuffer {
  if (!buffer) throw new RangeError('this test needs a live document')
  return buffer
}

function diffRowTexts() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.editor-diff-pane [data-editor-virtual-row]'),
    (row) => row.textContent ?? '',
  )
}
