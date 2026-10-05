import { expect, test } from '../../../../test/fixtures'
import { createSavedComparisonFixture } from '../../../../test/factories/saved-comparison'
import { createEditorBufferSession, createEditorTextBuffer } from '@singapore-editor/core/document'
import {
  createEditorDocumentAnalysis,
  createEditorPreparedDocument,
} from '@singapore-editor/core/editor'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import type { SavedComparisonRead } from '@/features/editor/utils/saved-comparison'
import { vi } from 'vitest'

test('keeps dirty live authority separate from the exact saved file revision', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const lease = fixture.acquire()
  const before = ready(lease.read())
  const stamp = fixture.service.prepareTargetStamp(fixture.document.key)
  expect(stamp?.buffer).toBe(before.live.buffer)
  expect(stamp?.bufferRevision).toBe(before.live.revision)
  expect(before.live.buffer).toBe(fixture.document.buffer)
  expect(before.live.analysis).toBe(fixture.document.analysis)
  expect(before.saved.snapshot).toBe(fixture.saved)
  expect(lease.read()).toBe(before)
  createEditorBufferSession(fixture.document.buffer).applyText('export const dirty = 2\n')
  const after = ready(lease.read())
  expect(after.live.revision).toBe(fixture.document.buffer.getRevision())
  expect(after.live.snapshot).toBe(fixture.document.buffer.getTextSnapshot())
  expect(after.live.snapshot.materializeFullText()).toContain('dirty')
  expect(after.saved).toBe(before.saved)
  expect(ready(fixture.acquire().read()).live.snapshot).toBe(after.live.snapshot)
  expect(materializeFileSnapshotText(after.saved.snapshot)).not.toContain('dirty')
  expect(before.live.snapshot.materializeFullText()).not.toContain('dirty')
  if (stamp) expect(fixture.service.isTargetStampCurrent(stamp)).toBe(false)
  fixture.service.dispose()
})

test('refreshes only the declared moving saved side and leaves another interest independent', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const first = fixture.acquire()
  const second = fixture.acquire()
  const before = ready(first.read())
  const refreshed = await fixture.refresh('export const saved = 3\n')
  expect(refreshed.version).not.toBe(fixture.saved.version)
  expect(first.refreshSaved(refreshed, first.requestSavedRefresh())).toBe(true)
  const after = ready(first.read())
  expect(after.live).toBe(before.live)
  expect(after.saved.snapshot).toBe(refreshed)
  expect(ready(second.read()).saved.snapshot).toBe(fixture.saved)
  expect(ready(second.read()).live.buffer).toBe(after.live.buffer)
  fixture.service.dispose()
})

test('pins a clean actual buffer until the final independently released interest leaves', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const canceled = new AbortController()
  const first = fixture.acquire(canceled.signal)
  const second = fixture.acquire()
  const dispose = vi.spyOn(fixture.document.analysis, 'dispose')
  const keepNone = { documentKeys: new Set<never>(), tabIds: new Set<never>() }
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([])
  canceled.abort()
  first.release()
  expect(first.read()).toEqual({ kind: 'released', reason: 'interest-ended' })
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([])
  expect(second.read().kind).toBe('ready')
  second.release()
  second.release()
  expect(fixture.service.state().savedComparisons.size).toBe(0)
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([fixture.document.key])
  expect(dispose).toHaveBeenCalledOnce()
  fixture.service.dispose()
})

test('moves live incarnation and analysis together when the canonical buffer is replaced', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const lease = fixture.acquire()
  const before = ready(lease.read())
  const stamp = fixture.service.prepareTargetStamp(fixture.document.key)
  const fresh = await fixture.refresh('export const replacement = 4\n')
  fixture.service.forceReplaceLiveDocument(fresh)
  const after = ready(lease.read())
  const current = fixture.service.getLiveDocument(fixture.document.key)
  expect(after.live.buffer).toBe(current?.buffer)
  expect(after.live.analysis).toBe(current?.analysis)
  expect(after.live.buffer).not.toBe(before.live.buffer)
  expect(after.live.snapshot).toBe(after.live.buffer.getTextSnapshot())
  expect(after.live.revision).toBe(after.live.buffer.getRevision())
  expect(after.saved.snapshot).toBe(before.saved.snapshot)
  expect(before.live.snapshot.materializeFullText()).toContain('saved = 1')
  if (stamp) expect(fixture.service.isTargetStampCurrent(stamp)).toBe(false)
  fixture.service.dispose()
})

test('terminal disposal rejects late refreshes and keeps held dirty text and Undo usable', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const lease = fixture.acquire()
  createEditorBufferSession(fixture.document.buffer).applyText('dirty ')
  fixture.service.dispose()
  fixture.service.dispose()
  expect(lease.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(lease.refreshSaved(fixture.saved, lease.requestSavedRefresh())).toBe(false)
  expect(fixture.acquire().read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(fixture.service.state().savedComparisons.size).toBe(0)
  expect(fixture.document.buffer.materializeFullText()).toContain('dirty')
  fixture.document.buffer.undo()
  expect(fixture.document.buffer.materializeFullText()).toBe(
    materializeFileSnapshotText(fixture.saved),
  )
  expect(fixture.service.state().liveDocumentsByKey).toEqual({})
})

test('an already canceled source interest cannot pin or republish a clean document', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const canceled = new AbortController()
  canceled.abort()
  expect(fixture.acquire(canceled.signal).read().kind).toBe('released')
  expect(fixture.service.state().savedComparisons.size).toBe(0)
  expect(
    fixture.service.retain({ documentKeys: new Set(), tabIds: new Set() }).evictedDocumentKeys,
  ).toEqual([fixture.document.key])
  fixture.service.dispose()
})

test('refuses an obsolete saved adoption and a refresh captured by another interest', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const lease = fixture.acquire()
  const other = fixture.acquire()
  const older = lease.requestSavedRefresh()
  const oldFile = await fixture.refresh('export const earlier = 3\n')
  const latest = lease.requestSavedRefresh()
  const latestFile = await fixture.refresh('export const latest = 4\n')
  expect(lease.refreshSaved(latestFile, latest)).toBe(true)
  const accepted = lease.read()
  expect(lease.refreshSaved(oldFile, older)).toBe(false)
  expect(lease.refreshSaved(oldFile, latest)).toBe(false)
  expect(lease.refreshSaved(oldFile, other.requestSavedRefresh())).toBe(false)
  expect(lease.read()).toBe(accepted)
  expect(ready(lease.read()).saved.snapshot).toBe(latestFile)
  fixture.service.dispose()
})

test('publishes captured snapshot and revision pairs through a reentrant earlier buffer listener', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const initial = materializeFileSnapshotText(fixture.saved)
  const buffer = createEditorTextBuffer(initial)
  const session = createEditorBufferSession(buffer)
  const stopNested = buffer.subscribe((event) => {
    if (event.revisionAfter === 1) session.applyText('nested')
  })
  const key = fileDocumentKey(fixture.path)
  const analysis = createEditorDocumentAnalysis({ buffer, documentId: key })
  const prepared = createEditorPreparedDocument({
    analysis,
    buffer,
    documentId: key,
    configuredTabSize: 4,
    documentConfigurationTag: [],
    languageId: 'typescript',
    tabSizePolicy: 'fixed',
  })
  const store = createEditorDocumentStore({ environmentId: fixture.scope.environmentId })
  store.getState().ensureLiveEditorDocument(fixture.saved, {
    kind: 'clean',
    documentKey: key,
    localRevision: buffer.getRevision(),
    release: () => undefined,
    buffer,
    file: fixture.saved,
    fileVersion: fixture.saved.version,
    path: fixture.path,
    preparedDocument: prepared,
    snapshot: buffer.getSnapshot(),
  })
  const lease = store.getState().acquireSavedComparison({
    scope: fixture.scope,
    saved: fixture.saved,
    signal: new AbortController().signal,
  })
  const observed: [number, string][] = []
  const stop = store.subscribe(() => {
    const read = ready(lease.read())
    observed.push([read.live.revision, read.live.snapshot.materializeFullText()])
  })
  try {
    session.applyText('outer')
    expect(observed).toEqual([
      [1, `${initial}outer`],
      [2, `${initial}outernested`],
    ])
    const latest = ready(lease.read())
    expect(latest.live.revision).toBe(buffer.getRevision())
    expect(latest.live.snapshot).toBe(buffer.getTextSnapshot())
  } finally {
    stop()
    stopNested()
    prepared.dispose()
    store.getState().disposeEditorDocuments()
    fixture.service.dispose()
  }
})

test('prepares independent tab interests before publication and releases each with its view', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const request = {
    scope: fixture.scope,
    saved: fixture.saved,
    signal: new AbortController().signal,
  }
  const first = fixture.service.prepareSavedComparisonTab(tabId('first'), request)
  const second = fixture.service.prepareSavedComparisonTab(tabId('second'), {
    ...request,
    signal: new AbortController().signal,
  })
  expect(fixture.service.state().savedComparisonTabs.get(tabId('first'))).toBe(first)
  expect(ready(first.read()).live.buffer).toBe(ready(second.read()).live.buffer)
  fixture.service.removeView(tabId('first'))
  expect(first.read().kind).toBe('released')
  expect(second.read().kind).toBe('ready')
  expect(
    fixture.service.retain({ documentKeys: new Set(), tabIds: new Set([tabId('second')]) })
      .evictedDocumentKeys,
  ).toEqual([])
  expect(
    fixture.service.retain({ documentKeys: new Set(), tabIds: new Set() }).evictedDocumentKeys,
  ).toEqual([fixture.document.key])
  expect(second.read().kind).toBe('released')
  expect(fixture.service.state().savedComparisonTabs.size).toBe(0)
  fixture.service.dispose()
})

test('invalidates the old-path source on rename and keeps its exact saved input after later edits', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const lease = fixture.acquire()
  const before = ready(lease.read())
  const session = createEditorBufferSession(fixture.document.buffer)
  session.applyText('// ordinary edit\n')
  const control = ready(lease.read())
  expect(control.live.revision).toBe(fixture.document.buffer.getRevision())
  expect(control.live.snapshot).toBe(fixture.document.buffer.getTextSnapshot())
  const to = filesystemPath('repo/renamed.ts')
  fixture.service.renameLiveDocument(fixture.path, to)
  expect(lease.read()).toEqual({ kind: 'unavailable', scope: fixture.scope, saved: before.saved })
  expect(fixture.service.getLiveDocument(fixture.document.key)).toBeNull()
  const unavailable = lease.read()
  session.applyText('// after rename\n')
  expect(lease.read()).toBe(unavailable)
  const renamed = fixture.service.getLiveDocument(fileDocumentKey(to))
  expect(renamed?.buffer).toBe(fixture.document.buffer)
  expect(renamed?.localRevision).toBe(fixture.document.buffer.getRevision())
  expect(renamed?.buffer.materializeFullText()).toContain('after rename')
  expect(control.live.snapshot.materializeFullText()).not.toContain('after rename')
  fixture.service.dispose()
})

test('publishes both rename projection paths, restores them on rollback and preserves unrelated interests', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const to = filesystemPath('repo/renamed.ts')
  const destinationSaved = await fixture.readSavedFile(to, 'export const destination = 7\n')
  const unrelatedSaved = await fixture.readSavedFile(
    filesystemPath('repo/unrelated.ts'),
    'export const unrelated = 8\n',
  )
  const store = createEditorDocumentStore({ environmentId: fixture.scope.environmentId })
  const document = store.getState().ensureLiveEditorDocument(fixture.saved)
  store.getState().ensureLiveEditorDocument(unrelatedSaved)
  const request = { scope: fixture.scope, signal: new AbortController().signal }
  const source = store.getState().acquireSavedComparison({ ...request, saved: fixture.saved })
  const destination = store
    .getState()
    .acquireSavedComparison({ ...request, saved: destinationSaved })
  const unrelated = store.getState().acquireSavedComparison({ ...request, saved: unrelatedSaved })
  const sourceBefore = ready(source.read())
  const unrelatedBefore = ready(unrelated.read())
  expect(destination.read().kind).toBe('unavailable')
  const projection = store.getState().prepareWorkspaceDocumentRename(fixture.path, to)
  expect(projection).not.toBeNull()
  if (!projection) throw new RangeError('saved comparison rename fixture is unavailable')
  const publications: [SavedComparisonRead | undefined, SavedComparisonRead | undefined][] = []
  const stop = store.subscribe((state) => {
    publications.push([state.savedComparisons.get(source), state.savedComparisons.get(destination)])
  })
  try {
    expect(store.getState().commitWorkspaceDocumentProjection(projection)).toBe(true)
    expect(publications).toHaveLength(1)
    expect(publications[0]?.map((read) => read?.kind)).toEqual(['unavailable', 'ready'])
    const arrived = ready(destination.read())
    expect(arrived.live.key).toBe(fileDocumentKey(to))
    expect(arrived.live.buffer).toBe(document.buffer)
    expect(arrived.live.analysis).toBe(document.analysis)
    expect(arrived.live.snapshot).toBe(document.buffer.getTextSnapshot())
    expect(arrived.live.revision).toBe(document.buffer.getRevision())
    expect(arrived.saved.snapshot).toBe(destinationSaved)
    expect(unrelated.read()).toBe(unrelatedBefore)
    const session = createEditorBufferSession(document.buffer)
    session.applyText('// after commit\n')
    expect(publications).toHaveLength(2)
    const edited = ready(destination.read())
    expect(edited.live.snapshot).toBe(document.buffer.getTextSnapshot())
    expect(edited.live.revision).toBe(document.buffer.getRevision())
    expect(edited.live.snapshot.materializeFullText()).toContain('after commit')
    expect(edited.saved).toBe(arrived.saved)
    expect(source.read().kind).toBe('unavailable')
    expect(store.getState().rollbackWorkspaceDocumentProjection(projection)).toBe(true)
    expect(publications).toHaveLength(3)
    expect(publications[2]?.map((read) => read?.kind)).toEqual(['ready', 'unavailable'])
    const restored = ready(source.read())
    expect(restored.live.key).toBe(document.key)
    expect(restored.live.buffer).toBe(document.buffer)
    expect(restored.live.analysis).toBe(document.analysis)
    expect(restored.live.snapshot).toBe(edited.live.snapshot)
    expect(restored.live.revision).toBe(edited.live.revision)
    expect(restored.saved).toBe(sourceBefore.saved)
    const destinationUnavailable = destination.read()
    session.applyText('// after rollback\n')
    expect(publications).toHaveLength(4)
    const latest = ready(source.read())
    expect(latest.live.snapshot).toBe(document.buffer.getTextSnapshot())
    expect(latest.live.revision).toBe(document.buffer.getRevision())
    expect(latest.live.snapshot.materializeFullText()).toContain('after rollback')
    expect(latest.saved.snapshot).toBe(fixture.saved)
    expect(destination.read()).toBe(destinationUnavailable)
    expect(unrelated.read()).toBe(unrelatedBefore)
    expect(publications[3]).toEqual([latest, destinationUnavailable])
  } finally {
    stop()
    store.getState().disposeEditorDocuments()
    fixture.service.dispose()
  }
})

test('destination comparison pins the clean renamed buffer and keeps Undo and target stamps canonical', async ({
  server,
  client,
}) => {
  const fixture = await createSavedComparisonFixture(server.root, client)
  const source = fixture.acquire()
  const to = filesystemPath('repo/renamed.ts')
  const saved = await fixture.readSavedFile(to, 'export const destination = 9\n')
  const destination = fixture.service.acquireSavedComparison({
    scope: fixture.scope,
    saved,
    signal: new AbortController().signal,
  })
  const oldStamp = fixture.service.prepareTargetStamp(fixture.document.key)
  fixture.service.renameLiveDocument(fixture.path, to)
  source.release()
  const arrived = ready(destination.read())
  const stamp = fixture.service.prepareTargetStamp(fileDocumentKey(to))
  expect(stamp?.buffer).toBe(fixture.document.buffer)
  expect(stamp?.bufferRevision).toBe(arrived.live.revision)
  if (oldStamp) expect(fixture.service.isTargetStampCurrent(oldStamp)).toBe(false)
  const keepNone = { documentKeys: new Set<never>(), tabIds: new Set<never>() }
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([])
  createEditorBufferSession(fixture.document.buffer).applyText('// undo me\n')
  if (stamp) expect(fixture.service.isTargetStampCurrent(stamp)).toBe(false)
  expect(ready(destination.read()).live.snapshot.materializeFullText()).toContain('undo me')
  fixture.document.buffer.undo()
  const undone = ready(destination.read())
  expect(undone.live.snapshot.materializeFullText()).toBe(
    materializeFileSnapshotText(fixture.saved),
  )
  expect(undone.live.revision).toBe(fixture.document.buffer.getRevision())
  expect(undone.live.snapshot).toBe(fixture.document.buffer.getTextSnapshot())
  expect(undone.saved).toBe(arrived.saved)
  expect(undone.saved.snapshot.version).toBe(saved.version)
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([])
  destination.release()
  expect(fixture.service.retain(keepNone).evictedDocumentKeys).toEqual([fileDocumentKey(to)])
  fixture.service.dispose()
})

function ready(read: SavedComparisonRead) {
  expect(read.kind).toBe('ready')
  if (read.kind !== 'ready') throw new RangeError('saved comparison fixture is not ready')
  return read
}
