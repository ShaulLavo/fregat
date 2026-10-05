import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorStateProvider } from '@/features/editor/providers/state-provider'
import { DiffView } from '@/features/git/components/diff-view'
import {
  checkpointDiffInputForSummary,
  checkpointDiffQueryKey,
  checkpointSessionDocument,
  checkpointTurnDocument,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { checkpointIntentOptions } from '@/lib/checkpoint-intent'
import { checkpointRequest } from '@/lib/documents/utils/comparisons'
import { documentTab } from '@/lib/documents/utils/tabs'
import { tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import { decodeTabContent, encodeTabContent } from '@/lib/documents/utils/storage-codec'
import {
  originForQueryClient,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import {
  emptyWorkspaceSlice,
  readWorkspaceCache,
  writeRootFolderCache,
  writeWorkspaceSliceCache,
} from '@/features/workspace/state/cache'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { createObservedInProcessClient, createCuttableEventsClient } from '../../../../test/client'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { CheckpointOpen } from '../../../../test/factories/checkpoint-open'
import { checkpointTurn } from '../../../../test/factories/checkpoint-turn'
import { testDiffLanguageHost } from '../../../../test/factories/diff-language-host'
import { stubEditorViewport } from '../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../test/env/highlight-api'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('counted hunks retain false policy through intent, real open and empty-origin-cache application restore', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server, ['  before\n', 'after\n'])
  const runtime = h.application.getSnapshot().editor
  const queries = runtime.queryClient
  const requests: URL[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    const url = new URL(request.url)
    if (url.pathname.includes('diff')) requests.push(url)
  })
  registerEnvironmentQueryClient(queries, originForQueryClient(queries), observed)
  const displayInput = checkpointDiffInputForSummary(h.summary)
  const countedInput = { ...displayInput, ignoreWhitespace: false }
  const countedKey = checkpointDiffQueryKey(countedInput)
  const displayKey = checkpointDiffQueryKey(displayInput)
  const counted = await queries.query({
    queryKey: countedKey,
    staleTime: Infinity,
    queryFn: ({ signal }) => fetchCheckpointDiff(countedInput, signal, observed),
  })
  const cold = await queries.query({
    queryKey: displayKey,
    staleTime: Infinity,
    queryFn: ({ signal }) => fetchCheckpointDiff(displayInput, signal, observed),
  })
  expect(counted.map((diff) => diff.path)).toEqual(['app.txt', 'next.txt'])
  expect(cold.map((diff) => diff.path)).toEqual(['next.txt'])
  const whitespace = counted[0]!
  queries.removeQueries({ queryKey: displayKey, exact: true })
  const options = checkpointIntentOptions(h.summary, queries)!
  expect(options.queryKey).toEqual(countedKey)
  expect(await queries.query(options)).toBe(counted)
  expect(queries.getQueryData(displayKey)).toBeUndefined()

  let opened: Promise<boolean> | undefined
  const rendered = renderWithProviders(
    <EditorStateProvider runtime={runtime}>
      <CheckpointOpen
        summary={h.summary}
        visible
        onOpen={(result) => {
          opened = result
        }}
      />
    </EditorStateProvider>,
    { application: h.application, queryClient: queries, command: { bindings: [] } },
  )
  await userEvent.click(await screen.findByRole('treeitem', { name: /app.txt/ }))
  await act(async () => {
    expect(await opened).toBe(true)
  })
  const state = runtime.workspaceStore.getState()
  const selected = state.selectedTabContent
  if (
    selected?.kind !== 'document' ||
    selected.document.kind !== 'git-diff' ||
    selected.document.source.kind === 'snapshot'
  )
    throw new RangeError('checkpoint target required')
  const source = selected.document.source
  expect(source.ignoreWhitespace).toBe(false)
  const read = [...runtime.documentStore.getState().snapshotComparisons.values()][0]
  expect(read?.kind).toBe('ready')
  if (read?.kind !== 'ready' || read.input.kind !== 'checkpoint')
    throw new RangeError('checkpoint input required')
  const seeded = queries.getQueryData(checkpointDiffQueryKey(checkpointRequest(source)))
  expect(seeded).toEqual([whitespace])
  expect(queries.getQueryData(countedKey)).toBe(counted)
  expect(read.input.files[0]?.hunks).toBe(whitespace.hunks)
  expect(read.input.files[0]?.revision.old).toEqual({
    kind: 'blob',
    objectId: whitespace.oldObjectId,
  })
  expect(read.input.files[0]?.revision.new).toEqual({
    kind: 'blob',
    objectId: whitespace.newObjectId,
  })
  expect(read.input.files[0]?.kind).toBe('partial')
  expect(read.input.comparison).toEqual(source)
  expect(requests.map((url) => url.searchParams.get('ignoreWhitespace'))).toEqual(['false', 'true'])

  const root = workspaceRoot(state.rootFolder!.path)
  const encoded = encodeTabContent(selected, root)
  expect(decodeTabContent(encoded, root)).toEqual(selected)
  expect(
    decodeTabContent(
      {
        kind: 'document',
        document: { kind: 'git-diff', source: { ...source, ignoreWhitespace: undefined } },
      },
      root,
    ),
  ).toBeNull()
  writeRootFolderCache(runtime.storage, state.rootFolder)
  writeWorkspaceSliceCache(runtime.storage, root, {
    ...emptyWorkspaceSlice(),
    workbenchPanels: state.workbenchPanels,
  })
  rendered.unmount()
  h.application.dispose()
  expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
  queries.clear()
  const restored = readWorkspaceCache(runtime.storage)
  expect(restored.workspaces[root]).toBeDefined()
  const fresh = createTestApplicationRuntime()
  const restoredRuntime = fresh.getSnapshot().editor
  expect(restoredRuntime.queryClient).toBe(queries)
  expect(restoredRuntime.workspaceStore.getState().selectedTabContent).toEqual(selected)
  const recovered = await queries.query(snapshotComparisonQueryOptions(source))
  expect(recovered.map((diff) => diff.hunks.map((hunk) => hunk.id))).toEqual([
    [whitespace.hunks[0]!.id],
  ])
  const recoveredRead = [
    ...restoredRuntime.documentStore.getState().snapshotComparisons.values(),
  ][0]
  expect(recoveredRead?.kind).toBe('ready')
  if (recoveredRead?.kind !== 'ready' || recoveredRead.input.kind !== 'checkpoint')
    throw new RangeError('restored retained capture required')
  expect(queries.getQueryData(snapshotComparisonQueryOptions(source).queryKey)).toBe(recovered)
  expect(recoveredRead.input.files[0]?.hunks).toBe(recovered[0]!.hunks)
  expect(recoveredRead.input.comparison.ignoreWhitespace).toBe(false)
  expect(recoveredRead.input.files[0]?.revision).toEqual(read.input.files[0]?.revision)
  expect(requests.map((url) => url.searchParams.get('ignoreWhitespace'))).toEqual([
    'false',
    'true',
    'false',
  ])
  fresh.dispose()
  queries.clear()
})

for (const [kind, response] of [
  ['turn', 'full'],
  ['session', 'full'],
  ['turn', 'size'],
  ['turn', 'foreign-path'],
  ['turn', 'foreign-pair'],
  ['turn', 'missing-identity'],
] as const) {
  test(`${kind} ${response} response retains captured files and hydrates only compatible displayed sources`, async ({
    client,
    server,
  }) => {
    stubEditorViewport()
    stubHighlightApi()
    const h = await checkpointTurn(client, server)
    const runtime = h.application.getSnapshot().editor
    const queries = runtime.queryClient
    const requests: URL[] = []
    const observed = createObservedInProcessClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname.includes('diff')) requests.push(url)
    })
    registerEnvironmentQueryClient(queries, originForQueryClient(queries), observed)
    const root = workspaceRoot(runtime.workspaceStore.getState().rootFolder!.path)
    const document =
      kind === 'turn'
        ? checkpointTurnDocument(h.summary, root, true)
        : checkpointSessionDocument(h.summary, root, true)
    const listed = await queries.query(snapshotComparisonQueryOptions(document.source))
    expect(listed).toHaveLength(2)
    const controlled = createCuttableEventsClient(server, (request) => {
      const url = new URL(request.url)
      if (url.pathname !== '/git/diff/blob' || response === 'full') return
      requests.push(url)
      const original = listed[0]!
      const answer = { ...original, oldText: 'before\n', newText: 'after\n' }
      if (response === 'size')
        return Response.json([
          { ...original, omitted: 'size', oldText: undefined, newText: undefined },
        ])
      if (response === 'foreign-path') return Response.json([{ ...answer, path: 'foreign.txt' }])
      if (response === 'foreign-pair')
        return Response.json([{ ...answer, newObjectId: 'f'.repeat(40) }])
      return Response.json([{ ...answer, oldFileMissing: true }])
    })
    if (response !== 'full')
      registerEnvironmentQueryClient(queries, originForQueryClient(queries), controlled.client)
    const tab = tabId(`retained-${kind}`)
    runtime.editorActivation.activate(documentTab(document), tab)
    const lease = runtime.documentStore.getState().snapshotComparisonTabs.get(tab)!
    const prior = lease.read()
    expect(prior.kind).toBe('ready')
    const rendered = renderWithProviders(
      <EditorStateProvider runtime={runtime}>
        <DiffView
          comparison={document.source}
          rootPath={root}
          languageHost={testDiffLanguageHost}
          tabId={tab}
        />
      </EditorStateProvider>,
      { application: h.application, queryClient: queries },
    )
    await waitFor(() => {
      const read = lease.read()
      expect(requests.filter((url) => url.pathname === '/git/diff/blob')).toHaveLength(1)
      expect(read.kind === 'ready' && read.input.files[0]?.kind).toBe(
        response === 'full' ? 'full' : 'partial',
      )
    })
    const read = lease.read()
    if (read.kind !== 'ready' || read.input.kind !== 'checkpoint')
      throw new RangeError('retained checkpoint required')
    expect(queries.getQueryData(snapshotComparisonQueryOptions(document.source).queryKey)).toBe(
      listed,
    )
    expect(read.input.files[0]?.hunks).toBe(listed[0]!.hunks)
    expect(read.input.files[1]?.hunks).toBe(listed[1]!.hunks)
    expect(read.input.files[1]?.kind).toBe('partial')
    const full = read.input.files[0]
    if (response === 'full' && full?.kind === 'full') {
      expect(full.old).toMatchObject({ kind: 'blob', text: 'before\n' })
      expect(full.new).toMatchObject({ kind: 'blob', text: 'after\n' })
    }
    if (response !== 'full') {
      expect(full?.kind === 'partial' && full.display[0]?.isPartial).toBe(true)
      expect(full && 'old' in full).toBe(false)
      expect(await screen.findByRole('status')).toHaveTextContent('Changed lines only.')
    }
    const blobs = requests.filter((url) => url.pathname === '/git/diff/blob')
    expect(blobs).toHaveLength(1)
    expect(blobs[0]!.searchParams.get('path')).toBe(listed[0]!.path)
    expect(blobs[0]!.searchParams.get('oldObjectId')).toBe(listed[0]!.oldObjectId)
    expect(blobs[0]!.searchParams.get('newObjectId')).toBe(listed[0]!.newObjectId)
    expect(prior.kind === 'ready' && prior.input.files[0]?.kind).toBe('partial')
    const external = runtime.documentStore
      .getState()
      .acquireSnapshotComparison({ input: read.input, signal: new AbortController().signal })
    rendered.unmount()
    expect(lease.read().kind).toBe('ready')
    h.application.dispose()
    expect(lease.read()).toEqual({ kind: 'released', reason: 'interest-ended' })
    expect(external.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
    expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
    controlled.endEventStreams()
    queries.clear()
  })
}
