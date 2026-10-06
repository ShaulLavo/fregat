import { environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { applyWorkspaceEvents } from '@/features/workspace/hooks/use-events'
import { createWideEventScope } from '@/lib/wide-event-scope'
import { fetchFile } from '@/lib/file-server'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { captureFilesystemLocal, filesystemComparisonInput } from '@/lib/snapshot-comparison'
import { filesystemDiffAttachment } from '@/features/editor/utils/attachment-presentation'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import {
  retainFilesystemConflict,
  notifyChangedFilesystemConflict,
  markDeletedFilesystemDocument,
  notifyRenamedFilesystemConflict,
} from '@/features/workspace/state/event-conflict-adapter'
import { createConflictResolutionFixture } from '../../../../test/factories/conflict-resolution'
import { createConflictCompletionFixture } from '../../../../test/factories/conflict-completion'
import { expect, test } from '../../../../test/fixtures'

test('filesystem notification retains the actual immutable local source and an admitted interest', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' local')
  const snapshot = f.destination.buffer.getTextSnapshot()
  notifyChangedFilesystemConflict(f.path, f.remote, f.context)
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  expect(conflict).toHaveProperty('latest')
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(1)
  expect(snapshot.materializeFullText()).toBe('remote text local')
})

test('metadata clones retain references and separate equal-text captures never join independent interests', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' local')
  notifyChangedFilesystemConflict(f.path, f.remote, f.context)
  const state = f.editor.conflictStore.getState()
  const original = Object.values(state.conflicts)[0]!
  state.updateConflict(original.id, { toastId: 'same-id-metadata' })
  const cloned = f.editor.conflictStore.getState().conflicts[original.id]!
  expect(cloned).not.toBe(original)
  expect(cloned.latest).toBe(original.latest)
  const documents = f.editor.documentStore.getState()
  const firstAbort = new AbortController()
  const first = documents.acquireSnapshotComparison({
    input: cloned.latest.input,
    signal: firstAbort.signal,
  })
  const second = documents.acquireSnapshotComparison({
    input: cloned.latest.input,
    signal: new AbortController().signal,
  })
  expect(first.read()).toBe(second.read())
  expect(first.read()).toBe(cloned.latest.lease.read())
  firstAbort.abort()
  expect(first.read().kind).toBe('released')
  expect(second.read().kind).toBe('ready')
  const distinct = filesystemComparisonInput({ ...cloned.latest.input.capture })
  const other = documents.acquireSnapshotComparison({
    input: distinct,
    signal: new AbortController().signal,
  })
  expect(other.read()).not.toBe(second.read())
  expect(distinct.capture.local).toBe(cloned.latest.input.capture.local)
  const stale = second.requestRefresh()
  second.requestRefresh()
  expect(second.refresh(cloned.latest.input, stale)).toBe(false)
  const wrongRoot = {
    ...cloned.latest.input,
    scope: { ...cloned.latest.input.scope, rootPath: filesystemPath('different-root') },
  }
  expect(() =>
    documents.acquireSnapshotComparison({ input: wrongRoot, signal: new AbortController().signal }),
  ).toThrow()
  const foreignEnvironment = v.parse(environmentIdSchema, '10000000-0000-4000-8000-000000000999')
  const wrongOwner = {
    ...cloned.latest.input,
    scope: { ...cloned.latest.input.scope, environmentId: foreignEnvironment },
  }
  expect(() =>
    documents.acquireSnapshotComparison({
      input: wrongOwner,
      signal: new AbortController().signal,
    }),
  ).toThrow()
  second.release()
  expect(cloned.latest.lease.read().kind).toBe('ready')
  f.editor.conflictStore.getState().clearConflicts()
  expect(cloned.latest.lease.read().kind).toBe('released')
  expect(other.read().kind).toBe('ready')
  other.release()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('held rename retains the original local snapshot and cancellation refuses late publication', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  createEditorBufferSession(f.destination.buffer).applyText(' captured')
  const snapshot = f.destination.buffer.getTextSnapshot()
  await writeFile(join(server.root, 'renamed.txt'), 'incoming text')
  f.holdRefetch()
  const pending = notifyRenamedFilesystemConflict(f.path, filesystemPath('renamed.txt'), f.context)
  await f.entered.promise
  createEditorBufferSession(f.destination.buffer).applyText(' later')
  f.released.resolve()
  await pending
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  expect(conflict.latest.input.capture.local.kind).toBe('text')
  const local = conflict.latest.input.capture.local
  if (local.kind !== 'text') throw new RangeError('Actual captured local required')
  expect(local.buffer).toBe(f.destination.buffer)
  expect(local.snapshot).toBe(snapshot)
  expect(local.snapshot.materializeFullText()).toBe('remote text captured')
  expect(conflict.remoteFile?.content).toBe('incoming text')
  const incoming = conflict.latest.input.capture.incoming
  if (incoming.kind !== 'text') throw new RangeError('Actual incoming text required')
  expect(incoming.file).toBe(conflict.remoteFile)
  expect(incoming.reader.materializeFullText()).toBe('incoming text')
  f.editor.conflictStore.getState().clearConflicts()
  const controller = new AbortController()
  controller.abort()
  await notifyRenamedFilesystemConflict(f.path, filesystemPath('renamed.txt'), {
    ...f.context,
    signal: controller.signal,
  })
  expect(f.editor.conflictStore.getState().conflicts).toEqual({})
})

test('owner disposal ends capture interests and late notifications cannot resurrect membership', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  notifyChangedFilesystemConflict(f.path, f.remote, f.context)
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  f.editor.documentStore.getState().disposeEditorDocuments()
  expect(conflict.latest.lease.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
  f.editor.conflictStore.getState().clearConflicts()
  notifyChangedFilesystemConflict(f.path, f.remote, f.context)
  expect(f.editor.conflictStore.getState().conflicts).toEqual({})
})

test('watcher entry captures local source before save/query awaits while current write metadata stays current', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  const editing = createEditorBufferSession(f.destination.buffer)
  editing.applyText(' at event')
  const beforeAwait = f.destination.buffer.getTextSnapshot()
  await writeFile(join(server.root, f.path), 'incoming changed')
  const incoming = await fetchFile(f.path, new AbortController().signal, f.context.client)
  f.holdRefetch()
  const documents = f.editor.documentStore.getState()
  const scope = createWideEventScope({ action: 'test.filesystem-capture-before-await', area: 'fs' })
  const pending = applyWorkspaceEvents({
    ...f.context,
    acquireSnapshotComparison: documents.acquireSnapshotComparison,
    dirtyDocumentKeys: documents.dirtyDocumentKeys,
    events: [{ type: 'changed', path: f.path, version: incoming.version }],
    isOwnWorkspaceEditEvent: () => false,
    openFilePaths: [f.path],
    rootPath: '',
    scope,
    scheduleGitInvalidation: () => undefined,
  })
  await f.entered.promise
  editing.applyText(' after await')
  f.released.resolve()
  await pending
  const conflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  const local = conflict.latest.input.capture.local
  if (local.kind !== 'text') throw new RangeError('Actual event capture required')
  expect(local.snapshot).toBe(beforeAwait)
  expect(local.snapshot.materializeFullText()).toBe('remote text at event')
  expect(conflict.localText).toBe('remote text at event after await')
  expect(conflict.latest.input.scope.environmentId).toBe(f.environmentId)
  expect(conflict.latest.input.scope.rootPath).toBe(filesystemPath(''))
  scope.end()
})

test('cancel during a held renamed read prevents late source membership', async ({ server }) => {
  const f = await createConflictCompletionFixture(server)
  await writeFile(join(server.root, 'cancelled.txt'), 'incoming')
  const controller = new AbortController()
  f.holdRefetch()
  const pending = notifyRenamedFilesystemConflict(f.path, filesystemPath('cancelled.txt'), {
    ...f.context,
    signal: controller.signal,
  })
  const observed = pending.catch((error) => error)
  await f.entered.promise
  controller.abort()
  f.released.resolve()
  await observed
  expect(f.editor.conflictStore.getState().conflicts).toEqual({})
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

test('actual empty, missing, deleted and PDF incoming sources keep their recorded outcomes', async ({
  server,
}) => {
  const f = await createConflictCompletionFixture(server)
  const emptyPath = filesystemPath('empty.txt')
  await writeFile(join(server.root, emptyPath), '')
  const empty = await fetchFile(emptyPath, new AbortController().signal, f.context.client)
  f.documents.ensureLiveEditorDocument(empty)
  notifyChangedFilesystemConflict(emptyPath, empty, f.context)
  const emptyConflict = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  const incoming = emptyConflict.latest.input.capture.incoming
  if (incoming.kind !== 'text') throw new RangeError('Actual empty text required')
  expect(incoming.file).toBe(empty)
  expect(incoming.reader.materializeFullText()).toBe('')
  expect(emptyConflict.latest.input.display.kind).toBe('text')
  expect(filesystemDiffAttachment(emptyConflict.latest.lease.read(), 'latest')).not.toBeNull()
  f.editor.conflictStore.getState().clearConflicts()

  const missingPath = filesystemPath('unopened.txt')
  await writeFile(join(server.root, missingPath), 'unopened incoming')
  const unopened = await fetchFile(missingPath, new AbortController().signal, f.context.client)
  notifyChangedFilesystemConflict(missingPath, unopened, f.context)
  const missing = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  expect(missing.latest.input.capture.local).toEqual({ kind: 'missing', path: missingPath })
  expect(missing.latest.input.display).toEqual({ kind: 'no-text', reason: 'local-missing' })
  expect(filesystemDiffAttachment(missing.latest.lease.read(), 'latest')).toBeNull()
  f.editor.conflictStore.getState().clearConflicts()

  notifyChangedFilesystemConflict(f.path, f.remote, f.context)
  await rm(join(server.root, f.path))
  markDeletedFilesystemDocument(f.path, f.context)
  const deleted = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  expect(deleted.latest.input.capture.incoming).toEqual({ kind: 'deleted', path: f.path })
  expect(deleted.latest.input.display.kind).toBe('text')
  const deletedAttachment = filesystemDiffAttachment(deleted.latest.lease.read(), 'latest')
  expect(deletedAttachment?.file.oldPath).toBe(f.path)
  f.editor.conflictStore.getState().clearConflicts()

  const pdfPath = filesystemPath('incoming.pdf')
  await writeFile(join(server.root, pdfPath), '%PDF-1.7\n%%EOF\n')
  await notifyRenamedFilesystemConflict(f.path, pdfPath, f.context)
  const pdf = Object.values(f.editor.conflictStore.getState().conflicts)[0]!
  expect(pdf.latest.input.capture.incoming).toEqual({ kind: 'unsupported', file: pdf.remoteFile })
  expect(pdf.latest.input.display).toEqual({ kind: 'no-text', reason: 'unsupported' })
  expect(filesystemDiffAttachment(pdf.latest.lease.read(), 'latest')).toBeNull()
  f.editor.conflictStore.getState().clearConflicts()
  expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
})

for (const end of ['none', 'remove', 'clear'] as const) {
  test(`replacement publication preserves reentrant termination: ${end}`, async ({ server }) => {
    const f = await createConflictResolutionFixture(server)
    const original = f.conflictStore.getState().conflicts[f.target.conflictId]
    if (!original?.seed) throw new RangeError('Actual seeded conflict required')
    const replacement = retainFilesystemConflict(
      original,
      {
        comparisonScope: original.latest.input.scope,
        acquireSnapshotComparison: f.documentStore.getState().acquireSnapshotComparison,
        signal: new AbortController().signal,
      },
      captureFilesystemLocal(f.path, f.destination.buffer),
    )
    let ended = false
    const stop = f.documentStore.subscribe((state) => {
      if (end === 'none' || ended || original.latest.lease.read().kind !== 'released') return
      ended = true
      expect(state.snapshotComparisons.has(original.latest.lease)).toBe(false)
      if (end === 'remove') f.conflictStore.getState().removeConflict(original.id)
      if (end === 'clear') f.conflictStore.getState().clearConflicts()
    })
    try {
      f.conflictStore.getState().addConflict(replacement)
      expect(original.latest.lease.read().kind).toBe('released')
      const current = f.conflictStore.getState().conflicts[original.id]
      if (end === 'none') {
        expect(current?.latest).toBe(replacement.latest)
        expect(current?.seed).toBe(original.seed)
        expect(original.seed.comparison.lease.read().kind).toBe('ready')
        expect(f.documentStore.getState().snapshotComparisons.size).toBe(2)
        expect(() => expect(current).toBeUndefined()).toThrow()
        return
      }
      expect(ended).toBe(true)
      expect(current).toBeUndefined()
      expect(replacement.latest.lease.read().kind).toBe('released')
      expect(original.seed.comparison.lease.read().kind).toBe('released')
      expect(f.documentStore.getState().snapshotComparisons.size).toBe(0)
    } finally {
      stop()
      replacement.latest.lease.release()
      f.dispose()
    }
  })
}

test('public map publication before release keeps a reentrant clear terminal', async ({
  server,
}) => {
  const f = await createConflictResolutionFixture(server)
  const original = f.conflictStore.getState().conflicts[f.target.conflictId]
  if (!original?.seed) throw new RangeError('Actual seeded conflict required')
  const replacement = retainFilesystemConflict(
    original,
    {
      comparisonScope: original.latest.input.scope,
      acquireSnapshotComparison: f.documentStore.getState().acquireSnapshotComparison,
      signal: new AbortController().signal,
    },
    captureFilesystemLocal(f.path, f.destination.buffer),
  )
  let ended = false
  const stop = f.documentStore.subscribe(() => {
    if (ended || original.latest.lease.read().kind !== 'released') return
    ended = true
    f.conflictStore.getState().clearConflicts()
  })
  try {
    f.conflictStore.setState((state) => ({
      conflicts: { ...state.conflicts, [original.id]: replacement },
    }))
    original.latest.lease.release()
    expect(ended).toBe(true)
    expect(f.conflictStore.getState().conflicts).toEqual({})
    expect(f.documentStore.getState().snapshotComparisons.size).toBe(0)
    expect(replacement.latest.lease.read().kind).toBe('released')
    expect(original.seed.comparison.lease.read().kind).toBe('released')
  } finally {
    stop()
    replacement.latest.lease.release()
    f.dispose()
  }
})

for (const end of ['remove', 'clear'] as const) {
  test(`notification acquisition publication refuses an ended incumbent: ${end}`, async ({
    server,
  }) => {
    const f = await createConflictCompletionFixture(server)
    notifyChangedFilesystemConflict(f.path, f.remote, f.context)
    const original = Object.values(f.editor.conflictStore.getState().conflicts)[0]
    if (!original) throw new RangeError('Actual notified conflict required')
    let ended = false
    const stop = f.editor.documentStore.subscribe((state) => {
      if (
        ended ||
        state.snapshotComparisons.size !== 2 ||
        original.latest.lease.read().kind !== 'ready'
      )
        return
      ended = true
      if (end === 'remove') f.editor.conflictStore.getState().removeConflict(original.id)
      if (end === 'clear') f.editor.conflictStore.getState().clearConflicts()
    })
    try {
      notifyChangedFilesystemConflict(f.path, f.remote, f.context)
      expect(ended).toBe(true)
      expect(f.editor.conflictStore.getState().conflicts).toEqual({})
      expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(0)
      stop()
      notifyChangedFilesystemConflict(f.path, f.remote, f.context)
      const fresh = Object.values(f.editor.conflictStore.getState().conflicts)[0]
      expect(fresh?.id).not.toBe(original.id)
      expect(fresh?.latest.lease.read().kind).toBe('ready')
      expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(1)
    } finally {
      stop()
      f.editor.conflictStore.getState().clearConflicts()
    }
  })

  test(`seed replacement publication preserves reentrant termination: ${end}`, async ({
    server,
  }) => {
    const f = await createConflictResolutionFixture(server)
    const original = f.conflictStore.getState().conflicts[f.target.conflictId]
    if (!original?.seed) throw new RangeError('Actual seeded conflict required')
    const originalSeed = original.seed
    const lease = f.documentStore.getState().acquireSnapshotComparison({
      input: original.latest.input,
      signal: new AbortController().signal,
    })
    const seed = { ...originalSeed, comparison: { input: original.latest.input, lease } }
    let ended = false
    const stop = f.documentStore.subscribe(() => {
      if (ended || originalSeed.comparison.lease.read().kind !== 'released') return
      ended = true
      if (end === 'remove') f.conflictStore.getState().removeConflict(original.id)
      if (end === 'clear') f.conflictStore.getState().clearConflicts()
    })
    try {
      f.conflictStore.getState().updateConflict(original.id, { seed })
      expect(ended).toBe(true)
      expect(f.conflictStore.getState().conflicts).toEqual({})
      expect(lease.read().kind).toBe('released')
      expect(f.documentStore.getState().snapshotComparisons.size).toBe(0)
    } finally {
      stop()
      lease.release()
      f.dispose()
    }
  })
}

for (const end of ['remove', 'clear'] as const) {
  test(`terminal publication permits a fresh notification after ${end}`, async ({ server }) => {
    const f = await createConflictCompletionFixture(server)
    createEditorBufferSession(f.destination.buffer).applyText(' local')
    notifyChangedFilesystemConflict(f.path, f.remote, f.context)
    const original = Object.values(f.editor.conflictStore.getState().conflicts)[0]
    if (!original) throw new RangeError('Actual notified conflict required')
    let entered = false
    const stop = f.editor.documentStore.subscribe(() => {
      if (entered || original.latest.lease.read().kind !== 'released') return
      entered = true
      expect(f.editor.conflictStore.getState().conflicts).toEqual({})
      notifyChangedFilesystemConflict(f.path, f.remote, f.context)
    })
    try {
      if (end === 'remove') f.editor.conflictStore.getState().removeConflict(original.id)
      if (end === 'clear') f.editor.conflictStore.getState().clearConflicts()
      const fresh = Object.values(f.editor.conflictStore.getState().conflicts)[0]
      expect(entered).toBe(true)
      expect(fresh?.id).not.toBe(original.id)
      expect(fresh?.latest.lease.read().kind).toBe('ready')
      expect(f.editor.documentStore.getState().snapshotComparisons.size).toBe(1)
    } finally {
      stop()
      f.editor.conflictStore.getState().clearConflicts()
    }
  })
}
