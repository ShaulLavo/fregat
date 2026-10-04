import { expect, test } from '../../../../test/fixtures'
import { createSnapshotComparisonFixture } from '../../../../test/factories/snapshot-comparison'
import { createTestQueryClient } from '../../../../test/render'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { createSnapshotComparisonOwner } from '@/features/editor/state/snapshot-comparison-owner'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { tabId } from '@/lib/documents/utils/identity'

test('adopts cached sources synchronously before tab publication and shares them across two views', async ({
  server,
  client,
}) => {
  const f = await createSnapshotComparisonFixture(server.root, client)
  const queries = createTestQueryClient()
  queries.setQueryData(blobDiffQueryOptions(f.comparison).queryKey, [f.worktree])
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
  queries.setQueryData(blobDiffQueryOptions(f.comparison).queryKey, [f.worktree])
  expect(documents.getState().snapshotComparisonTabs.has(tab)).toBe(false)
  queries.setQueryData(blobDiffQueryOptions(f.stagedInput.comparison).queryKey, [f.staged])
  const read = documents.getState().snapshotComparisonTabs.get(tab)?.read()
  expect(read?.kind).toBe('ready')
  if (read?.kind === 'ready') expect(read.input.comparison.source).toBe('staged')
  owner.dispose()
  queries.setQueryData(blobDiffQueryOptions(f.stagedInput.comparison).queryKey, [
    ...f.historicalDiffs,
  ])
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
  const key = blobDiffQueryOptions(f.comparison).queryKey
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
  if (read?.kind === 'ready') expect(read.input.files[0]?.kind).toBe('full')
  expect(documents.getState().snapshotComparisons.size).toBe(1)
  stop()
  owner.dispose()
  documents.getState().disposeEditorDocuments()
  queries.clear()
})
