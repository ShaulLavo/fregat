import { expect, test } from '../../../../test/fixtures'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { createTestQueryClient } from '../../../../test/render'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createSnapshotComparisonOwner } from '@/features/editor/state/snapshot-comparison-owner'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { tabId } from '@/lib/documents/utils/identity'

test('adopts cached sources synchronously before tab publication and shares them across two views', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  queries.setQueryData(snapshotComparisonQueryOptions(f.comparison).queryKey, [f.worktree])
  const documents = createEditorDocumentStore({ environmentId: testScopedStorage.environmentId })
  const owner = createSnapshotComparisonOwner(documents, queries)
  owner.prepare(tabId('first'), f.scope, f.comparison)
  owner.prepare(tabId('second'), f.scope, f.comparison)
  const state = documents.getState()
  const first = state.snapshotComparisonTabs.get(tabId('first'))
  const second = state.snapshotComparisonTabs.get(tabId('second'))
  expect(first?.read().kind).toBe('ready')
  expect(first?.read()).toBe(second?.read())
  owner.retain(new Set([tabId('second')]))
  expect(first?.read().kind).toBe('released')
  expect(second?.read().kind).toBe('ready')
  owner.dispose()
  expect(second?.read().kind).toBe('released')
  documents.getState().disposeEditorDocuments()
  queries.clear()
})

test('query settlement adopts only the captured current subject and rejects late former-subject data', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  const documents = createEditorDocumentStore({ environmentId: f.scope.environmentId })
  const owner = createSnapshotComparisonOwner(documents, queries)
  const tab = tabId('moving-view')
  owner.prepare(tab, f.scope, f.comparison)
  owner.prepare(tab, f.scope, f.stagedInput.comparison)
  queries.setQueryData(snapshotComparisonQueryOptions(f.comparison).queryKey, [f.worktree])
  expect(documents.getState().snapshotComparisonTabs.has(tab)).toBe(false)
  queries.setQueryData(snapshotComparisonQueryOptions(f.stagedInput.comparison).queryKey, [
    f.staged,
  ])
  const read = documents.getState().snapshotComparisonTabs.get(tab)?.read()
  expect(read?.kind).toBe('ready')
  if (read?.kind === 'ready' && read.input.kind === 'snapshot')
    expect(read.input.comparison.target).toMatchObject({ kind: 'moving', changeSource: 'staged' })
  owner.dispose()
  queries.setQueryData(
    snapshotComparisonQueryOptions(f.stagedInput.comparison).queryKey,
    f.historicalDiffs,
  )
  expect(documents.getState().snapshotComparisons.size).toBe(0)
  documents.getState().disposeEditorDocuments()
  queries.clear()
})

test('a nested query publication during first adoption retains the latest captured data', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  const documents = createEditorDocumentStore({ environmentId: f.scope.environmentId })
  const key = snapshotComparisonQueryOptions(f.comparison).queryKey
  const partial = { ...f.worktree, oldText: undefined, newText: undefined }
  queries.setQueryData(key, [partial])
  const owner = createSnapshotComparisonOwner(documents, queries)
  let nested = false
  const stop = documents.subscribe((state) => {
    if (nested || state.snapshotComparisons.size === 0) return
    nested = true
    queries.setQueryData(key, [f.worktree])
  })
  owner.prepare(tabId('nested'), f.scope, f.comparison)
  const read = documents.getState().snapshotComparisonTabs.get(tabId('nested'))?.read()
  expect(read?.kind).toBe('ready')
  if (read?.kind === 'ready' && read.input.kind === 'snapshot')
    expect(read.input.files[0]?.kind).toBe('full')
  expect(documents.getState().snapshotComparisons.size).toBe(1)
  stop()
  owner.dispose()
  documents.getState().disposeEditorDocuments()
  queries.clear()
})

test('document retention suspends only the ended binding while a logical copy and other interest survive', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  const documents = createEditorDocumentStore({ environmentId: f.scope.environmentId })
  const owner = createSnapshotComparisonOwner(documents, queries)
  const key = snapshotComparisonQueryOptions(f.comparison).queryKey
  const firstId = tabId('first')
  const secondId = tabId('second')
  const copyId = tabId('copy')
  try {
    queries.setQueryData(key, [f.worktree])
    owner.prepare(firstId, f.scope, f.comparison)
    owner.prepare(secondId, f.scope, f.comparison)
    documents.getState().copyEditorView(firstId, copyId)
    const first = documents.getState().snapshotComparisonTabs.get(firstId)
    const second = documents.getState().snapshotComparisonTabs.get(secondId)
    const copy = documents.getState().snapshotComparisonTabs.get(copyId)
    const external = documents
      .getState()
      .acquireSnapshotComparison({ input: f.input, signal: new AbortController().signal })
    documents
      .getState()
      .retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set([secondId, copyId]) })
    expect(first?.read().kind).toBe('released')
    expect(documents.getState().snapshotComparisons.size).toBe(3)
    queries.setQueryData(key, [{ ...f.worktree, oldText: undefined }])
    owner.prepare(firstId, f.scope, f.comparison, { activate: false })
    expect(documents.getState().snapshotComparisons.size).toBe(3)
    expect(second?.read()).toBe(copy?.read())
    expect(second?.read()).toBe(external.read())
    const read = external.read()
    expect(read.kind).toBe('ready')
    expect(read).toMatchObject({ input: { kind: 'snapshot' } })
    if (read.kind === 'ready' && read.input.kind === 'snapshot')
      expect(read.input.files[0]?.kind).toBe('partial')
    owner.prepare(firstId, f.scope, f.comparison)
    expect(documents.getState().snapshotComparisonTabs.get(firstId)?.read()).toBe(external.read())
    expect(documents.getState().snapshotComparisons.size).toBe(4)
    documents.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
    owner.dispose()
    expect(external.read().kind).toBe('ready')
    expect(documents.getState().snapshotComparisons.size).toBe(1)
    external.release()
    expect(documents.getState().snapshotComparisons.size).toBe(0)
  } finally {
    owner.dispose()
    documents.getState().disposeEditorDocuments()
    queries.clear()
  }
})

test('retention during synchronous first adoption stays suspended until explicit activation', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  const documents = createEditorDocumentStore({ environmentId: f.scope.environmentId })
  const owner = createSnapshotComparisonOwner(documents, queries)
  const key = snapshotComparisonQueryOptions(f.comparison).queryKey
  const tab = tabId('nested-retention')
  let trimmed = false
  const stop = documents.subscribe((state) => {
    if (trimmed || state.snapshotComparisons.size === 0) return
    trimmed = true
    state.retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set() })
  })
  try {
    queries.setQueryData(key, [f.worktree])
    owner.prepare(tab, f.scope, f.comparison)
    expect(trimmed).toBe(true)
    expect(documents.getState().snapshotComparisons.size).toBe(0)
    queries.setQueryData(key, [{ ...f.worktree, newText: undefined }])
    owner.prepare(tab, f.scope, f.comparison, { activate: false })
    expect(documents.getState().snapshotComparisons.size).toBe(0)
    owner.prepare(tab, f.scope, f.comparison)
    expect(documents.getState().snapshotComparisons.size).toBe(1)
  } finally {
    stop()
    owner.dispose()
    documents.getState().disposeEditorDocuments()
    queries.clear()
  }
})
