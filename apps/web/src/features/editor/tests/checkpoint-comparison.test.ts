import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkpointRefForSessionTurn } from 'server/testing'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { createSnapshotComparisonOwner } from '@/features/editor/state/snapshot-comparison-owner'
import { checkpointTurnDocument, fetchCheckpointDiff } from '@/lib/checkpoint-diff-query'
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
  const first = runtime.documentStore
    .getState()
    .acquireSnapshotComparison({ input: firstInput, signal: new AbortController().signal })
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
  queries.setQueryData(key, [...diffs])
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
