import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import {
  commitPreparedDocumentTransaction,
  createEditorBufferSession,
  prepareDocumentTransaction,
  type EditorTextBuffer,
} from '@singapore-editor/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HistoryView } from '@/features/editor/components/history-view'
import {
  EditorDocumentStateContext,
  createEditorDocumentStore,
} from '@/features/editor/state/document-state'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

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

test('the barrier before a workspace edit is a state of its own', async () => {
  stubEditorViewport()
  const user = userEvent.setup()
  const rendered = await renderHistory({ edits: ['one'] })
  const buffer = requireBuffer(rendered.buffer)
  const committed = commitPreparedDocumentTransaction(
    { buffer, sourceView: null },
    prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 2, null),
    { history: { groupId: 'rename', kind: 'external-barrier' } },
  )
  expect(committed.status).toBe('committed')

  const barrier = await screen.findByRole('option', { name: /Workspace edit/ })
  await user.click(barrier)
  expect(await screen.findByText('Earlier history is behind a workspace edit.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Undo workspace edit' })).not.toBeInTheDocument()
})

async function renderHistory({ edits }: { edits: readonly string[] | null }) {
  stubHighlightApi()
  const store = createEditorDocumentStore()
  const document =
    edits === null
      ? null
      : store.getState().ensureLiveEditorDocument({
          content: SAVED,
          mtimeMs: 1,
          path: FILE,
          size: SAVED.length,
          version: 'v1',
        })
  if (document && edits) {
    const session = createEditorBufferSession(document.buffer)
    session.setSelection(5)
    for (const text of edits) {
      session.applyText(text)
      session.breakTypingRun()
    }
  }

  // renderWithProviders mounts under StrictMode, as the app does: the viewer must survive the
  // mount, unmount, mount rehearsal.
  const rendered = renderWithProviders(
    <EditorDocumentStateContext.Provider value={store}>
      <HistoryView path={FILE} tabId={tabId('tab-history')} />
    </EditorDocumentStateContext.Provider>,
  )
  return { ...rendered, buffer: document?.buffer ?? null }
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
