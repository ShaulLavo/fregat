import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { testDocumentKey, testScrollPositions } from '../../../../test/factories/document-targets'
import { describe, vi } from 'vitest'

import { expect, test as it } from '../../../../test/fixtures'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import type { FileResult } from '@/lib/file-system-types'
import {
  acquireDocumentMutationLease,
  commitPreparedDocumentTransaction,
  createEditorBufferSession,
  createEditorTextBuffer,
  getDocumentMutationLeaseState,
  type EditorTextBuffer,
  type EditorPreparedDocument,
  prepareDocumentTransaction,
  releaseDocumentMutationLease,
  reverseDocumentTransaction,
  subscribeDocumentMutationLeaseState,
} from '@singapore-editor/core'

describe('editor document store state identity', () => {
  it('keeps unrelated slices referentially stable across scroll updates', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    store.getState().ensureEditorView(tabId('tab-2'), fileResult('/repo/b.ts'))
    const before = store.getState()

    store.getState().setEditorViewScrollPosition(tabId('tab-1'), { left: 0, top: 120 })
    const after = store.getState()

    expect(after.scrollPositionByTabId[tabId('tab-1')]).toEqual({ left: 0, top: 120 })
    expect(after.documentContentRevisions).toBe(before.documentContentRevisions)
    expect(after.dirtyDocumentKeys).toBe(before.dirtyDocumentKeys)
    expect(after.liveDocumentsByKey).toBe(before.liveDocumentsByKey)

    // Only the scrolled tab's view projection is replaced; its stable fields
    // and the other tab's projection keep their identity.
    expect(after.viewsByTabId[tabId('tab-1')]).not.toBe(before.viewsByTabId[tabId('tab-1')])
    expect(after.viewsByTabId[tabId('tab-1')]?.view).toBe(before.viewsByTabId[tabId('tab-1')]?.view)
    expect(after.viewsByTabId[tabId('tab-2')]).toBe(before.viewsByTabId[tabId('tab-2')])
  })

  it('keeps other document projections stable across text changes', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    store.getState().ensureEditorView(tabId('tab-2'), fileResult('/repo/b.ts'))
    const before = store.getState()

    const document = store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))!
    createEditorBufferSession(document.buffer).applyText('!')
    const after = store.getState()

    expect(after.liveDocumentsByKey).not.toBe(before.liveDocumentsByKey)
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/a.ts')]).not.toBe(
      before.liveDocumentsByKey[testDocumentKey('/repo/a.ts')],
    )
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/b.ts')]).toBe(
      before.liveDocumentsByKey[testDocumentKey('/repo/b.ts')],
    )
    expect(after.viewsByTabId).toBe(before.viewsByTabId)
  })

  it('records one dirty revision for one buffer transaction observed by two views', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    store.getState().ensureEditorView(tabId('tab-2'), fileResult('/repo/a.ts'))
    const before = store.getState()
    let publications = 0
    const unsubscribe = store.subscribe(() => {
      publications += 1
    })

    createEditorBufferSession(first.buffer, first.view).applyText('!')

    const after = store.getState()
    expect(after.dirtyContentRevision).toBe(before.dirtyContentRevision + 1)
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/a.ts')]?.localRevision).toBe(
      first.buffer.getRevision(),
    )
    expect(after.dirtyDocumentKeys.has(testDocumentKey('/repo/a.ts'))).toBe(true)
    expect(publications).toBe(1)
    unsubscribe()
  })

  it('keeps duplicate tab views and scroll independent while sharing a renamed buffer', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    const second = store.getState().ensureEditorView(tabId('tab-2'), fileResult('/repo/a.ts'))
    store.getState().setEditorViewScrollPosition(tabId('tab-1'), { left: 3, top: 120 })
    store.getState().setEditorViewScrollPosition(tabId('tab-2'), { left: 9, top: 480 })
    createEditorBufferSession(first.buffer, first.view).applyText(' shared')

    expect(second.buffer).toBe(first.buffer)
    expect(second.view).not.toBe(first.view)
    expect(second.buffer.materializeFullText()).toBe('contents of /repo/a.ts shared')
    expect(first.view.getScrollPosition()).toEqual({ left: 3, top: 120 })
    expect(second.view.getScrollPosition()).toEqual({ left: 9, top: 480 })

    store
      .getState()
      .renameLiveEditorDocumentPath(
        filesystemPath('/repo/a.ts'),
        filesystemPath('/repo/renamed.ts'),
      )

    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toBeNull()
    expect(
      store.getState().getLiveEditorDocument(testDocumentKey('/repo/renamed.ts'))?.buffer,
    ).toBe(first.buffer)
    expect(store.getState().getEditorView(tabId('tab-1'))).toMatchObject({
      documentKey: testDocumentKey('/repo/renamed.ts'),
      scrollPosition: { left: 3, top: 120 },
      view: first.view,
    })
    expect(store.getState().getEditorView(tabId('tab-2'))).toMatchObject({
      documentKey: testDocumentKey('/repo/renamed.ts'),
      scrollPosition: { left: 9, top: 480 },
      view: second.view,
    })
    expect(store.getState().dirtyDocumentKeys).toEqual(
      new Set(['/repo/renamed.ts'].map((path) => testDocumentKey(path))),
    )
  })

  it('records a logical synchronize revision without changing content dirty or sync state', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const before = store.getState()
    const result = commitPreparedDocumentTransaction(
      { buffer: document.buffer, sourceView: null },
      prepareDocumentTransaction(
        document.buffer,
        [{ from: 0, to: 1, text: document.buffer.getTextSnapshot().readRange(0, 1) }],
        2,
        null,
      ),
      { history: { groupId: 'logical', kind: 'external-barrier' } },
    )

    expect(result.status).toBe('logical-only')
    const after = store.getState()
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/a.ts')]?.localRevision).toBe(
      document.buffer.getRevision(),
    )
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/a.ts')]?.contentRevision).toBe(
      document.contentRevision,
    )
    expect(after.liveDocumentsByKey[testDocumentKey('/repo/a.ts')]?.sync).toBe(document.sync)
    expect(after.dirtyContentRevision).toBe(before.dirtyContentRevision)
    expect(after.dirtyDocumentKeys).toBe(before.dirtyDocumentKeys)
  })

  it('commits two buffers synchronously with one final WDS publication', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const second = store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))
    const bufferEvents: string[] = []
    first.buffer.subscribe(() => bufferEvents.push('a'))
    second.buffer.subscribe(() => bufferEvents.push('b'))
    let publications = 0
    const unsubscribe = store.subscribe(() => {
      publications += 1
    })

    store.getState().runWorkspaceDocumentBatch(() => {
      commitExternal(first.buffer, 'A')
      commitExternal(second.buffer, 'B')
    })

    expect(bufferEvents).toEqual(['a', 'b'])
    expect(publications).toBe(1)
    expect(store.getState().dirtyDocumentKeys).toEqual(
      new Set(['/repo/a.ts', '/repo/b.ts'].map((path) => testDocumentKey(path))),
    )
    unsubscribe()
  })

  it('prepares an exact live target stamp and rejects it after buffer drift', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const stamp = store.getState().prepareWorkspaceDocumentTarget(document.key)

    expect(stamp).toMatchObject({
      buffer: document.buffer,
      bufferRevision: document.buffer.getRevision(),
      contentRevision: document.contentRevision,
      dirty: false,
      documentKey: document.key,
      localRevision: document.localRevision,
      path: filesystemPath('/repo/a.ts'),
      snapshot: document.buffer.getSnapshot(),
      sync: document.sync,
    })
    expect(store.getState().isWorkspaceDocumentTargetCurrent(stamp!)).toBe(true)

    createEditorBufferSession(document.buffer).applyText('!')

    expect(store.getState().isWorkspaceDocumentTargetCurrent(stamp!)).toBe(false)
  })

  it('preserves a dirty buffer and views across exact-file rename and rollback', () => {
    const store = createEditorDocumentStore()
    const view = store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    createEditorBufferSession(view.buffer, view.view).applyText('!')
    const projection = store
      .getState()
      .prepareWorkspaceDocumentRename(filesystemPath('/repo/a.ts'), filesystemPath('/repo/b.ts'))

    expect(projection).not.toBeNull()
    expect(store.getState().commitWorkspaceDocumentProjection(projection!)).toBe(true)
    const renamed = store.getState().getLiveEditorDocument(testDocumentKey('/repo/b.ts'))!
    expect(renamed.buffer).toBe(view.buffer)
    expect(store.getState().getEditorView(tabId('tab-1'))?.view).toBe(view.view)
    expect(store.getState().dirtyDocumentKeys).toEqual(
      new Set(['/repo/b.ts'].map((path) => testDocumentKey(path))),
    )

    expect(store.getState().rollbackWorkspaceDocumentProjection(projection!)).toBe(true)
    const restored = store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))!
    expect(restored.buffer).toBe(view.buffer)
    expect(store.getState().getEditorView(tabId('tab-1'))?.view).toBe(view.view)
    expect(store.getState().dirtyDocumentKeys).toEqual(
      new Set(['/repo/a.ts'].map((path) => testDocumentKey(path))),
    )
  })

  it('rejects a rename collision before changing either document', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const second = store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))

    expect(
      store
        .getState()
        .prepareWorkspaceDocumentRename(filesystemPath('/repo/a.ts'), filesystemPath('/repo/b.ts')),
    ).toBeNull()
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))?.buffer).toBe(
      first.buffer,
    )
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/b.ts'))?.buffer).toBe(
      second.buffer,
    )
  })

  it('prepares and commits a clean open delete then restores it from a receipt', () => {
    const store = createEditorDocumentStore()
    const view = store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    const projection = store.getState().prepareWorkspaceDocumentDelete(filesystemPath('/repo/a.ts'))

    expect(projection).not.toBeNull()
    expect(store.getState().commitWorkspaceDocumentProjection(projection!)).toBe(true)
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toBeNull()
    expect(store.getState().getEditorView(tabId('tab-1'))).toBeNull()

    expect(store.getState().rollbackWorkspaceDocumentProjection(projection!)).toBe(true)
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))?.buffer).toBe(
      view.buffer,
    )
    expect(store.getState().getEditorView(tabId('tab-1'))?.view).toBe(view.view)
  })

  it('workspace undo returns an originally clean buffer to clean without changing sync metadata', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const sync = document.sync
    const committed = commitExternalWithReceipt(document.buffer, 'A')

    const reversed = reverseDocumentTransaction(
      { buffer: document.buffer, sourceView: null },
      committed.receipt,
    )

    expect(reversed.status).toBe('reversed')
    const after = store.getState().getLiveEditorDocument(document.key)!
    expect(after.buffer.isDirty()).toBe(false)
    expect(after.sync).toBe(sync)
    expect(
      store.getState().dirtyDocumentKeys.has(testDocumentKey(filesystemPath('/repo/a.ts'))),
    ).toBe(false)
    expect(after.localRevision).toBe(document.buffer.getRevision())
  })

  it('workspace undo restores an originally dirty buffer and redo reapplies the group', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    createEditorBufferSession(document.buffer).applyText('!')
    const dirtyText = document.buffer.materializeFullText()
    const committed = commitExternalWithReceipt(document.buffer, 'A')
    const reversed = reverseDocumentTransaction(
      { buffer: document.buffer, sourceView: null },
      committed.receipt,
    )
    if (reversed.status !== 'reversed') throw new RangeError('expected workspace undo')

    expect(document.buffer.materializeFullText()).toBe(dirtyText)
    expect(document.buffer.isDirty()).toBe(true)
    expect(
      store.getState().dirtyDocumentKeys.has(testDocumentKey(filesystemPath('/repo/a.ts'))),
    ).toBe(true)

    const redone = reverseDocumentTransaction(
      { buffer: document.buffer, sourceView: null },
      reversed.receipt,
    )
    expect(redone.status).toBe('reversed')
    expect(document.buffer.materializeFullText().startsWith('A')).toBe(true)
    expect(store.getState().getLiveEditorDocument(document.key)?.localRevision).toBe(
      document.buffer.getRevision(),
    )
  })

  it('restores the seeded scroll position when a view is created', () => {
    const store = createEditorDocumentStore({
      scrollPositionSeeds: testScrollPositions({ '/repo/a.ts': { left: 0, top: 480 } }),
    })

    const view = store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))

    expect(view.scrollPosition).toEqual({ left: 0, top: 480 })
    expect(view.view.getScrollPosition()).toEqual({ left: 0, top: 480 })
  })

  it('reopens a closed tab at its last scroll position', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))
    store.getState().setEditorViewScrollPosition(tabId('tab-1'), { left: 0, top: 240 })
    store.getState().removeEditorView(tabId('tab-1'))

    const reopened = store.getState().ensureEditorView(tabId('tab-2'), fileResult('/repo/a.ts'))

    expect(reopened.scrollPosition).toEqual({ left: 0, top: 240 })
  })

  it('hands back the same document object through both read paths', () => {
    const store = createEditorDocumentStore()

    const returned = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))

    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toBe(returned)
    expect(store.getState().liveDocumentsByKey[testDocumentKey('/repo/a.ts')]).toBe(returned)
  })

  it('hands back the same view object through both read paths', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))

    const view = store.getState().getEditorView(tabId('tab-1'))

    expect(view).not.toBeNull()
    expect(store.getState().viewsByTabId[tabId('tab-1')]).toBe(view)
  })

  it('promotes an exact clean prepared buffer into the view', () => {
    const store = createEditorDocumentStore()
    const file = fileResult('/repo/a.ts')
    const buffer = createEditorTextBuffer(file.content)
    buffer.markClean()
    const preparedDocument = preparedDocumentLease()

    const view = store.getState().ensureEditorView(tabId('tab-1'), file, {
      buffer,
      file,
      fileVersion: file.version,
      kind: 'clean',
      path: file.path,
      preparedDocument,
      snapshot: buffer.getSnapshot(),
    })

    expect(view.buffer).toBe(buffer)
    expect(view.preparedDocument).toBe(preparedDocument)
    expect(view.contentRevision).toBe(`f:${file.version}`)
  })

  it('keeps dirty live content ahead of a stale clean prepared claim', () => {
    const store = createEditorDocumentStore()
    const file = fileResult('/repo/a.ts')
    const live = store.getState().ensureLiveEditorDocument(file)
    createEditorBufferSession(live.buffer).applyText('!')
    const preparedBuffer = createEditorTextBuffer(file.content)
    const preparedDocument = preparedDocumentLease()

    const view = store.getState().ensureEditorView(tabId('tab-1'), file, {
      buffer: preparedBuffer,
      file,
      fileVersion: file.version,
      kind: 'clean',
      path: file.path,
      preparedDocument,
      snapshot: preparedBuffer.getSnapshot(),
    })

    expect(view.buffer).toBe(live.buffer)
    expect(view.preparedDocument).toBeNull()
    expect(preparedDocument.dispose).toHaveBeenCalledTimes(1)
  })

  it('names clean file revisions from the opaque server version after an unraced save', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const session = createEditorBufferSession(document.buffer)
    session.applyText('!')
    const saving = store.getState().getLiveEditorDocument(document.key)!
    const savedText = saving.buffer.materializeFullText()

    expect(
      store.getState().markLiveEditorDocumentSaved({
        documentKey: document.key,
        fileVersion: 'opaque-next',
        mtimeMs: 200,
        savedContentRevision: saving.contentRevision,
        savedText,
      }),
    ).toBe(true)

    expect(store.getState().getLiveEditorDocument(document.key)?.contentRevision).toBe(
      'f:opaque-next',
    )
  })

  it('keeps an edited revision when another edit races a completed save', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const session = createEditorBufferSession(document.buffer)
    session.applyText('first')
    const saving = store.getState().getLiveEditorDocument(document.key)!
    const savedText = saving.buffer.materializeFullText()
    session.applyText('second')

    expect(
      store.getState().markLiveEditorDocumentSaved({
        documentKey: document.key,
        fileVersion: 'opaque-next',
        mtimeMs: 200,
        savedContentRevision: saving.contentRevision,
        savedText,
      }),
    ).toBe(false)

    const raced = store.getState().getLiveEditorDocument(document.key)!
    expect(raced.contentRevision).toMatch(/^e:/)
    expect(raced.sync).toMatchObject({ fileVersion: 'opaque-next' })
  })

  it('exposes one document object at the new path after a rename', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureEditorView(tabId('tab-1'), fileResult('/repo/a.ts'))

    store
      .getState()
      .renameLiveEditorDocumentPath(filesystemPath('/repo/a.ts'), filesystemPath('/repo/b.ts'))

    const renamed = store.getState().getLiveEditorDocument(testDocumentKey('/repo/b.ts'))
    expect(renamed?.target).toEqual({ kind: 'file', resource: { path: '/repo/b.ts' } })
    expect(store.getState().liveDocumentsByKey[testDocumentKey('/repo/b.ts')]).toBe(renamed)
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toBeNull()
    expect(store.getState().hasLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toBe(false)
  })

  it('acquires path reservations all-or-none in canonical order and unwinds a busy set', () => {
    const store = createEditorDocumentStore()
    const first = store
      .getState()
      .reserveWorkspaceDocumentPaths(
        [
          store.getState().prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/b.ts')),
          store.getState().prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/b.ts')),
        ],
        'first',
      )
    expect(first).toMatchObject({
      reservation: { ownerId: 'first' },
      status: 'acquired',
    })

    expect(
      store.getState().reserveWorkspaceDocumentPaths(
        ['/repo/c.ts', '/repo/a.ts', '/repo/b.ts'].map((path) =>
          store.getState().prepareWorkspaceDocumentPathReservation(filesystemPath(path)),
        ),
        'second',
      ),
    ).toEqual({ status: 'busy' })

    const noPartialReservation = store.getState().reserveWorkspaceDocumentPaths(
      ['/repo/a.ts', '/repo/c.ts'].map((path) =>
        store.getState().prepareWorkspaceDocumentPathReservation(filesystemPath(path)),
      ),
      'third',
    )
    expect(noPartialReservation).toMatchObject({
      status: 'acquired',
    })
    if (first.status === 'acquired') {
      expect(store.getState().releaseWorkspaceDocumentPaths(first.reservation)).toEqual({
        status: 'released',
      })
    }
    if (noPartialReservation.status === 'acquired') {
      expect(
        store.getState().releaseWorkspaceDocumentPaths(noPartialReservation.reservation),
      ).toEqual({ status: 'released' })
    }
  })

  it('blocks another owner from open close and remap while the same owner projection succeeds', () => {
    const store = createEditorDocumentStore()
    store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const acquired = store.getState().reserveWorkspaceDocumentPaths(
      ['/repo/a.ts', '/repo/b.ts'].map((path) =>
        store.getState().prepareWorkspaceDocumentPathReservation(filesystemPath(path)),
      ),
      'workspace-edit',
    )
    if (acquired.status !== 'acquired') throw new RangeError('expected path reservation')

    expect(() => store.getState().deleteLiveEditorDocument(testDocumentKey('/repo/a.ts'))).toThrow(
      /reserved/,
    )
    expect(() => store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))).toThrow(
      /reserved/,
    )
    expect(() =>
      store
        .getState()
        .renameLiveEditorDocumentPath(filesystemPath('/repo/a.ts'), filesystemPath('/repo/b.ts')),
    ).toThrow(/reserved/)

    const projection = store
      .getState()
      .prepareWorkspaceDocumentRename(
        filesystemPath('/repo/a.ts'),
        filesystemPath('/repo/b.ts'),
        acquired.reservation,
      )
    expect(projection).not.toBeNull()
    expect(store.getState().commitWorkspaceDocumentProjection(projection!)).toBe(true)
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/b.ts'))).not.toBeNull()
    expect(store.getState().releaseWorkspaceDocumentPaths(acquired.reservation)).toEqual({
      status: 'released',
    })
  })

  it('advances path ownership once per gain loss or remap and never for reservations', () => {
    const store = createEditorDocumentStore()
    expect(store.getState().pathOwnershipRevision).toBe(0)

    store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    expect(store.getState().pathOwnershipRevision).toBe(1)
    store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    expect(store.getState().pathOwnershipRevision).toBe(1)

    const reservation = store
      .getState()
      .reserveWorkspaceDocumentPaths(
        [
          store
            .getState()
            .prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/unused.ts')),
        ],
        'owner',
      )
    expect(store.getState().pathOwnershipRevision).toBe(1)
    if (reservation.status !== 'acquired') throw new RangeError('expected path reservation')
    store.getState().releaseWorkspaceDocumentPaths(reservation.reservation)
    expect(store.getState().pathOwnershipRevision).toBe(1)

    store
      .getState()
      .renameLiveEditorDocumentPath(filesystemPath('/repo/a.ts'), filesystemPath('/repo/b.ts'))
    expect(store.getState().pathOwnershipRevision).toBe(2)
    store.getState().deleteLiveEditorDocument(testDocumentKey('/repo/b.ts'))
    expect(store.getState().pathOwnershipRevision).toBe(3)
  })

  it('rejects a stale path classification and releases an exact reservation idempotently', () => {
    const store = createEditorDocumentStore()
    const stale = store
      .getState()
      .prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/a.ts'))
    store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))

    expect(store.getState().reserveWorkspaceDocumentPaths([stale], 'stale')).toEqual({
      status: 'stale',
    })

    const current = store
      .getState()
      .prepareWorkspaceDocumentPathReservation(filesystemPath('/repo/a.ts'))
    const acquired = store.getState().reserveWorkspaceDocumentPaths([current], 'workspace-edit')
    if (acquired.status !== 'acquired') throw new RangeError('expected path reservation')
    expect(store.getState().releaseWorkspaceDocumentPaths(acquired.reservation)).toEqual({
      status: 'released',
    })
    expect(store.getState().releaseWorkspaceDocumentPaths(acquired.reservation)).toEqual({
      status: 'already-released',
    })
  })

  it('freezes every guarded buffer all-or-none and releases the lease set', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const second = store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))
    const stamps = ['/repo/b.ts', '/repo/a.ts'].map((path) =>
      store.getState().prepareWorkspaceDocumentTarget(testDocumentKey(path))!,
    )
    const acquired = store
      .getState()
      .acquireWorkspaceDocumentMutationLeases(stamps, 'workspace-edit')
    if (acquired.status !== 'acquired') throw new RangeError('expected mutation leases')

    createEditorBufferSession(first.buffer).applyText('blocked')
    createEditorBufferSession(second.buffer).applyText('blocked')
    expect(first.buffer.materializeFullText()).toBe('contents of /repo/a.ts')
    expect(second.buffer.materializeFullText()).toBe('contents of /repo/b.ts')
    expect(acquired.leaseSet.entries.map((entry) => entry.path)).toEqual([
      '/repo/a.ts',
      '/repo/b.ts',
    ])

    expect(store.getState().releaseWorkspaceDocumentMutationLeases(acquired.leaseSet)).toBe(true)
    createEditorBufferSession(first.buffer).applyText('!')
    expect(first.buffer.materializeFullText()).toContain('!')
  })

  it('unwinds an earlier mutation lease when a later canonical target is busy', () => {
    const store = createEditorDocumentStore()
    const first = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const second = store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))
    const blocker = acquireDocumentMutationLease(
      second.buffer,
      second.buffer.getRevision(),
      second.buffer.getSnapshot(),
      'blocker',
    )
    if (blocker.status !== 'acquired') throw new RangeError('expected blocker lease')

    const result = store
      .getState()
      .acquireWorkspaceDocumentMutationLeases(
        [
          store.getState().prepareWorkspaceDocumentTarget(testDocumentKey('/repo/a.ts'))!,
          store.getState().prepareWorkspaceDocumentTarget(testDocumentKey('/repo/b.ts'))!,
        ],
        'workspace-edit',
      )

    expect(result).toEqual({ path: '/repo/b.ts', status: 'busy' })
    expect(getDocumentMutationLeaseState(first.buffer)).toEqual({
      isLeased: false,
      ownerId: null,
    })
    releaseDocumentMutationLease(second.buffer, blocker.lease)
  })

  it('keeps acknowledged partial buffers recovery-conflicted without a sync base', () => {
    const store = createEditorDocumentStore()
    const document = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    createEditorBufferSession(document.buffer).applyText(' unsaved')
    const beforeText = document.buffer.materializeFullText()
    const beforeRevision = document.buffer.getRevision()

    expect(
      store
        .getState()
        .markWorkspaceDocumentRecoveryConflict(
          [filesystemPath('/repo/b.ts'), filesystemPath('/repo/a.ts')],
          'partial-operation',
        ),
    ).toEqual({ conflictedPaths: ['/repo/a.ts'], status: 'acquired' })

    const conflicted = store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))!
    expect(conflicted.sync).toEqual({
      affectedPaths: ['/repo/a.ts', '/repo/b.ts'],
      kind: 'recovery-conflict',
      operationId: 'partial-operation',
    })
    createEditorBufferSession(conflicted.buffer).applyText(' blocked')
    conflicted.buffer.undo()
    expect(conflicted.buffer.materializeFullText()).toBe(beforeText)
    expect(conflicted.buffer.getRevision()).toBe(beforeRevision)
    expect(conflicted.buffer.isDirty()).toBe(true)

    expect(store.getState().clearWorkspaceDocumentRecoveryConflict('partial-operation')).toEqual([
      '/repo/a.ts',
    ])
    const restored = store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))!
    expect(restored.sync.kind).toBe('file')
    createEditorBufferSession(restored.buffer).applyText(' editable')
    expect(restored.buffer.materializeFullText()).toBe(`${beforeText} editable`)
  })

  it('atomically transfers retained leases into recovery conflict without an editable event', () => {
    const store = createEditorDocumentStore()
    const affected = store.getState().ensureLiveEditorDocument(fileResult('/repo/a.ts'))
    const unaffected = store.getState().ensureLiveEditorDocument(fileResult('/repo/b.ts'))
    const affectedLeaseStates: boolean[] = []
    const unaffectedLeaseStates: boolean[] = []
    subscribeDocumentMutationLeaseState(affected.buffer, (state) =>
      affectedLeaseStates.push(state.isLeased),
    )
    subscribeDocumentMutationLeaseState(unaffected.buffer, (state) =>
      unaffectedLeaseStates.push(state.isLeased),
    )
    const acquired = store
      .getState()
      .acquireWorkspaceDocumentMutationLeases(
        [
          store.getState().prepareWorkspaceDocumentTarget(testDocumentKey('/repo/a.ts'))!,
          store.getState().prepareWorkspaceDocumentTarget(testDocumentKey('/repo/b.ts'))!,
        ],
        'partial-operation',
      )
    if (acquired.status !== 'acquired') throw new RangeError('expected mutation leases')

    const prepared = store
      .getState()
      .prepareWorkspaceDocumentRecoveryConflictTransfer(
        acquired.leaseSet,
        [filesystemPath('/repo/a.ts')],
        'partial-operation',
      )
    expect(prepared.status).toBe('prepared')
    if (prepared.status !== 'prepared') throw new RangeError('expected prepared transfer')

    expect(
      store.getState().commitWorkspaceDocumentRecoveryConflictTransfer(prepared.transfer),
    ).toEqual(['/repo/a.ts'])

    expect(affectedLeaseStates).toEqual([true])
    expect(unaffectedLeaseStates).toEqual([true, false])
    expect(getDocumentMutationLeaseState(affected.buffer).isLeased).toBe(true)
    expect(getDocumentMutationLeaseState(unaffected.buffer).isLeased).toBe(false)
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))?.sync.kind).toBe(
      'recovery-conflict',
    )
    createEditorBufferSession(affected.buffer).applyText(' blocked')
    expect(affected.buffer.materializeFullText()).toBe('contents of /repo/a.ts')

    store.getState().clearWorkspaceDocumentRecoveryConflict('partial-operation')
    expect(affectedLeaseStates).toEqual([true, false])
    expect(store.getState().getLiveEditorDocument(testDocumentKey('/repo/a.ts'))?.sync.kind).toBe(
      'file',
    )
  })
})

function fileResult(path: string): FileResult {
  return {
    content: `contents of ${path}`,
    mtimeMs: 100,
    path: filesystemPath(path),
    size: 20,
    version: `test:${path}`,
  }
}

function preparedDocumentLease(): EditorPreparedDocument {
  return {
    dispose: vi.fn(),
    estimatedBytes: 1,
    fallbackReady: Promise.resolve(true),
    runtimeSessionIds: () => ({ highlighter: [], structural: [] }),
    startStage: vi.fn(() => null),
    take: vi.fn(() => null),
  }
}

function commitExternal(buffer: EditorTextBuffer, text: string): void {
  commitExternalWithReceipt(buffer, text)
}

function commitExternalWithReceipt(buffer: EditorTextBuffer, text: string) {
  const result = commitPreparedDocumentTransaction(
    { buffer, sourceView: null },
    prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text }], 1, null),
    { history: { groupId: 'workspace', kind: 'external-barrier' } },
  )
  if (result.status !== 'committed') throw new RangeError('expected committed transaction')
  return result
}
