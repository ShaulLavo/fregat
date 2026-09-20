import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import type { EditorTextBuffer } from '@singapore-editor/core'
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
  const states = screen.getByRole('listbox', { name: 'History states' })
  const options = await screen.findAllByRole('option')
  expect(options).toHaveLength(3)
  expect(screen.getByText('This is the current state.')).toBeInTheDocument()

  await user.click(options[1]!)
  await waitFor(() => {
    expect(diffRowTexts()).toEqual(expect.arrayContaining(['alphaonetwo', 'alphaone']))
  })
  expect(states).toHaveAttribute('aria-activedescendant', options[1]!.id)

  await user.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(buffer.materializeFullText()).toBe('alphaone\nbeta\n'))
  expect(await screen.findByText('This is the current state.')).toBeInTheDocument()
})

test('clears history after confirmation and leaves the text alone', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one', 'two'] })
  const buffer = requireBuffer(rendered.buffer)

  await user.click(screen.getByRole('button', { name: 'Clear history' }))
  await user.click(await screen.findByRole('button', { name: 'Clear history' }))

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
    expect(screen.getByRole('listbox', { name: 'History states' })).toHaveAttribute(
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
  await screen.findByText('This is the current state.')
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

  const barrier = await screen.findByRole('option', { name: /Workspace edit/ })
  await user.click(barrier)
  expect(await screen.findByText('Earlier history is behind a workspace edit.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Undo workspace edit' })).not.toBeInTheDocument()
})

test('moving into a group with another history tab preserves the selected barrier', async () => {
  stubEditorViewport()
  stubHighlightApi()
  const store = createEditorDocumentStore()
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
              <HistoryView path={FILE} tabId={tabId('a')} />
            )}
          </section>
          <section aria-label='Destination group'>
            <HistoryView path={moved ? FILE : otherFile} tabId={tabId(moved ? 'a' : 'b')} />
          </section>
        </EditorUiStateContext>
      </EditorDocumentStateContext>
    )
  }

  const rendered = renderWithProviders(body(false))
  const user = userEvent.setup()
  const source = within(await screen.findByRole('region', { name: 'Source group' }))
  const destination = within(screen.getByRole('region', { name: 'Destination group' }))
  await user.click(await source.findByRole('option', { name: /Workspace edit/ }))
  expect(source.getByText('Earlier history is behind a workspace edit.')).toBeInTheDocument()

  rendered.rerender(body(true))

  expect(
    await destination.findByText('Earlier history is behind a workspace edit.'),
  ).toBeInTheDocument()
  rendered.rerender(body(false))
  expect(await destination.findByText('This is the current state.')).toBeInTheDocument()
  expect(await source.findByText('Earlier history is behind a workspace edit.')).toBeInTheDocument()
})

async function renderHistory({ edits }: { edits: readonly string[] | null }) {
  stubHighlightApi()
  const store = createEditorDocumentStore()
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
          <HistoryView key={key} path={FILE} tabId={tabId('tab-history')} />
        </EditorUiStateContext>
      </EditorDocumentStateContext.Provider>
    )
  }
  const rendered = renderWithProviders(body('before-move'), { focusService: focus })
  return {
    ...rendered,
    buffer: document?.buffer ?? null,
    focus,
    remount: () => rendered.rerender(body('after-move')),
  }
}

function requireBuffer(buffer: EditorTextBuffer | null): EditorTextBuffer {
  if (!buffer) throw new RangeError('this test needs a live document')
  return buffer
}

function diffRowTexts() {
  return [
    ...document.querySelectorAll<HTMLElement>('.editor-diff-pane [data-editor-virtual-row]'),
  ].map((row) => row.textContent ?? '')
}
