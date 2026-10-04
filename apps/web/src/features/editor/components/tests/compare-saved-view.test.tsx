import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { createFileSyncPorts } from '@/features/editor/utils/file-sync-ports'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { act, screen, waitFor } from '@testing-library/react'

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
import { activeEnvironmentId } from '@/lib/environments/state/domain'

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

test('two comparison mounts pin one clean source and release their interests independently', async ({
  client,
  server,
}) => {
  void client
  const { store, rerender, unmount } = await renderCompare(server.root, {
    buffer: SAVED,
    copies: 2,
  })
  await waitFor(() => expect(store.getState().savedComparisons.size).toBe(2))
  const sources = [...store.getState().savedComparisons.values()]
  const first = sources[0]
  const second = sources[1]
  expect(first?.kind).toBe('ready')
  expect(second?.kind).toBe('ready')
  if (first?.kind !== 'ready' || second?.kind !== 'ready') return
  expect(first.live.buffer).toBe(second.live.buffer)
  expect(first.live.analysis).toBe(second.live.analysis)
  expect(first.saved.snapshot).toBe(second.saved.snapshot)
  store.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
  expect(store.getState().getLiveEditorDocument(first.live.key)?.buffer).toBe(first.live.buffer)
  rerender(compareMounts(store, 1))
  await waitFor(() => expect(store.getState().savedComparisons.size).toBe(1))
  unmount()
  expect(store.getState().savedComparisons.size).toBe(0)
  store.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
  expect(store.getState().getLiveEditorDocument(first.live.key)).toBeNull()
})

test('a save updates the saved side while later edits keep their own text', async ({
  client,
  server,
}) => {
  stubEditorViewport()
  const { store, queryClient } = await renderCompare(server.root, { buffer: SAVED })
  await screen.findByText('No unsaved changes.')
  const ports = createFileSyncPorts(client)
  const file = await ports.readFileContent(filesystemPath(FILE), new AbortController().signal)
  act(() => store.getState().forceReplaceLiveEditorDocument(file))
  const document = store.getState().ensureLiveEditorDocument(file)
  const session = createEditorBufferSession(document.buffer)
  act(() => session.applyText('first edit'))
  await waitFor(() => expect(diffRowTexts().join(' ')).toContain('first edit'))
  await act(() =>
    new FileSyncService(store, queryClient, ports).save(
      store.getState().getLiveEditorDocument(document.key)!,
    ),
  )
  expect(await screen.findByText('No unsaved changes.')).toBeInTheDocument()
  act(() => session.applyText(' second edit'))
  await waitFor(() =>
    expect(diffRowTexts()).toEqual(
      expect.arrayContaining(['first edit', 'first edit second edit']),
    ),
  )
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

async function renderCompare(
  root: string,
  { buffer, copies = 1 }: { buffer: string | null; copies?: number },
) {
  stubHighlightApi()
  await mkdir(path.join(root, 'repo'), { recursive: true })
  await writeFile(path.join(root, FILE), SAVED)

  const store = createEditorDocumentStore({ environmentId: activeEnvironmentId() })
  if (buffer !== null) {
    store.getState().ensureLiveEditorDocument({
      content: buffer,
      mtimeMs: 1,
      path: filesystemPath(FILE),
      size: buffer.length,
      version: `v-${buffer.length}`,
    })
  }

  // One provider, not the app's whole `EditorStateProvider`: the store has to be reachable from
  // here to stand a buffer up in it, and that provider builds its own.
  const rendered = renderWithProviders(compareMounts(store, copies))
  return { ...rendered, store }
}

function compareMounts(store: ReturnType<typeof createEditorDocumentStore>, copies: number) {
  return (
    <EditorDocumentStateContext.Provider value={store}>
      {Array.from({ length: copies }, (_, index) => (
        <CompareSavedView
          key={index}
          languageHost={testDiffLanguageHost}
          path={filesystemPath(FILE)}
          rootPath={filesystemPath('repo')}
        />
      ))}
    </EditorDocumentStateContext.Provider>
  )
}

function diffRowTexts() {
  return [
    ...document.querySelectorAll<HTMLElement>('.editor-diff-pane [data-editor-virtual-row]'),
  ].map((row) => row.textContent ?? '')
}
