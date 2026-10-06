import { QueryClient } from '@tanstack/react-query'
import { createInProcessClient } from '../../../../test/client'
import { makeTestServer } from '../../../../test/server'
import { FilePreviewPanel } from '@/features/command-palette/components/file-preview-panel'
import { PreviewPane } from '@/features/file-picker/components/preview'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { fetchFile, fetchTree, statPath } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import {
  originForQueryClient,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { createObservedInProcessClient } from '../../../../test/client'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { screen, act, waitFor } from '@testing-library/react'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { TextPreview } from '@/lib/file-preview/components/text-preview'
import { lineNumbers } from '@/lib/file-preview/utils/preview'
import { previewQueryOptions } from '@/lib/file-preview/utils/preview-query'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

const BUDGET = 64 * 1024

test('a new preview never displays the previous file body under its name', async ({
  server,
  client: _client,
}) => {
  await writeFile(path.join(server.root, 'first.ts'), 'first_file_body')
  const queryClient = createTestQueryClient()
  const first = await queryClient.query(previewQueryOptions('first.ts', BUDGET))
  if (first.kind !== 'text') throw new RangeError('Actual text head required')
  const view = renderWithProviders(
    <TextPreview name='first.ts' read={first.read} fallback={<span>File preview</span>} />,
    { queryClient },
  )
  expect(screen.getByText('first_file_body')).toBeInTheDocument()

  view.rerender(
    <TextPreview
      name='second.json'
      read={{ kind: 'pending' }}
      fallback={<span>File preview</span>}
    />,
  )

  expect(screen.queryByText('first_file_body')).not.toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Loading second.json' })).toBeInTheDocument()
})

test('a file longer than the budget says how much of it the preview shows', async ({
  server,
  client: _client,
}) => {
  await writeFile(path.join(server.root, 'big.log'), 'a\nb\n'.repeat(314_573))
  const queryClient = createTestQueryClient()
  const big = await queryClient.query(previewQueryOptions('big.log', BUDGET))
  if (big.kind !== 'text') throw new RangeError('Actual text head required')
  renderWithProviders(<TextPreview name='big.log' read={big.read} fallback={null} />, {
    queryClient,
  })

  expect(screen.getByRole('note')).toHaveTextContent('First 64 KB of 1.2 MB')
})

test('the gutter numbers every line and no trailing empty one', () => {
  expect(lineNumbers('a\nb\n')).toBe('1\n2')
  expect(lineNumbers('a\nb')).toBe('1\n2')
  expect(lineNumbers('')).toBe('1')
})

test('the preview key changes with the budget', () => {
  expect(previewQueryOptions('a.ts', 4096).queryKey).not.toEqual(
    previewQueryOptions('a.ts', BUDGET).queryKey,
  )
})

test('actual palette and picker share the dirty live buffer and release only their own views', async ({
  client,
  server,
}) => {
  const f = await createAddressTestRuntime(client)
  const queries = f.application.getSnapshot().queryClient
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  f.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  await writeFile(path.join(server.root, 'shared.txt'), 'saved\n')
  const file = await fetchFile(filesystemPath('shared.txt'), new AbortController().signal, client)
  const document = f.editor.documentStore.getState().ensureLiveEditorDocument(file)
  const editing = createEditorBufferSession(document.buffer)
  editing.applyText('dirty live')
  const beforeUpdate = document.buffer.materializeFullText()
  const tree = await fetchTree(root.path, new AbortController().signal, client)
  const entry = tree.entries.find((item) => item.name === 'shared.txt')
  if (!entry) throw new RangeError('Actual shared file entry required')
  let previewReads = 0
  registerEnvironmentQueryClient(
    queries,
    originForQueryClient(queries),
    createObservedInProcessClient(server, (request) => {
      if (['/fs/head', '/fs/read'].includes(new URL(request.url).pathname)) previewReads += 1
    }),
  )
  const shown = renderWithProviders(
    <TestEditorStateProvider>
      <FilePreviewPanel key='palette' item={{ entry, pathLabel: entry.name }} />
      <PreviewPane key='picker' entry={entry} mode='file' showHidden={false} isSearching={false} />
    </TestEditorStateProvider>,
    { application: f.application, queryClient: queries },
  )
  await waitFor(() => expect(f.editor.documentStore.getState().previewSources.size).toBe(2))
  await screen.findByText('Unsaved buffer')
  expect(screen.queryByText('Size')).toBeNull()
  expect(previewReads).toBe(0)
  act(() => editing.applyText(' updated'))
  await waitFor(() => expect(screen.getAllByText(/dirty live updated/)).toHaveLength(2))
  const live = Array.from(f.editor.documentStore.getState().previewSources.values())
  expect(
    live.every(
      (read) =>
        read.kind === 'live' &&
        read.buffer === document.buffer &&
        read.snapshot === document.buffer.getTextSnapshot() &&
        read.revision === document.buffer.getRevision(),
    ),
  ).toBe(true)
  shown.rerender(
    <TestEditorStateProvider>
      <PreviewPane key='picker' entry={entry} mode='file' showHidden={false} isSearching={false} />
    </TestEditorStateProvider>,
  )
  await waitFor(() => expect(f.editor.documentStore.getState().previewSources.size).toBe(1))
  expect(document.buffer.materializeFullText()).toContain('dirty live updated')
  act(() => editing.undo())
  expect(document.buffer.materializeFullText()).toBe(beforeUpdate)
  act(() => editing.undo())
  expect(document.buffer.materializeFullText()).toBe(file.content)
  shown.unmount()
  expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
  expect(f.editor.documentStore.getState().getLiveEditorDocument(document.key)?.buffer).toBe(
    document.buffer,
  )
})

test.for(['foreign', 'rootless'] as const)(
  'actual $0 picker keeps a query-owned disk read with zero document interests',
  async (mode, { client, server }) => {
    const f = await createAddressTestRuntime(client)
    const ownQueries = f.application.getSnapshot().queryClient
    let queries = ownQueries
    const other = mode === 'foreign' ? await makeTestServer() : null
    const diskServer = other ?? server
    const diskClient = other ? createInProcessClient(other) : client
    if (other) {
      queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
      registerEnvironmentQueryClient(queries, 'http://picker-foreign.invalid', diskClient)
      const root = await statPath(filesystemPath(''), new AbortController().signal, client)
      const workspaceAddress = await registerTestWorkspaceAddress(client, '')
      f.editor.workspaceStore
        .getState()
        .switchWorkspace({ ...root, workspaceAddress, name: 'Own', type: 'directory' })
    }
    await writeFile(path.join(diskServer.root, 'fallback.txt'), 'query-owned disk body\n')
    if (!other) {
      const file = await fetchFile(
        filesystemPath('fallback.txt'),
        new AbortController().signal,
        client,
      )
      const document = f.editor.documentStore.getState().ensureLiveEditorDocument(file)
      createEditorBufferSession(document.buffer).applyText('unadmitted dirty live')
      expect(f.editor.workspaceStore.getState().rootFolder).toBeNull()
    }
    const tree = await fetchTree(filesystemPath(''), new AbortController().signal, diskClient)
    const entry = tree.entries.find((item) => item.name === 'fallback.txt')
    if (!entry) throw new RangeError('Actual picker file entry required')
    try {
      const mounted = renderWithProviders(
        <TestEditorStateProvider>
          <PreviewPane entry={entry} mode='folder' showHidden={false} isSearching={false} />
        </TestEditorStateProvider>,
        { application: f.application, queryClient: queries, settingsOwner: ownQueries },
      )
      await screen.findByText('query-owned disk body')
      expect(screen.queryByText(/unadmitted dirty live/)).toBeNull()
      expect(f.editor.documentStore.getState().previewSources.size).toBe(0)
      const cached = queries.getQueryData(previewQueryOptions(entry.path, BUDGET).queryKey)
      expect(cached).toMatchObject({ kind: 'text', read: { kind: 'disk' } })
      expect(cached).not.toHaveProperty('lease')
      mounted.unmount()
    } finally {
      if (other) {
        queries.clear()
        await other.cleanup()
      }
    }
  },
)
