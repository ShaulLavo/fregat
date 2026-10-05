import { expect, test } from '../../../../test/fixtures'
import { historyComparisonFixture } from '../../../../test/factories/history-document'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { filesystemPath, tabId } from '@/lib/documents/utils/identity'
import {
  historyComparisonInput,
  compareHistoryStates,
  type HistoryComparisonResult,
} from '@/features/editor/utils/history-compare'
import { createHistoryViewerSource } from '@/features/editor/hooks/use-history-viewer'
import { createTabPresentation } from '@/features/editor/state/tab-presentation'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { materializePieceTableFullText } from '@singapore-editor/textbuffer'

const path = filesystemPath('repo/a.ts')
const scope = { environmentId: testScopedStorage.environmentId, rootPath: filesystemPath('repo') }

function retainedInput(
  f: ReturnType<typeof historyComparisonFixture>,
  oldIndex: number,
  newIndex: number,
) {
  const nodes = f.buffer.getHistoryGraph().nodes
  const old = nodes[oldIndex]
  const next = nodes[newIndex]
  if (!old || !next) throw new RangeError('history nodes required')
  return historyComparisonInput(f.buffer, path, scope, old, next)
}

test('shares an exact ordered pair while actual buffers and amended snapshots remain distinct', () => {
  const f = historyComparisonFixture({ path, scope })
  const other = historyComparisonFixture({ path, scope })
  const input = retainedInput(f, 2, 1)
  const replaced = retainedInput(other, 2, 1)
  expect(input.old.id).toBe(replaced.old.id)
  expect(input.new.id).toBe(replaced.new.id)
  const acquire = f.store.getState().acquireSnapshotComparison
  const canceled = new AbortController()
  const first = acquire({ input, signal: canceled.signal })
  const survivor = acquire({ input: retainedInput(f, 2, 1), signal: new AbortController().signal })
  const replacement = acquire({ input: replaced, signal: new AbortController().signal })
  const reversed = acquire({ input: retainedInput(f, 1, 2), signal: new AbortController().signal })
  expect(first.read()).toBe(survivor.read())
  expect(first.read()).not.toBe(replacement.read())
  expect(first.read()).not.toBe(reversed.read())
  const held = survivor.read()
  const session = createEditorBufferSession(f.buffer)
  session.setSelection(5)
  session.applyText('A')
  const typing = f.buffer.getHistoryGraph().currentId
  const beforeAmend = retainedInput(f, 3, 1)
  session.applyText('B')
  const amended = retainedInput(f, 3, 1)
  expect(amended.old.id).toBe(typing)
  expect(amended.old.revision).toBeGreaterThan(beforeAmend.old.revision)
  expect(amended.old.snapshot).not.toBe(beforeAmend.old.snapshot)
  const amendedLease = acquire({ input: amended, signal: new AbortController().signal })
  expect(amendedLease.read()).not.toBe(held)
  session.undo()
  expect(survivor.read()).toBe(held)
  expect(materializePieceTableFullText(input.old.snapshot)).toBe('alphaonetwo\nbeta\n')
  canceled.abort()
  expect(first.read().kind).toBe('released')
  expect(survivor.read()).toBe(held)
  replacement.release()
  reversed.release()
  amendedLease.release()
  survivor.release()
  expect(f.store.getState().snapshotComparisons.size).toBe(0)
  expect(f.store.getState().getLiveEditorDocument(f.document.key)?.buffer).toBe(f.buffer)
  expect(f.buffer.canUndo()).toBe(true)
  f.store.getState().disposeEditorDocuments()
  other.store.getState().disposeEditorDocuments()
})

test('holds the displayed source during pending requests, releases canceled requests and rejects late completion', async () => {
  const f = historyComparisonFixture({ path, scope })
  const pending: { resolve: (value: HistoryComparisonResult) => void; reject: () => void }[] = []
  const source = createHistoryViewerSource({
    ...f,
    documents: f.store,
    presentation: createTabPresentation().history,
    compare: () =>
      new Promise((resolve, reject) =>
        pending.push({ resolve, reject: () => reject(new RangeError('comparison refused')) }),
      ),
  })
  const stop = source.subscribe(() => undefined)
  const viewer = source.getSnapshot()!.viewer
  viewer.focus(1)
  const held = [...f.store.getState().snapshotComparisons.values()][0]
  expect(held?.kind).toBe('ready')
  viewer.toggleSelection(2)
  viewer.toggleSelection(0)
  expect(f.store.getState().snapshotComparisons.size).toBe(2)
  const requested = [...f.store.getState().snapshotComparisons.keys()].find(
    (lease) => lease.read() !== held,
  )!
  viewer.toggleSelection(1)
  expect(requested.read().kind).toBe('released')
  expect([...f.store.getState().snapshotComparisons.values()]).toContain(held)
  pending[0]!.resolve('too-large')
  await Promise.resolve()
  await Promise.resolve()
  expect(source.getSnapshot()!.state.comparison?.status).toBe('pending')
  pending[1]!.resolve(
    compareHistoryStates(retainedInput(f, 0, 1).old, retainedInput(f, 0, 1).new, path),
  )
  await Promise.resolve()
  await Promise.resolve()
  expect(source.getSnapshot()!.state.comparison?.status).toBe('ready')
  const displayed = [...f.store.getState().snapshotComparisons.values()][0]
  expect(
    displayed?.kind === 'ready' &&
      displayed.input.kind === 'history' && [displayed.input.old.id, displayed.input.new.id],
  ).toEqual([0, 1])
  viewer.focus(2)
  expect([...f.store.getState().snapshotComparisons.values()]).toContain(displayed)
  viewer.toggleSelection(2)
  pending[2]!.reject()
  await Promise.resolve()
  await Promise.resolve()
  await expect.poll(() => source.getSnapshot()!.state.comparison?.status).toBe('failed')
  expect(f.store.getState().snapshotComparisons.size).toBe(0)
  stop()
  expect(f.buffer.materializeFullText()).toBe('alphaonetwo\nbeta\n')
  f.store.getState().disposeEditorDocuments()
})

test('logical copies, two viewers, remount, trim and final disposal retain independent interests', () => {
  const f = historyComparisonFixture({ path, scope })
  const presentation = createTabPresentation().history
  presentation.focusedId = 1
  const source = createHistoryViewerSource({
    ...f,
    documents: f.store,
    presentation,
    tabId: tabId('first'),
  })
  const stop = source.subscribe(() => undefined)
  const logical = f.store.getState().snapshotComparisonTabs.get(tabId('first'))!
  f.store.getState().copyEditorView(tabId('first'), tabId('copy'))
  const copied = f.store.getState().snapshotComparisonTabs.get(tabId('copy'))!
  expect(logical.read()).toBe(copied.read())
  const other = createHistoryViewerSource({
    ...f,
    documents: f.store,
    presentation: { ...presentation },
    tabId: tabId('other'),
  })
  const stopOther = other.subscribe(() => undefined)
  expect(f.store.getState().snapshotComparisons.size).toBe(5)
  stop()
  expect(f.store.getState().snapshotComparisons.size).toBe(4)
  const resumed = source.subscribe(() => undefined)
  expect(source.getSnapshot()!.state.focusedId).toBe(1)
  other.getSnapshot()!.viewer.focus(0)
  expect(source.getSnapshot()!.state.focusedId).toBe(1)
  f.store
    .getState()
    .retainEditorDocuments({ documentKeys: new Set(), tabIds: new Set([tabId('other')]) })
  expect(logical.read().kind).toBe('released')
  expect(copied.read().kind).toBe('released')
  expect(f.store.getState().getLiveEditorDocument(f.document.key)?.buffer).toBe(f.buffer)
  resumed()
  stopOther()
  const remaining = f.store.getState().snapshotComparisonTabs.get(tabId('other'))!
  f.store.getState().disposeEditorDocuments()
  expect(remaining.read()).toEqual({ kind: 'released', reason: 'owner-disposed' })
  expect(f.store.getState().snapshotComparisons.size).toBe(0)
})

for (const length of [2 * 1024 * 1024 - 1, 2 * 1024 * 1024, 2 * 1024 * 1024 + 1]) {
  test(`retains metadata at ${length} UTF-16 units with the existing size outcome`, () => {
    const f = historyComparisonFixture({ path, scope, content: 'x'.repeat(length), insertions: [] })
    const input = retainedInput(f, 0, 0)
    expect(input.coverage).toBe(length > 2 * 1024 * 1024 ? 'too-large' : 'full')
    const lease = f.store
      .getState()
      .acquireSnapshotComparison({ input, signal: new AbortController().signal })
    expect(lease.read()).toEqual({ kind: 'ready', input })
    const buffers = input.old.snapshot.buffers
    let reads = 0
    Object.defineProperty(input.old.snapshot, 'buffers', {
      configurable: true,
      get: () => {
        reads += 1
        return buffers
      },
    })
    const result = compareHistoryStates(input.old, input.new, path)
    if (length > 2 * 1024 * 1024) expect(reads).toBe(0)
    if (length <= 2 * 1024 * 1024) expect(reads).toBeGreaterThan(0)
    Object.defineProperty(input.old.snapshot, 'buffers', {
      configurable: true,
      writable: true,
      value: buffers,
    })
    expect(result === 'too-large' ? result : result.hunks.length).toBe(
      length > 2 * 1024 * 1024 ? 'too-large' : 0,
    )
    lease.release()
    f.store.getState().disposeEditorDocuments()
  })
}

test('pruned history is unavailable for restore while an external capture stays readable', () => {
  const f = historyComparisonFixture({ path, scope })
  const input = retainedInput(f, 2, 1)
  const held = f.store
    .getState()
    .acquireSnapshotComparison({ input, signal: new AbortController().signal })
  const source = createHistoryViewerSource({
    ...f,
    documents: f.store,
    presentation: createTabPresentation().history,
  })
  const stop = source.subscribe(() => undefined)
  const viewer = source.getSnapshot()!.viewer
  viewer.focus(1)
  f.buffer.clearHistory()
  expect(source.getSnapshot()!.state.lostIds).toContain(1)
  expect(viewer.node(1)).toBeNull()
  expect(viewer.restore(1).kind).toBe('none')
  expect(held.read()).toEqual({ kind: 'ready', input })
  expect(materializePieceTableFullText(input.new.snapshot)).toBe('alphaone\nbeta\n')
  stop()
  held.release()
  expect(f.store.getState().snapshotComparisons.size).toBe(0)
  f.store.getState().disposeEditorDocuments()
})
