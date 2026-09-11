import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { screen, waitFor } from '@testing-library/react'

import { CompareSavedView } from '@/features/editor/components/compare-saved-view'
import {
  EditorDocumentStateContext,
  createEditorDocumentStore,
} from '@/features/editor/state/document-state'
import { expect, test } from '../../../../../test/fixtures'
import { testDiffLanguageHost } from '../../../../../test/factories/diff-language-host'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { renderWithProviders } from '../../../../../test/render'
import { createObservedInProcessClient } from '../../../../../test/client'
import { installTestClient } from '../../../../../test/factories/client-binding'

// The second of the two mount sites, and the harsher one: both sides are read live, so every
// keystroke rebuilds the `DiffFile` and pushes a new buffer. Its own logic is the three notices and
// the buffer-versus-disk model it hands to `DiffEditor`.
//
// The saved side is a real file read through the real in-process server, because that is the half
// this component does not own — it asks for it and has to cope with whatever comes back. The
// working side is seeded into the document store directly, because a live buffer is not something
// a server can hand you: it is exactly the unsaved state that has never been written.

const SAVED = 'alpha\nbeta\ngamma\n'
const EDITED = 'alpha\nbeta changed\ngamma\n'
const FILE = 'repo/a.ts'

test('a buffer that differs from disk is shown as a diff', async ({ client, server }) => {
  void client
  stubEditorViewport()
  await renderCompare(server.root, { buffer: EDITED })

  await waitFor(() => {
    expect(diffRowTexts()).toEqual(expect.arrayContaining(['beta', 'beta changed']))
  })
})

test('a buffer that matches disk says there is nothing to compare', async ({ client, server }) => {
  void client
  await renderCompare(server.root, { buffer: SAVED })

  expect(await screen.findByText('No unsaved changes.')).toBeInTheDocument()
})

test('a file that was never opened asks for it to be opened', async ({ client, server }) => {
  void client
  await renderCompare(server.root, { buffer: null })

  expect(await screen.findByText('Open the file to compare it with disk.')).toBeInTheDocument()
})

test('shows loading while the saved file read is pending', async ({ client, server }) => {
  void client
  const readGate = Promise.withResolvers<void>()
  const restore = installTestClient(
    createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname === '/fs/read') return readGate.promise
    }),
  )

  try {
    await renderCompare(server.root, { buffer: null })
    expect(screen.getByRole('status', { name: 'Loading saved file' })).toBeInTheDocument()
    expect(screen.queryByText('Open the file to compare it with disk.')).not.toBeInTheDocument()
    readGate.resolve()
    expect(await screen.findByText('Open the file to compare it with disk.')).toBeInTheDocument()
  } finally {
    readGate.resolve()
    restore()
  }
})

async function renderCompare(root: string, { buffer }: { buffer: string | null }) {
  stubHighlightApi()
  await mkdir(path.join(root, 'repo'), { recursive: true })
  await writeFile(path.join(root, FILE), SAVED)

  const store = createEditorDocumentStore()
  if (buffer !== null) {
    store.getState().ensureLiveEditorDocument({
      content: buffer,
      mtimeMs: 1,
      path: FILE,
      size: buffer.length,
      version: `v-${buffer.length}`,
    })
  }

  // One provider, not the app's whole `EditorStateProvider`: the store has to be reachable from
  // here to stand a buffer up in it, and that provider builds its own.
  return renderWithProviders(
    <EditorDocumentStateContext.Provider value={store}>
      <CompareSavedView languageHost={testDiffLanguageHost} path={FILE} rootPath='repo' />
    </EditorDocumentStateContext.Provider>,
  )
}

function diffRowTexts() {
  return [
    ...document.querySelectorAll<HTMLElement>('.editor-diff-pane [data-editor-virtual-row]'),
  ].map((row) => row.textContent ?? '')
}
