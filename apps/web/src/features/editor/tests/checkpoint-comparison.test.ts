import { fetchBlobDiff, blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkpointRefForSessionTurn } from 'server/testing'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createSnapshotComparisonOwner } from '@/features/editor/state/snapshot-comparison-owner'
import {
  checkpointTurnDocument,
  checkpointFileDocument,
  fetchCheckpointDiff,
} from '@/lib/checkpoint-diff-query'
import { checkpointRequest } from '@/lib/documents/utils/comparisons'
import { checkpointComparisonInput } from '@/lib/snapshot-comparison-input'
import { snapshotComparisonQueryOptions } from '@/lib/snapshot-comparison-query'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'
import { checkpointTurn } from '../../../../test/factories/checkpoint-turn'
import { runGit } from '../../../../test/factories/git'
import { expect, test } from '../../../../test/fixtures'

test('same checkpoint range with changed actual refs has separate immutable captures', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server)
  const runtime = h.application.getSnapshot().editor
  const scope = { environmentId: runtime.storage.environmentId, rootPath: filesystemPath('') }
  const comparison = checkpointTurnDocument(h.summary, scope.rootPath, false).source
  const firstDiffs = await fetchCheckpointDiff(checkpointRequest(comparison), undefined, client)
  const firstInput = checkpointComparisonInput({ scope, comparison, diffs: firstDiffs })
  const queries = runtime.queryClient
  const key = snapshotComparisonQueryOptions(comparison).queryKey
  queries.setQueryData(key, firstDiffs)
  const owner = createSnapshotComparisonOwner(runtime.documentStore, queries)
  const tab = tabId('captured-checkpoint')
  owner.prepare(tab, scope, comparison)
  const logical = runtime.documentStore.getState().snapshotComparisonTabs.get(tab)!
  const first = runtime.documentStore
    .getState()
    .acquireSnapshotComparison({ input: firstInput, signal: new AbortController().signal })
  const held = logical.read()
  await writeFile(join(server.root, 'app.txt'), 'replacement\n')
  runGit(server.root, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qam',
    'replace checkpoint ref',
  ])
  runGit(server.root, ['update-ref', checkpointRefForSessionTurn(h.summary.sessionId, 1), 'HEAD'])
  const secondDiffs = await fetchCheckpointDiff(checkpointRequest(comparison), undefined, client)
  const secondInput = checkpointComparisonInput({ scope, comparison, diffs: secondDiffs })
  expect(secondInput.files[0]?.revision).not.toEqual(firstInput.files[0]?.revision)
  const second = runtime.documentStore
    .getState()
    .acquireSnapshotComparison({ input: secondInput, signal: new AbortController().signal })
  expect(first.read()).toEqual({ kind: 'ready', input: firstInput })
  expect(second.read()).toEqual({ kind: 'ready', input: secondInput })
  expect(first.refresh(secondInput, first.requestRefresh())).toBe(false)
  queries.setQueryData(key, secondDiffs)
  expect(runtime.documentStore.getState().snapshotComparisonTabs.get(tab)).toBe(logical)
  expect(logical.read()).toBe(held)
  owner.dispose()
  first.release()
  expect(second.read().kind).toBe('ready')
  second.release()
  expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('checkpoint cancellation, logical copy, trim and stale settlement preserve the surviving capture and dirty Undo', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server)
  const runtime = h.application.getSnapshot().editor
  const documents = runtime.documentStore
  const queries = runtime.queryClient
  const scope = { environmentId: runtime.storage.environmentId, rootPath: filesystemPath('') }
  const comparison = checkpointTurnDocument(h.summary, scope.rootPath, false).source
  const diffs = await fetchCheckpointDiff(checkpointRequest(comparison), undefined, client)
  const key = snapshotComparisonQueryOptions(comparison).queryKey
  queries.setQueryData(key, diffs)
  const owner = createSnapshotComparisonOwner(documents, queries)
  const firstId = tabId('checkpoint-first')
  const copyId = tabId('checkpoint-copy')
  owner.prepare(firstId, scope, comparison)
  documents.getState().copyEditorView(firstId, copyId)
  const first = documents.getState().snapshotComparisonTabs.get(firstId)!
  const copy = documents.getState().snapshotComparisonTabs.get(copyId)!
  const read = first.read()
  if (read.kind !== 'ready') throw new RangeError('captured checkpoint required')
  const canceled = new AbortController()
  const external = documents
    .getState()
    .acquireSnapshotComparison({ input: read.input, signal: canceled.signal })
  expect(external.read()).toBe(copy.read())
  canceled.abort()
  expect(external.read()).toEqual({ kind: 'released', reason: 'interest-ended' })
  expect(copy.read()).toBe(read)
  const file = await fetchFile(filesystemPath('app.txt'), new AbortController().signal, client)
  const live = documents.getState().ensureLiveEditorDocument(file)
  const editor = createEditorBufferSession(live.buffer)
  editor.applyText('dirty')
  const dirty = live.buffer.materializeFullText()
  documents.getState().retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set([copyId]) })
  expect(first.read().kind).toBe('released')
  expect(copy.read()).toBe(read)
  queries.setQueryData(key, diffs)
  owner.prepare(firstId, scope, comparison, { activate: false })
  expect(documents.getState().snapshotComparisons.size).toBe(1)
  copy.release()
  expect(documents.getState().snapshotComparisons.size).toBe(0)
  expect(live.buffer.materializeFullText()).toBe(dirty)
  expect(live.buffer.canUndo()).toBe(true)
  editor.undo()
  expect(live.buffer.materializeFullText()).toBe(file.content)
  expect(documents.getState().getLiveEditorDocument(live.key)?.buffer).toBe(live.buffer)
  owner.dispose()
  queries.clear()
})

test('checkpoint domain admission preserves partial, binary, size and missing outcomes and refuses foreign roots', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server)
  const runtime = h.application.getSnapshot().editor
  const scope = { environmentId: runtime.storage.environmentId, rootPath: filesystemPath('') }
  const comparison = checkpointTurnDocument(h.summary, scope.rootPath, false).source
  const diffs = await fetchCheckpointDiff(checkpointRequest(comparison), undefined, client)
  const original = diffs[0]!
  const partial = checkpointComparisonInput({ scope, comparison, diffs })
  expect(partial.files.map((file) => file.kind)).toEqual(['partial', 'partial'])
  const wrong = checkpointComparisonInput({
    scope,
    comparison,
    diffs,
    hydrated: [{ ...original, path: 'foreign.txt', oldText: 'before\n', newText: 'after\n' }],
  })
  expect(wrong.files[0]?.kind).toBe('partial')
  const binary = checkpointComparisonInput({
    scope,
    comparison,
    diffs: [{ ...original, patch: '\nBinary files a/app.txt and b/app.txt differ\n' }],
  })
  expect(binary.files[0]).toMatchObject({ kind: 'no-text', reason: 'binary' })
  const size = checkpointComparisonInput({
    scope,
    comparison,
    diffs: [{ ...original, omitted: 'size' }],
  })
  expect(size.files[0]).toMatchObject({ kind: 'no-text', reason: 'size' })
  const missing = checkpointComparisonInput({
    scope,
    comparison,
    diffs: [
      {
        ...original,
        oldObjectId: undefined,
        oldFileMissing: true,
        oldText: '',
        newText: 'after\n',
      },
    ],
  })
  expect(missing.files[0]).toMatchObject({
    kind: 'full',
    old: { kind: 'missing', path: original.path },
    revision: { old: { kind: 'missing' } },
  })
  expect(() =>
    runtime.documentStore.getState().acquireSnapshotComparison({
      input: { ...partial, scope: { ...scope, rootPath: filesystemPath('foreign') } },
      signal: new AbortController().signal,
    }),
  ).toThrow()
  expect(runtime.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('a provided checkpoint status must match the actual captured file while an optional fallback stays valid', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server)
  const runtime = h.application.getSnapshot().editor
  const scope = { environmentId: runtime.storage.environmentId, rootPath: filesystemPath('') }
  const turn = checkpointTurnDocument(h.summary, scope.rootPath, false).source
  const diffs = await fetchCheckpointDiff(checkpointRequest(turn), undefined, client)
  const diff = diffs[0]!
  const target = checkpointFileDocument(
    h.summary,
    filesystemPath(diff.path),
    diff,
    scope.rootPath,
    false,
  ).source
  const hydrated = await fetchBlobDiff(diff, undefined, client)
  const actual = checkpointComparisonInput({ scope, comparison: target, diffs: [diff], hydrated })
  expect(actual.files[0]).toMatchObject({ kind: 'full', revision: { status: 'modified' } })
  const forged = checkpointComparisonInput({
    scope,
    comparison: { ...target, status: 'deleted' },
    diffs: [diff],
    hydrated,
  })
  expect(forged.files[0]).toMatchObject({
    kind: 'no-text',
    reason: 'unavailable',
    revision: { status: 'modified' },
  })
  expect(forged.files[0] && 'old' in forged.files[0]).toBe(false)
  const fallback = checkpointComparisonInput({
    scope,
    comparison: { ...target, status: undefined },
    diffs: [diff],
    hydrated,
  })
  expect(fallback.files[0]).toMatchObject({ kind: 'full', revision: { status: 'modified' } })
  expect(actual.files[0]?.hunks).toBe(diff.hunks)
  expect(fallback.files[0]?.hunks).toBe(diff.hunks)
})

test('a full checkpoint capture survives actual blob cache eviction, unrelated success and a new partial interest', async ({
  client,
  server,
}) => {
  const h = await checkpointTurn(client, server)
  const runtime = h.application.getSnapshot().editor
  const documents = runtime.documentStore
  const queries = runtime.queryClient
  const scope = { environmentId: runtime.storage.environmentId, rootPath: filesystemPath('') }
  const comparison = checkpointTurnDocument(h.summary, scope.rootPath, false).source
  const listed = await fetchCheckpointDiff(checkpointRequest(comparison), undefined, client)
  queries.setQueryData(snapshotComparisonQueryOptions(comparison).queryKey, listed)
  const owner = createSnapshotComparisonOwner(documents, queries)
  const tab = tabId('full-capture')
  owner.prepare(tab, scope, comparison)
  const logical = documents.getState().snapshotComparisonTabs.get(tab)!
  const partial = logical.read()
  if (partial.kind !== 'ready') throw new RangeError('partial checkpoint capture required')
  const external = documents
    .getState()
    .acquireSnapshotComparison({ input: partial.input, signal: new AbortController().signal })
  const options = blobDiffQueryOptions(listed[0]!)
  await queries.query(options)
  const full = logical.read()
  expect(
    full.kind === 'ready' && full.input.kind === 'checkpoint' && full.input.files[0]?.kind,
  ).toBe('full')
  expect(external.read()).toBe(full)
  queries.removeQueries({ queryKey: options.queryKey, exact: true })
  expect(queries.getQueryData(options.queryKey)).toBeUndefined()
  queries.setQueryData(['checkpoint-unrelated'], { success: true })
  expect(logical.read()).toBe(full)
  expect(external.read()).toBe(full)
  const newcomer = documents
    .getState()
    .acquireSnapshotComparison({ input: partial.input, signal: new AbortController().signal })
  expect(newcomer.read()).toBe(full)
  owner.dispose()
  expect(logical.read().kind).toBe('released')
  expect(external.read()).toBe(full)
  external.release()
  expect(newcomer.read()).toBe(full)
  newcomer.release()
  expect(documents.getState().snapshotComparisons.size).toBe(0)
  queries.clear()
})
