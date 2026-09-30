import { describe, expect, it, vi } from 'vitest'
import {
  commitPreparedDocumentTransaction,
  prepareDocumentTransaction,
  reverseDocumentTransaction,
  createEditorBufferSession,
  createEditorTextBuffer,
  type EditorTextBufferChange,
} from '../src/documentSession'

describe('committed document publication', () => {
  it('delivers captured revisions and source snapshots through a nested commit', () => {
    const buffer = createEditorTextBuffer('a')
    const session = createEditorBufferSession(buffer)
    const start = buffer.getDocumentSyncPoint()
    const observed: EditorTextBufferChange[] = []
    buffer.subscribe((event) => {
      if (event.change.textSnapshot.length === 2) session.applyText('c')
    })
    buffer.subscribe((event) => observed.push(event))
    session.applyText('b')

    expect(observed.map((event) => [event.revisionBefore, event.revisionAfter])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(observed.map((event) => event.change.textSnapshot.materializeFullText())).toEqual([
      'ab',
      'abc',
    ])
    expect(observed.map((event) => event.textSnapshotBefore.materializeFullText())).toEqual([
      'a',
      'ab',
    ])
    expect(observed[0]!.changesSinceDocumentSyncPoint(start, null)).toMatchObject({
      revisionAfter: 1,
      edits: [{ from: 1, to: 1, text: 'b' }],
    })
    expect(observed[1]!.changesSinceDocumentSyncPoint(start, null)).toMatchObject({
      revisionAfter: 2,
      edits: [{ from: 1, to: 1, text: 'bc' }],
    })
  })

  it('preserves publication identity for undo, redo, checkout and history-only changes', () => {
    const buffer = createEditorTextBuffer('a')
    const session = createEditorBufferSession(buffer)
    const root = buffer.getHistoryGraph().rootId
    const observed: EditorTextBufferChange[] = []
    buffer.subscribe((event) => observed.push(event))
    session.applyText('b')
    session.undo()
    session.redo()
    buffer.checkoutHistoryState(root)
    buffer.clearHistory()
    expect(
      observed.map((event) => [event.change.kind, event.revisionBefore, event.revisionAfter]),
    ).toEqual([
      ['edit', 0, 1],
      ['undo', 1, 2],
      ['redo', 2, 3],
      ['checkout', 3, 4],
      ['checkout', 4, 4],
    ])
    expect(observed.map((event) => event.syncPointAfter.revision)).toEqual([1, 2, 3, 4, 4])
  })

  it('publishes logical, prepared and compensation transitions with their exact identities', () => {
    const buffer = createEditorTextBuffer('a')
    const target = { buffer, sourceView: null }
    const observed: EditorTextBufferChange[] = []
    buffer.subscribe((event) => observed.push(event))
    commitPreparedDocumentTransaction(target, prepareDocumentTransaction(buffer, [], 2, null), {
      history: { kind: 'record' },
    })
    const committed = commitPreparedDocumentTransaction(
      target,
      prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'b' }], 1, null),
      { history: { kind: 'external-barrier', groupId: 'publication' } },
    )
    expect(committed.status).toBe('committed')
    if (committed.status !== 'committed') return
    expect(reverseDocumentTransaction(target, committed.receipt).status).toBe('reversed')
    expect(
      observed.map((event) => [
        event.change.kind,
        event.revisionBefore,
        event.revisionAfter,
        event.syncPointAfter.textVersion,
      ]),
    ).toEqual([
      ['synchronize', 0, 1, 0],
      ['edit', 1, 2, 1],
      ['edit', 2, 3, 2],
    ])
    expect(observed.map((event) => event.textSnapshotBefore.materializeFullText())).toEqual([
      'a',
      'a',
      'b',
    ])
    expect(observed.map((event) => event.change.textSnapshot.materializeFullText())).toEqual([
      'a',
      'b',
      'a',
    ])
  })

  it('finishes an earlier event for every observer before delivering a throwing nested listener', () => {
    const buffer = createEditorTextBuffer('a')
    const session = createEditorBufferSession(buffer)
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const delivered: string[] = []
    buffer.subscribe((event) => {
      delivered.push(`first:${event.revisionAfter}`)
      if (event.revisionAfter === 1) session.applyText('c')
      throw new DOMException('test listener failure')
    })
    buffer.subscribe((event) => delivered.push(`second:${event.revisionAfter}`))
    session.applyText('b')
    expect(delivered).toEqual(['first:1', 'second:1', 'first:2', 'second:2'])
    expect(reported).toHaveBeenCalledTimes(2)
    reported.mockRestore()
  })
})
