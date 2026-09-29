import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Editor } from '../src/editor/Editor'
import { resetEditorInstanceCount } from '../src/public/testing'
import {
  acquireDocumentMutationLease,
  beginReverseDocumentTransactionSequence,
  commitPreparedDocumentTransaction,
  commitPreparedDocumentTransactionSequenceSegment,
  completePreparedDocumentTransactionSequence,
  completeReverseDocumentTransactionSequence,
  createDocumentLogicalRevisionScope,
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  documentTextRoundTripStatus,
  getDocumentMutationLeaseState,
  materializePieceTableFullText,
  offsetToPoint,
  prepareDocumentTransaction,
  prepareDocumentTransactionSequence,
  pointToOffset,
  releaseDocumentMutationLease,
  releaseDocumentTransactionReceipt,
  reverseDocumentTransaction,
  reverseNextDocumentTransactionSequenceSegment,
  rotateDocumentSyncSegment,
  sealDocumentTransactionReceipt,
  subscribeDocumentMutationLeaseState,
  type DocumentSession,
  type DocumentTransactionCommitTarget,
  type DocumentTransactionReceipt,
  type EditorViewSession,
  type EditorTextBuffer,
  type TextEdit,
} from '../src/public/document'
import {
  type PieceTableAnchor,
  pieceTableDocumentText,
  UTF8_BYTE_ORDER_MARK,
} from '@singapore-editor/textbuffer'
import { exceedsHeapOperationBudget, MAX_HEAP_OPERATION_LENGTH } from '../src/documentSession'
import { EditorEventSource, type EditorEventSubscription } from '../src/editor/emitter'
import {
  createAnchorSelection,
  createSelectionSet,
  resolveSelection,
  type SelectionSet,
} from '../src/selections'

import { createVisibleEditor } from './factories/visibleEditor'

// The lines a view would paint: line starts from the piece table, line ends as
// `nextLineStart - 1` exactly like virtualizedTextViewModel derives them, so a
// carriage return left inside the document shows up here the way it would
// show up in the DOM.
function renderedLines(session: DocumentSession): readonly string[] {
  const snapshot = session.getSnapshot()
  const textSnapshot = session.getTextSnapshot()
  const rowCount = offsetToPoint(snapshot, snapshot.length).row + 1
  const lines: string[] = []

  for (let row = 0; row < rowCount; row++) {
    const start = pointToOffset(snapshot, { row, column: 0 })
    const end =
      row + 1 < rowCount
        ? pointToOffset(snapshot, { row: row + 1, column: 0 }) - 1
        : snapshot.length
    lines.push(textSnapshot.readRange(start, end))
  }

  return lines
}

function resolvedOffsets(session: DocumentSession): { start: number; end: number } {
  const selection = session.getSelections().selections[0]!
  const resolved = resolveSelection(session.getSnapshot(), selection)
  return { start: resolved.startOffset, end: resolved.endOffset }
}

function resolvedAffinity(session: DocumentSession): 'before' | 'after' {
  const selection = session.getSelections().selections[0]!
  return resolveSelection(session.getSnapshot(), selection).affinity
}

function resolvedSelectionState(session: DocumentSession) {
  const set = session.getSelections()
  return {
    lastAddedId: set.selections[set.lastAddedIndex ?? 0]?.id,
    selections: set.selections.map((selection) => {
      const resolved = resolveSelection(session.getSnapshot(), selection)
      return { affinity: resolved.affinity, id: resolved.id, offset: resolved.headOffset }
    }),
  }
}

function setAffinityCarets(
  session: DocumentSession,
  affinities: readonly ('before' | 'after')[],
): void {
  session.setSelections(affinities.map((affinity) => ({ affinity, anchor: 2 })))
}

function selectionIds(state: ReturnType<typeof resolvedSelectionState>): ReadonlySet<string> {
  return new Set(state.selections.map((selection) => selection.id))
}

function resolvedSelectionOffsets(
  session: DocumentSession,
): readonly { start: number; end: number }[] {
  return session.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(session.getSnapshot(), selection)
    return { start: resolved.startOffset, end: resolved.endOffset }
  })
}

function typeText(session: DocumentSession, text: string): void {
  for (const char of text) session.applyText(char)
}

function rangeSelection(
  buffer: EditorTextBuffer,
  anchor: number,
  head: number,
): SelectionSet<PieceTableAnchor> {
  const snapshot = buffer.getSnapshot()
  return createSelectionSet([createAnchorSelection(snapshot, anchor, head)], true, snapshot)
}

describe('DocumentSession', () => {
  it('creates a piece-table snapshot with a collapsed selection at the end', () => {
    const session = createDocumentSession('abc')

    expect(materializePieceTableFullText(session.getSnapshot())).toBe('abc')
    expect(session.materializeFullText()).toBe('abc')
    expect(resolvedOffsets(session)).toEqual({ start: 3, end: 3 })
    expect(session.canUndo()).toBe(false)
  })

  it('applies inserted text and records undo history', () => {
    const session = createDocumentSession('abc')
    const change = session.applyText('!')

    expect(change.kind).toBe('edit')
    expect(change.edits).toEqual([{ from: 3, to: 3, text: '!' }])
    expect(change.transaction).toMatchObject({
      edits: [{ from: 3, to: 3, text: '!' }],
      inverseEdits: [{ from: 3, to: 4, text: '' }],
      metadata: { source: 'keyboard', intent: 'insert-text' },
    })
    expect(Object.keys(change)).not.toContain('text')
    expect(change.textSnapshot.materializeFullText()).toBe('abc!')
    expect(session.materializeFullText()).toBe('abc!')
    expect(resolvedOffsets(session)).toEqual({ start: 4, end: 4 })
    expect(session.canUndo()).toBe(true)
  })

  it('publishes source selections after edits, undo and redo have adopted them', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    const observed: ReturnType<typeof resolvedOffsets>[] = []
    buffer.subscribe(() => observed.push(resolvedOffsets(session)))

    session.applyText('!')
    session.undo()
    session.redo()

    expect(observed).toEqual([
      { start: 4, end: 4 },
      { start: 3, end: 3 },
      { start: 4, end: 4 },
    ])
  })

  it('tracks dirty state from the clean snapshot checkpoint', () => {
    const session = createDocumentSession('abc')

    expect(session.isDirty()).toBe(false)

    session.applyText('!')
    expect(session.isDirty()).toBe(true)

    const undone = session.undo()
    expect(undone.isDirty).toBe(false)
    expect(session.isDirty()).toBe(false)

    const redone = session.redo()
    expect(redone.isDirty).toBe(true)
    expect(session.isDirty()).toBe(true)
  })

  it('clears dirty state when edits restore the clean text', () => {
    const session = createDocumentSession('abc')

    session.applyText('!')
    expect(session.isDirty()).toBe(true)

    const change = session.backspace()
    expect(change.textSnapshot.materializeFullText()).toBe('abc')
    expect(change.isDirty).toBe(false)
    expect(session.isDirty()).toBe(false)
    expect(session.canUndo()).toBe(true)
  })

  it('marks the current snapshot clean without clearing undo history', () => {
    const session = createDocumentSession('abc')
    session.applyText('!')

    session.markClean()

    expect(session.isDirty()).toBe(false)
    expect(session.canUndo()).toBe(true)

    session.undo()
    expect(session.materializeFullText()).toBe('abc')
    expect(session.isDirty()).toBe(true)

    session.redo()
    expect(session.materializeFullText()).toBe('abc!')
    expect(session.isDirty()).toBe(false)
  })

  it('applies text to multiple selections as one undoable edit', () => {
    const session = createDocumentSession('abcdef')
    session.setSelections([
      { anchor: 1, head: 2 },
      { anchor: 4, head: 6 },
    ])

    const change = session.applyText('X')

    expect(change.edits).toEqual([
      { from: 1, to: 2, text: 'X' },
      { from: 4, to: 6, text: 'X' },
    ])
    expect(session.materializeFullText()).toBe('aXcdX')
    expect(resolvedSelectionOffsets(session)).toEqual([
      { start: 2, end: 2 },
      { start: 5, end: 5 },
    ])
    expect(session.undo().textSnapshot.materializeFullText()).toBe('abcdef')
    expect(resolvedSelectionOffsets(session)).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
    ])
  })

  it('adds and clears secondary selections', () => {
    const session = createDocumentSession('abcdef')
    session.setSelection(1)
    session.addSelection(4)

    expect(resolvedSelectionOffsets(session)).toEqual([
      { start: 1, end: 1 },
      { start: 4, end: 4 },
    ])

    session.clearSecondarySelections()

    expect(resolvedSelectionOffsets(session)).toEqual([{ start: 1, end: 1 }])
  })

  it('backspaces by code point', () => {
    const session = createDocumentSession('a😀b')
    session.setSelection(3)
    session.backspace()

    expect(session.materializeFullText()).toBe('ab')
    expect(resolvedOffsets(session)).toEqual({ start: 1, end: 1 })
  })

  it('restores affinity-distinct backspace carets through undo and redo in either order', () => {
    const affinityOrders = [
      ['before', 'after'],
      ['after', 'before'],
    ] as const

    for (const affinities of affinityOrders) {
      const session = createDocumentSession('abc')
      setAffinityCarets(session, affinities)
      const before = resolvedSelectionState(session)

      session.backspace()
      const after = resolvedSelectionState(session)

      expect(session.materializeFullText()).toBe('ac')
      expect(after.selections).toMatchObject([
        { affinity: 'before', offset: 1 },
        { affinity: 'after', offset: 1 },
      ])
      expect(selectionIds(after)).toEqual(selectionIds(before))
      expect(after.lastAddedId).toBe(before.lastAddedId)

      session.undo()
      expect(session.materializeFullText()).toBe('abc')
      expect(resolvedSelectionState(session)).toEqual(before)

      session.redo()
      expect(session.materializeFullText()).toBe('ac')
      expect(resolvedSelectionState(session)).toEqual(after)
    }
  })

  it('replaces selected ranges and collapses after inserted text', () => {
    const session = createDocumentSession('abcdef')
    session.setSelection(1, 4)
    const change = session.applyText('X')

    expect(change.edits).toEqual([{ from: 1, to: 4, text: 'X' }])
    expect(session.materializeFullText()).toBe('aXef')
    expect(resolvedOffsets(session)).toEqual({ start: 2, end: 2 })
  })

  it('undoes and redoes snapshot and selection state together', () => {
    const session = createDocumentSession('abc')
    session.applyText('!')
    const undone = session.undo()
    const redone = session.redo()

    expect(undone.textSnapshot.materializeFullText()).toBe('abc')
    expect(redone.textSnapshot.materializeFullText()).toBe('abc!')
    expect(session.materializeFullText()).toBe('abc!')
    expect(resolvedOffsets(session)).toEqual({ start: 4, end: 4 })
  })

  it('keeps affinity through an edit and its undo and redo pair', () => {
    const session = createDocumentSession('abc')
    session.setSelection(1, 1, { affinity: 'before' })

    session.applyText('X')
    expect(resolvedAffinity(session)).toBe('before')

    session.undo()
    expect(resolvedAffinity(session)).toBe('before')

    session.redo()
    expect(resolvedAffinity(session)).toBe('before')
  })

  it('coalesces contiguous typing into one undo entry', () => {
    const session = createDocumentSession('')
    typeText(session, 'hell')
    const lastChange = session.applyText('o')

    expect(lastChange.edits).toEqual([{ from: 4, to: 4, text: 'o' }])
    expect(lastChange.transaction?.edits).toEqual([{ from: 4, to: 4, text: 'o' }])
    expect(session.materializeFullText()).toBe('hello')

    const undone = session.undo()
    expect(undone.textSnapshot.materializeFullText()).toBe('')
    expect(resolvedOffsets(session)).toEqual({ start: 0, end: 0 })
    expect(session.canUndo()).toBe(false)
  })

  it('breaks typing undo runs at word boundaries and newlines', () => {
    const session = createDocumentSession('')
    typeText(session, 'hello world')

    expect(session.undo().textSnapshot.materializeFullText()).toBe('hello')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('')

    typeText(session, 'a\nb')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('a\n')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('a')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('')
  })

  it('keeps a lone space with the word that follows it, and stops after a second', () => {
    const single = createDocumentSession('')
    typeText(single, 'hello world')

    expect(single.undo().textSnapshot.materializeFullText()).toBe('hello')

    const double = createDocumentSession('')
    typeText(double, 'hello  world')

    expect(double.undo().textSnapshot.materializeFullText()).toBe('hello  ')
    expect(double.undo().textSnapshot.materializeFullText()).toBe('hello')
  })

  it('undoes a held backspace in one step', () => {
    const session = createDocumentSession('hello world')
    session.setSelection(11)
    for (let index = 0; index < 5; index++) session.backspace()

    expect(session.materializeFullText()).toBe('hello ')

    const undone = session.undo()

    expect(undone.textSnapshot.materializeFullText()).toBe('hello world')
    expect(undone.edits).toEqual([{ from: 6, to: 6, text: 'world' }])
    expect(resolvedOffsets(session)).toEqual({ start: 11, end: 11 })
    expect(session.canUndo()).toBe(false)
  })

  // Each press took out one character as far as the person holding the key is
  // concerned, so a run that counted UTF-16 units instead would leave every
  // emoji stranded in an undo step of its own.
  it('undoes a held backspace over astral characters in one step', () => {
    const session = createDocumentSession('ok\u{1F600}\u{1F389}')
    session.backspace()
    session.backspace()

    expect(session.materializeFullText()).toBe('ok')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('ok\u{1F600}\u{1F389}')
    expect(session.canUndo()).toBe(false)
  })

  // Deleting rightwards has no caret-only entry point on the session yet, so the
  // run is driven through the buffer, which takes the selection to delete.
  it('undoes a run of forward deletions in one step', () => {
    const buffer = createEditorTextBuffer('hello world')
    for (let index = 0; index < 5; index++) {
      buffer.deleteSelection(rangeSelection(buffer, 6, 7))
    }

    expect(buffer.materializeFullText()).toBe('hello ')

    const undone = buffer.undo()

    expect(undone.textSnapshot.materializeFullText()).toBe('hello world')
    expect(undone.edits).toEqual([{ from: 6, to: 6, text: 'world' }])
    expect(buffer.canUndo()).toBe(false)
  })

  // Redo replays the snapshot, so only the reported edits expose whether the
  // coalesced range covers the whole run — and every consumer patching its own
  // copy of the text follows those edits rather than the snapshot.
  it('redoes a run of forward deletions as one range', () => {
    const buffer = createEditorTextBuffer('hello world')
    for (let index = 0; index < 5; index++) {
      buffer.deleteSelection(rangeSelection(buffer, 6, 7))
    }
    buffer.undo()

    const redone = buffer.redo()

    expect(redone.edits).toEqual([{ from: 6, to: 11, text: '' }])
    expect(redone.transaction?.edits).toEqual([{ from: 6, to: 11, text: '' }])
    expect(redone.textSnapshot.materializeFullText()).toBe('hello ')
    expect(buffer.canRedo()).toBe(false)
  })

  it('keeps backspace and forward deletion runs in separate undo entries', () => {
    const buffer = createEditorTextBuffer('abcdef')
    buffer.backspace(rangeSelection(buffer, 3, 3))
    buffer.deleteSelection(rangeSelection(buffer, 2, 3))

    expect(buffer.materializeFullText()).toBe('abef')
    expect(buffer.undo().textSnapshot.materializeFullText()).toBe('abdef')
    expect(buffer.undo().textSnapshot.materializeFullText()).toBe('abcdef')
  })

  // One buffer serves every view on it, so a deletion can arrive over a range
  // nothing moved since the backspace, and the caret arithmetic alone then reads
  // as a continuation. Merging them would record the two removals as one range
  // spanning text that was never removed at all.
  it('keeps a forward deletion out of the backspace run it abuts', () => {
    const buffer = createEditorTextBuffer('abcdef')
    buffer.backspace(rangeSelection(buffer, 3, 3))
    buffer.deleteSelection(rangeSelection(buffer, 1, 2))

    expect(buffer.materializeFullText()).toBe('adef')
    expect(buffer.undo().textSnapshot.materializeFullText()).toBe('abdef')
    expect(buffer.undo().textSnapshot.materializeFullText()).toBe('abcdef')
  })

  it('keeps a deleted selection out of the backspace run that follows it', () => {
    const session = createDocumentSession('alpha beta')
    session.setSelection(6, 10)
    session.backspace()
    session.backspace()

    expect(session.materializeFullText()).toBe('alpha')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('alpha ')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('alpha beta')
  })

  it('breaks typing undo runs on cursor moves and backspace', () => {
    const moved = createDocumentSession('')
    typeText(moved, 'ab')
    moved.setSelection(2)
    moved.applyText('c')

    expect(moved.undo().textSnapshot.materializeFullText()).toBe('ab')
    expect(moved.undo().textSnapshot.materializeFullText()).toBe('')

    const deleted = createDocumentSession('')
    typeText(deleted, 'ab')
    deleted.backspace()

    expect(deleted.undo().textSnapshot.materializeFullText()).toBe('ab')
    expect(deleted.undo().textSnapshot.materializeFullText()).toBe('')
  })

  // A keystroke that lands at several carets is one entry holding all of them.
  // Treating it as a run off the first caret would leave the entry describing an
  // insertion at that caret only, and every consumer that patches its own copy
  // of the document follows those edits rather than the snapshot.
  it('records every caret of a multi-caret keystroke in the entry it undoes', () => {
    const session = createDocumentSession('ab')
    session.setSelections([{ anchor: 0 }, { anchor: 1 }])
    session.applyText('X')
    session.applyText('Y')

    expect(session.materializeFullText()).toBe('XYaXYb')

    const undone = session.undo()

    expect(undone.textSnapshot.materializeFullText()).toBe('XaXb')
    expect(undone.edits).toEqual([
      { from: 1, to: 2, text: '' },
      { from: 4, to: 5, text: '' },
    ])
  })

  it('emits merged incremental edits when undoing and redoing a typing run', () => {
    const session = createDocumentSession('')
    typeText(session, 'hello')

    const undone = session.undo()
    const redone = session.redo()

    expect(undone.edits).toEqual([{ from: 0, to: 5, text: '' }])
    expect(undone.transaction?.inverseEdits).toEqual([{ from: 0, to: 5, text: '' }])
    expect(redone.edits).toEqual([{ from: 0, to: 0, text: 'hello' }])
    expect(redone.transaction?.edits).toEqual([{ from: 0, to: 0, text: 'hello' }])
  })

  it('reports incremental edits for undo and redo', () => {
    const session = createDocumentSession('abcdef')
    session.setSelection(1, 4)
    session.applyText('XYZ')

    const undone = session.undo()
    const redone = session.redo()

    expect(undone.kind).toBe('undo')
    expect(undone.edits).toEqual([{ from: 1, to: 4, text: 'bcd' }])
    expect(undone.transaction?.inverseEdits).toEqual([{ from: 1, to: 4, text: 'bcd' }])
    expect(redone.kind).toBe('redo')
    expect(redone.edits).toEqual([{ from: 1, to: 4, text: 'XYZ' }])
    expect(redone.transaction?.edits).toEqual([{ from: 1, to: 4, text: 'XYZ' }])
  })

  it.each([64, 1024, 1025, 32768])(
    'round-trips %i UTF-16 units of inverse text across the copy cutoff',
    (length) => {
      const removed = '\ud800a\udfff\t'.repeat(Math.ceil(length / 4)).slice(0, length)
      const text = 'prefix' + removed + 'suffix'
      const session = createDocumentSession(text)
      const change = session.applyEdits([{ from: 6, to: 6 + removed.length, text: 'replacement' }])
      expect(change.transaction?.inverseEdits).toEqual([{ from: 6, to: 17, text: removed }])
      expect(session.materializeFullText()).toBe('prefixreplacementsuffix')
      session.undo()
      expect(session.materializeFullText()).toBe(text)
      session.redo()
      expect(session.materializeFullText()).toBe('prefixreplacementsuffix')
    },
  )

  // Whether a history can cap at all is a separate question from the depth a
  // real document ends up with, which is the one a user runs into.
  it('stops offering undo two hundred recorded edits back', () => {
    const session = createDocumentSession('')
    for (let index = 0; index < 205; index++) {
      session.applyEdits([{ from: 0, to: 0, text: 'x' }])
    }

    let steps = 0
    while (session.canUndo()) {
      session.undo()
      steps += 1
    }

    expect(steps).toBe(200)
    expect(session.materializeFullText()).toBe('xxxxx')
  })

  it('applies batch edits as one undoable operation', () => {
    const session = createDocumentSession('abcd')
    const change = session.applyEdits([
      { from: 3, to: 3, text: 'Y' },
      { from: 1, to: 2, text: 'X' },
    ])

    expect(change.edits).toEqual([
      { from: 1, to: 2, text: 'X' },
      { from: 3, to: 3, text: 'Y' },
    ])
    expect(session.materializeFullText()).toBe('aXcYd')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('abcd')
  })

  it('can apply edits without recording undo history', () => {
    const session = createDocumentSession('abc')
    const change = session.applyEdits([{ from: 3, to: 3, text: '!' }], { history: 'skip' })

    expect(change.kind).toBe('edit')
    expect(session.materializeFullText()).toBe('abc!')
    expect(session.canUndo()).toBe(false)
  })

  // An edit kept out of history leaves nothing for the next keystroke to
  // continue: amending the entry recorded before it would take back text the
  // person never typed, so the run has to end there even though the caret has
  // not moved.
  it('starts a new undo entry for typing that follows an unrecorded edit', () => {
    const session = createDocumentSession('..')
    session.setSelection(0)
    typeText(session, 'ab')
    session.applyEdits([{ from: 4, to: 4, text: '!' }], { history: 'skip' })
    session.applyText('c')

    expect(session.materializeFullText()).toBe('abc..!')
    expect(session.undo().textSnapshot.materializeFullText()).toBe('ab..!')
  })

  it('preserves selections through programmatic edits unless replaced', () => {
    const session = createDocumentSession('abc')
    session.setSelection(3)

    session.applyEdits([{ from: 0, to: 0, text: '!' }])
    expect(resolvedOffsets(session)).toEqual({ start: 4, end: 4 })

    session.applyEdits([{ from: 0, to: 1, text: '?' }], {
      selection: { anchor: 1, head: 2 },
    })
    expect(resolvedOffsets(session)).toEqual({ start: 1, end: 2 })
  })

  it('accepts affinity on replacement selection ranges', () => {
    const session = createDocumentSession('abc')

    session.applyEdits([{ from: 0, to: 0, text: '!' }], {
      selection: { anchor: 1, affinity: 'before' },
    })

    expect(resolvedAffinity(session)).toBe('before')
  })
})

describe('prepared document transactions', () => {
  it('prepares a readonly edit batch without changing text, revision, dirty state, history, selection, or subscribers', () => {
    const buffer = createEditorTextBuffer('abc')
    const view = createEditorViewSession(buffer)
    view.setSelection(1)
    const listener = vi.fn()
    buffer.subscribe(listener)
    const snapshot = buffer.getSnapshot()

    const prepared = prepareDocumentTransaction(
      buffer,
      Object.freeze([{ from: 1, to: 2, text: 'B' }] satisfies readonly TextEdit[]),
      1,
      null,
    )

    expect(prepared.snapshotBefore).toBe(snapshot)
    expect(prepared.snapshotAfter).not.toBe(snapshot)
    expect(buffer.getRevision()).toBe(0)
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.materializeFullText()).toBe('abc')
    expect(buffer.isDirty()).toBe(false)
    expect(buffer.canUndo()).toBe(false)
    expect(resolveSelection(snapshot, view.getSelections().selections[0]!).headOffset).toBe(1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('commits a prepared batch as one transaction, one change event, and one undo step', () => {
    const buffer = createEditorTextBuffer('abc')
    const listener = vi.fn()
    buffer.subscribe(listener)
    const result = commitPreparedDocumentTransaction(
      transactionTarget(buffer),
      prepareDocumentTransaction(buffer, [{ from: 1, to: 2, text: 'B' }], 1, null),
      { history: { kind: 'record' } },
    )

    expect(result.status).toBe('committed')
    expect(buffer.materializeFullText()).toBe('aBc')
    expect(buffer.getRevision()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(buffer.undo().kind).toBe('undo')
    expect(buffer.materializeFullText()).toBe('abc')
    expect(buffer.undo().kind).toBe('none')
  })

  it('returns exact before and after revisions snapshots effective snapped edits and inverse receipt', () => {
    const buffer = createEditorTextBuffer('a😀b')
    const before = buffer.getSnapshot()
    const prepared = prepareDocumentTransaction(buffer, [{ from: 2, to: 2, text: 'x' }], 1, null)
    expect(prepared.edits).toEqual([{ from: 1, to: 1, text: 'x' }])

    const result = commitPreparedDocumentTransaction(transactionTarget(buffer), prepared, {
      history: { kind: 'record' },
    })
    if (result.status !== 'committed') throw new RangeError('expected commit')

    expect(result.receipt).toMatchObject({ revisionBefore: 0, revisionAfter: 1 })
    expect(result.receipt.snapshotBefore).toBe(before)
    expect(result.receipt.snapshotAfter).toBe(prepared.snapshotAfter)
    expect(result.receipt.edits).toEqual(prepared.edits)
    expect(result.receipt.inverseEdits).toEqual(prepared.inverseEdits)
  })

  it('rejects a prepared commit after an intervening edit without mutation', () => {
    const buffer = createEditorTextBuffer('abc')
    const prepared = prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 1, null)
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    const snapshot = buffer.getSnapshot()

    expect(
      commitPreparedDocumentTransaction(transactionTarget(buffer), prepared, {
        history: { kind: 'record' },
      }),
    ).toEqual({ status: 'stale' })
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.materializeFullText()).toBe('abc!')
  })

  it('rejects a prepared commit after edit then undo even when text matches again', () => {
    const buffer = createEditorTextBuffer('abc')
    const prepared = prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 1, null)
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    buffer.undo()

    expect(buffer.materializeFullText()).toBe('abc')
    expect(
      commitPreparedDocumentTransaction(transactionTarget(buffer), prepared, {
        history: { kind: 'record' },
      }).status,
    ).toBe('stale')
  })

  it('discards a prepared transaction as cancellation with no effects', () => {
    const buffer = createEditorTextBuffer('abc')
    const snapshot = buffer.getSnapshot()
    const listener = vi.fn()
    buffer.subscribe(listener)
    void prepareDocumentTransaction(buffer, [{ from: 0, to: 3, text: 'cancelled' }], 1, null)

    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.getRevision()).toBe(0)
    expect(buffer.canUndo()).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('rolls back a provisional receipt and restores preexisting undo and redo exactly', () => {
    const buffer = createEditorTextBuffer('abc')
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    buffer.undo()
    expect(buffer.canRedo()).toBe(true)
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])

    const reversed = reverseDocumentTransaction(transactionTarget(buffer), receipt)
    expect(reversed.status).toBe('reversed')
    expect(buffer.materializeFullText()).toBe('abc')
    expect(buffer.canRedo()).toBe(true)
    expect(buffer.redo().kind).toBe('redo')
    expect(buffer.materializeFullText()).toBe('abc!')
  })

  it('refuses receipt rollback after later buffer drift', () => {
    const buffer = createEditorTextBuffer('abc')
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    const snapshot = buffer.getSnapshot()

    expect(reverseDocumentTransaction(transactionTarget(buffer), receipt)).toEqual({
      status: 'stale',
    })
    expect(buffer.getSnapshot()).toBe(snapshot)
  })

  it('stops ordinary undo at an external barrier after undoing later user text', () => {
    const buffer = createEditorTextBuffer('abc')
    commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')

    expect(buffer.undo().kind).toBe('undo')
    expect(buffer.materializeFullText()).toBe('Abc')
    expect(buffer.undo().kind).toBe('none')
  })

  it('restores and reciprocates an external barrier for exact Platform undo and redo', () => {
    const buffer = createEditorTextBuffer('abc')
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])
    const undone = reverseDocumentTransaction(transactionTarget(buffer), receipt)
    if (undone.status !== 'reversed') throw new RangeError('expected reverse')
    expect(buffer.materializeFullText()).toBe('abc')

    const redone = reverseDocumentTransaction(transactionTarget(buffer), undone.receipt)
    expect(redone.status).toBe('reversed')
    expect(buffer.materializeFullText()).toBe('Abc')
    expect(buffer.undo().kind).toBe('none')
  })

  it('seals a finalized barrier and permanently discards the pre-group redo branch', () => {
    const buffer = createEditorTextBuffer('abc')
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    buffer.undo()
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])
    const sealed = sealDocumentTransactionReceipt(transactionTarget(buffer), receipt)
    expect(sealed.status).toBe('sealed')

    expect(reverseDocumentTransaction(transactionTarget(buffer), sealed.receipt).status).toBe(
      'reversed',
    )
    expect(buffer.canRedo()).toBe(false)
  })

  it('releases a drifted external barrier without exposing a grouped leg', () => {
    const buffer = createEditorTextBuffer('abc')
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }])
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    expect(releaseDocumentTransactionReceipt(transactionTarget(buffer), receipt)).toEqual({
      status: 'released',
    })
    expect(buffer.undo().kind).toBe('undo')
    expect(buffer.undo().kind).toBe('none')
    expect(buffer.materializeFullText()).toBe('Abc')
  })

  it('releases an older external barrier beneath a newer barrier without text or history leakage', () => {
    const buffer = createEditorTextBuffer('abc')
    const older = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }], 'older')
    const newer = commitExternal(buffer, [{ from: 1, to: 2, text: 'B' }], 'newer')
    const revision = buffer.getRevision()
    const snapshot = buffer.getSnapshot()

    expect(releaseDocumentTransactionReceipt(transactionTarget(buffer), older).status).toBe(
      'released',
    )
    expect(buffer.getRevision()).toBe(revision)
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(reverseDocumentTransaction(transactionTarget(buffer), newer).status).toBe('reversed')
    expect(buffer.materializeFullText()).toBe('Abc')
    expect(buffer.undo().kind).toBe('none')
  })

  it('acquires a mutation lease only for the exact revision and snapshot and reports busy for another owner', () => {
    const buffer = createEditorTextBuffer('abc')
    expect(acquireDocumentMutationLease(buffer, 1, buffer.getSnapshot(), 'stale')).toEqual({
      status: 'stale',
    })
    const acquired = acquireDocumentMutationLease(buffer, 0, buffer.getSnapshot(), 'one')
    expect(acquired.status).toBe('acquired')
    expect(acquireDocumentMutationLease(buffer, 0, buffer.getSnapshot(), 'two')).toEqual({
      status: 'busy',
    })
  })

  it('blocks keyboard paste drop undo redo and ordinary programmatic text mutations while leased', () => {
    const buffer = createEditorTextBuffer('abc')
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    const lease = acquiredLease(buffer, 'owner')
    const selection = rangeSelection(buffer, 4, 4)

    expect(buffer.applyText(selection, 'x').kind).toBe('none')
    expect(buffer.applyEdits(selection, [{ from: 0, to: 1, text: 'A' }]).kind).toBe('none')
    expect(buffer.backspace(selection).kind).toBe('none')
    expect(buffer.deleteSelection(selection).kind).toBe('none')
    expect(buffer.undo().kind).toBe('none')
    expect(buffer.redo().kind).toBe('none')
    expect(buffer.materializeFullText()).toBe('abc!')
    releaseDocumentMutationLease(buffer, lease)
  })

  it('allows only a prepared commit and reciprocal reverse carrying the matching lease', () => {
    const buffer = createEditorTextBuffer('abc')
    const prepared = prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 1, null)
    const lease = acquiredLease(buffer, 'owner')
    expect(
      commitPreparedDocumentTransaction(transactionTarget(buffer), prepared, {
        history: { kind: 'external-barrier', groupId: 'group' },
      }).status,
    ).toBe('stale')

    const committed = commitPreparedDocumentTransaction(
      transactionTarget(buffer, null, lease),
      prepared,
      { history: { kind: 'external-barrier', groupId: 'group' } },
    )
    if (committed.status !== 'committed') throw new RangeError('expected commit')
    expect(reverseDocumentTransaction(transactionTarget(buffer), committed.receipt).status).toBe(
      'stale',
    )
    expect(
      reverseDocumentTransaction(transactionTarget(buffer, null, lease), committed.receipt).status,
    ).toBe('reversed')
  })

  it('marks every mounted view non-editable until the lease is released', () => {
    const mounted = mountTwoBufferViews('abc')
    const lease = acquiredLease(mounted.buffer, 'owner')
    expect(mounted.inputs.every((input) => input.readOnly)).toBe(true)

    releaseDocumentMutationLease(mounted.buffer, lease)
    expect(mounted.inputs.every((input) => !input.readOnly)).toBe(true)
    mounted.dispose()
  })

  it('publishes one non-text lease state event on acquire and release to every mounted view', () => {
    const buffer = createEditorTextBuffer('abc')
    const first = vi.fn()
    const second = vi.fn()
    subscribeDocumentMutationLeaseState(buffer, first)
    subscribeDocumentMutationLeaseState(buffer, second)

    const lease = acquiredLease(buffer, 'owner')
    releaseDocumentMutationLease(buffer, lease)
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)
    expect(first.mock.calls.map(([state]) => state.isLeased)).toEqual([true, false])
  })

  it('rotates a shared document sync segment under lease without changing text revision dirty or history', () => {
    const buffer = createEditorTextBuffer('abc')
    const point = buffer.getDocumentSyncPoint()
    const lease = acquiredLease(buffer, 'owner')
    const result = rotateDocumentSyncSegment(buffer, point, lease)

    expect(result.status).toBe('rotated')
    if (result.status !== 'rotated') return
    expect(result.syncPoint.segment).not.toBe(point.segment)
    expect(result.syncPoint.revision).toBe(point.revision)
    expect(buffer.materializeFullText()).toBe('abc')
    expect(buffer.getRevision()).toBe(0)
    expect(buffer.isDirty()).toBe(false)
    expect(buffer.canUndo()).toBe(false)
  })

  it('preserves distinct selections in two mounted views across external commit and rollback', () => {
    const mounted = mountTwoBufferViews('abcd')
    mounted.sessions[0].setSelection(1)
    mounted.sessions[1].setSelection(3)
    mounted.sessions[0].view.setScrollPosition({ top: 11, left: 2 })
    mounted.sessions[1].view.setScrollPosition({ top: 22, left: 4 })
    const receipt = commitExternal(mounted.buffer, [{ from: 2, to: 2, text: 'X' }])

    expect(resolvedSelectionOffsets(mounted.sessions[0])).toEqual([{ start: 1, end: 1 }])
    expect(resolvedSelectionOffsets(mounted.sessions[1])).toEqual([{ start: 4, end: 4 }])
    expect(reverseDocumentTransaction(transactionTarget(mounted.buffer), receipt).status).toBe(
      'reversed',
    )
    expect(resolvedSelectionOffsets(mounted.sessions[0])).toEqual([{ start: 1, end: 1 }])
    expect(resolvedSelectionOffsets(mounted.sessions[1])).toEqual([{ start: 3, end: 3 }])
    expect(mounted.sessions.map((session) => session.view.getScrollPosition())).toEqual([
      { top: 11, left: 2 },
      { top: 22, left: 4 },
    ])
    mounted.dispose()
  })

  it('restores the source view selection through reciprocal single-segment undo and redo', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    session.setSelection(1)
    const target = transactionTarget(buffer, session.view)
    const committed = commitPreparedDocumentTransaction(
      target,
      prepareDocumentTransaction(buffer, [{ from: 0, to: 0, text: 'X' }], 1, null),
      { history: { kind: 'external-barrier', groupId: 'group' } },
    )
    if (committed.status !== 'committed') throw new RangeError('expected commit')
    expect(resolvedSelectionOffsets(session)).toEqual([{ start: 2, end: 2 }])

    const undone = reverseDocumentTransaction(target, committed.receipt)
    if (undone.status !== 'reversed') throw new RangeError('expected reverse')
    expect(resolvedSelectionOffsets(session)).toEqual([{ start: 1, end: 1 }])

    const redone = reverseDocumentTransaction(target, undone.receipt)
    if (redone.status !== 'reversed') throw new RangeError('expected reciprocal reverse')
    expect(resolvedSelectionOffsets(session)).toEqual([{ start: 2, end: 2 }])
  })

  it('carries a positive logical revision count on the transaction change and receipt', () => {
    const buffer = createEditorTextBuffer('abc')
    const scope = createDocumentLogicalRevisionScope()
    const result = commitPreparedDocumentTransaction(
      transactionTarget(buffer),
      prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 3, scope),
      { history: { kind: 'external-barrier', groupId: 'group' } },
    )
    if (result.status !== 'committed') throw new RangeError('expected commit')
    expect(result.change.logicalRevisionCount).toBe(3)
    expect(result.change.logicalRevisionScope).toBe(scope)
    expect(result.receipt.logicalRevisionCount).toBe(3)
  })

  it('accepts the safe integer boundary and rejects an unsafe logical revision count', () => {
    const buffer = createEditorTextBuffer('abc')

    expect(() =>
      prepareDocumentTransaction(buffer, [], Number.MAX_SAFE_INTEGER, null),
    ).not.toThrow()
    expect(() => prepareDocumentTransaction(buffer, [], Number.MAX_SAFE_INTEGER + 1, null)).toThrow(
      /positive safe integer/,
    )
  })

  it('commits effective steps with net-identical text as one logical-only synchronize change with no dirty history selection or receipt', () => {
    const buffer = createEditorTextBuffer('abc')
    const view = createEditorViewSession(buffer)
    view.setSelection(2)
    const selection = view.getSelections()
    const listener = vi.fn()
    buffer.subscribe(listener)
    const result = commitPreparedDocumentTransaction(
      transactionTarget(buffer, view),
      prepareDocumentTransaction(buffer, [{ from: 1, to: 2, text: 'b' }], 2, null),
      { history: { kind: 'external-barrier', groupId: 'group' } },
    )

    expect(result.status).toBe('logical-only')
    if (result.status !== 'logical-only') throw new RangeError('expected logical-only commit')
    expect(result.change.kind).toBe('synchronize')
    expect(result.change.logicalRevisionCount).toBe(2)
    expect(buffer.getRevision()).toBe(1)
    expect(buffer.getSnapshot()).toBe(result.change.snapshot)
    expect(view.getSelections()).toBe(selection)
    expect(buffer.isDirty()).toBe(false)
    expect(buffer.canUndo()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('commits two resource-delimited segments with one barrier and one cumulative reciprocal receipt', () => {
    const buffer = createEditorTextBuffer('abc')
    const sequence = prepareDocumentTransactionSequence(buffer, [
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
      {
        edits: [{ from: 1, to: 2, text: 'B' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
    ])
    const target = transactionTarget(buffer)
    const options = { history: { kind: 'external-barrier', groupId: 'group' } } as const
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 0, options).status,
    ).toBe('committed')
    const second = commitPreparedDocumentTransactionSequenceSegment(target, sequence, 1, options)
    expect(second.status).toBe('committed')
    if (second.status !== 'committed') throw new RangeError('expected sequence commit')
    expect(second.receipt?.segmentCount).toBe(2)
    const completed = completePreparedDocumentTransactionSequence(target, sequence)
    expect(completed.status).toBe('completed')
    if (completed.status !== 'completed' || !completed.receipt) {
      throw new RangeError('expected completed sequence')
    }
    expect(completed.receipt).toMatchObject({
      revisionBefore: 0,
      revisionAfter: 2,
      segmentCount: 2,
    })
    expect(completed.receipt.snapshotBefore).toBe(sequence.snapshotBefore)
    expect(completed.receipt.snapshotAfter).toBe(sequence.snapshotAfter)
    expect(buffer.undo().kind).toBe('none')
  })

  it('reverses every committed sequence segment when a later resource boundary fails', () => {
    const committed = commitTwoSegmentSequence()
    const begin = beginReverseDocumentTransactionSequence(committed.target, committed.receipt)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    const second = reverseNextDocumentTransactionSequenceSegment(committed.target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    const first = reverseNextDocumentTransactionSequenceSegment(committed.target, second.cursor, 0)
    expect(first.status).toBe('reversed')
    expect(committed.buffer.materializeFullText()).toBe('abc')
  })

  it('rejects skipped repeated or stale sequence segment commits without mutation', () => {
    const buffer = createEditorTextBuffer('abc')
    const sequence = prepareDocumentTransactionSequence(buffer, [
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
      {
        edits: [{ from: 1, to: 2, text: 'B' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
    ])
    const target = transactionTarget(buffer)
    const options = { history: { kind: 'external-barrier', groupId: 'group' } } as const
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 1, options).status,
    ).toBe('out-of-order')
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 0, options).status,
    ).toBe('committed')
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 0, options).status,
    ).toBe('out-of-order')
    buffer.applyText(rangeSelection(buffer, 3, 3), '!')
    const snapshot = buffer.getSnapshot()
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 1, options).status,
    ).toBe('stale')
    expect(buffer.getSnapshot()).toBe(snapshot)
  })

  it('reverses sequence segments only in descending order and completes with one reciprocal receipt', () => {
    const committed = commitTwoSegmentSequence()
    const begin = beginReverseDocumentTransactionSequence(committed.target, committed.receipt)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    expect(
      reverseNextDocumentTransactionSequenceSegment(committed.target, begin.cursor, 0).status,
    ).toBe('out-of-order')
    const second = reverseNextDocumentTransactionSequenceSegment(committed.target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    expect(completeReverseDocumentTransactionSequence(committed.target, second.cursor).status).toBe(
      'incomplete',
    )
    const first = reverseNextDocumentTransactionSequenceSegment(committed.target, second.cursor, 0)
    if (first.status !== 'reversed') throw new RangeError('expected reverse')
    const completed = completeReverseDocumentTransactionSequence(committed.target, first.cursor)
    expect(completed).toMatchObject({ status: 'completed', receipt: { segmentCount: 2 } })
  })

  it('rejects a reverse cursor after same-text logical revision drift under its matching lease', () => {
    const buffer = createEditorTextBuffer('abc')
    const lease = acquiredLease(buffer, 'reverse-sequence')
    const target = transactionTarget(buffer, null, lease)
    const committed = commitTwoSegmentSequenceOnTarget(target)
    const begin = beginReverseDocumentTransactionSequence(target, committed)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    const second = reverseNextDocumentTransactionSequenceSegment(target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    const snapshot = buffer.getSnapshot()
    const logicalOnly = commitPreparedDocumentTransaction(
      target,
      prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'A' }], 1, null),
      { history: { kind: 'external-barrier', groupId: 'drift' } },
    )
    expect(logicalOnly.status).toBe('logical-only')

    expect(reverseNextDocumentTransactionSequenceSegment(target, second.cursor, 0).status).toBe(
      'stale',
    )
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.materializeFullText()).toBe('Abc')
    releaseDocumentMutationLease(buffer, lease)
  })

  it('rejects reverse completion after same-text logical revision drift', () => {
    const buffer = createEditorTextBuffer('abc')
    const lease = acquiredLease(buffer, 'reverse-completion')
    const target = transactionTarget(buffer, null, lease)
    const committed = commitTwoSegmentSequenceOnTarget(target)
    const begin = beginReverseDocumentTransactionSequence(target, committed)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    const second = reverseNextDocumentTransactionSequenceSegment(target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    const first = reverseNextDocumentTransactionSequenceSegment(target, second.cursor, 0)
    if (first.status !== 'reversed') throw new RangeError('expected reverse')
    const logicalOnly = commitPreparedDocumentTransaction(
      target,
      prepareDocumentTransaction(buffer, [{ from: 0, to: 1, text: 'a' }], 1, null),
      { history: { kind: 'external-barrier', groupId: 'drift' } },
    )
    expect(logicalOnly.status).toBe('logical-only')

    expect(completeReverseDocumentTransactionSequence(target, first.cursor).status).toBe('stale')
    expect(buffer.materializeFullText()).toBe('abc')
    releaseDocumentMutationLease(buffer, lease)
  })

  it('rejects a reverse cursor when its expected current barrier is unlinked', () => {
    const buffer = createEditorTextBuffer('abc')
    const olderReceipt = commitExternal(buffer, [{ from: 2, to: 3, text: 'C' }], 'older')
    const target = transactionTarget(buffer)
    const committed = commitTwoSegmentSequenceOnTarget(target)
    const begin = beginReverseDocumentTransactionSequence(target, committed)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    const second = reverseNextDocumentTransactionSequenceSegment(target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    expect(releaseDocumentTransactionReceipt(target, olderReceipt).status).toBe('released')

    expect(reverseNextDocumentTransactionSequenceSegment(target, second.cursor, 0).status).toBe(
      'stale',
    )
    expect(buffer.materializeFullText()).toBe('AbC')
  })

  it('keeps a cumulative receipt current through a trailing logical-only sequence leg', () => {
    const buffer = createEditorTextBuffer('abc')
    const sequence = prepareDocumentTransactionSequence(buffer, [
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 3,
        logicalRevisionScope: null,
      },
    ])
    const target = transactionTarget(buffer)
    const options = { history: { kind: 'external-barrier', groupId: 'group' } } as const
    expect(
      commitPreparedDocumentTransactionSequenceSegment(target, sequence, 0, options).status,
    ).toBe('committed')
    const logicalOnly = commitPreparedDocumentTransactionSequenceSegment(
      target,
      sequence,
      1,
      options,
    )
    expect(logicalOnly).toMatchObject({
      status: 'logical-only',
      receipt: { revisionAfter: 2, segmentCount: 1 },
    })
    const completed = completePreparedDocumentTransactionSequence(target, sequence)
    if (completed.status !== 'completed' || !completed.receipt) {
      throw new RangeError('expected completed sequence')
    }

    expect(reverseDocumentTransaction(target, completed.receipt).status).toBe('reversed')
    expect(buffer.materializeFullText()).toBe('abc')
  })

  it('threads a cumulative receipt through text logical-only and text sequence legs', () => {
    const buffer = createEditorTextBuffer('abc')
    const sequence = prepareDocumentTransactionSequence(buffer, [
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
      {
        edits: [{ from: 0, to: 1, text: 'A' }],
        logicalRevisionCount: 2,
        logicalRevisionScope: null,
      },
      {
        edits: [{ from: 2, to: 3, text: 'C' }],
        logicalRevisionCount: 1,
        logicalRevisionScope: null,
      },
    ])
    const target = transactionTarget(buffer)
    const options = { history: { kind: 'external-barrier', groupId: 'group' } } as const
    for (let index = 0; index < sequence.segments.length; index += 1) {
      expect(
        commitPreparedDocumentTransactionSequenceSegment(target, sequence, index, options).status,
      ).not.toBe('stale')
    }
    const completed = completePreparedDocumentTransactionSequence(target, sequence)
    if (completed.status !== 'completed' || !completed.receipt) {
      throw new RangeError('expected completed sequence')
    }
    expect(completed.receipt).toMatchObject({ revisionAfter: 3, segmentCount: 2 })

    const begin = beginReverseDocumentTransactionSequence(target, completed.receipt)
    if (begin.status !== 'started') throw new RangeError('expected reverse cursor')
    const second = reverseNextDocumentTransactionSequenceSegment(target, begin.cursor, 1)
    if (second.status !== 'reversed') throw new RangeError('expected reverse')
    const first = reverseNextDocumentTransactionSequenceSegment(target, second.cursor, 0)
    if (first.status !== 'reversed') throw new RangeError('expected reverse')
    expect(completeReverseDocumentTransactionSequence(target, first.cursor).status).toBe(
      'completed',
    )
    expect(buffer.materializeFullText()).toBe('abc')
  })

  it('advances forward replay by K while compensation undo and redo each advance by one', () => {
    const buffer = createEditorTextBuffer('abc')
    const scope = createDocumentLogicalRevisionScope()
    const before = buffer.getDocumentSyncPoint()
    const receipt = commitExternal(buffer, [{ from: 0, to: 1, text: 'A' }], 'group', 4, scope)
    expect(buffer.changesSinceDocumentSyncPoint(before, scope)?.logicalRevisionCount).toBe(4)
    const undone = reverseDocumentTransaction(transactionTarget(buffer), receipt)
    if (undone.status !== 'reversed') throw new RangeError('expected reverse')
    expect(undone.change.logicalRevisionCount).toBe(1)
    const redone = reverseDocumentTransaction(transactionTarget(buffer), undone.receipt)
    if (redone.status !== 'reversed') throw new RangeError('expected reverse')
    expect(redone.change.logicalRevisionCount).toBe(1)
  })

  it('keeps invalid and overlapping preparation atomic', () => {
    const buffer = createEditorTextBuffer('abc')
    const snapshot = buffer.getSnapshot()
    expect(() =>
      prepareDocumentTransaction(
        buffer,
        [
          { from: 0, to: 2, text: 'x' },
          { from: 1, to: 3, text: 'y' },
        ],
        1,
        null,
      ),
    ).toThrow(RangeError)
    expect(buffer.getSnapshot()).toBe(snapshot)
    expect(buffer.getRevision()).toBe(0)
  })

  it('accepts readonly edit fixtures without ownership copies', () => {
    const edit = Object.freeze({ from: 0, to: 1, text: 'A' })
    const edits = Object.freeze([edit])
    const buffer = createEditorTextBuffer('abc')
    const prepared = prepareDocumentTransaction(buffer, edits, 1, null)
    expect(prepared.edits).toEqual(edits)
    expect(edit).toEqual({ from: 0, to: 1, text: 'A' })
  })

  it('classifies consistent LF CRLF and BOM as round-trip safe and mixed lone-CR unusual terminators as unsafe', () => {
    expect(documentTextRoundTripStatus('a\nb\n')).toEqual({
      hasByteOrderMark: false,
      lineEnding: '\n',
      ok: true,
    })
    expect(documentTextRoundTripStatus(`${UTF8_BYTE_ORDER_MARK}a\r\nb\r\n`)).toEqual({
      hasByteOrderMark: true,
      lineEnding: '\r\n',
      ok: true,
    })
    expect(documentTextRoundTripStatus('a\r\nb\nc\rd\u2028e')).toEqual({
      issues: ['mixed-line-endings', 'lone-carriage-return', 'unusual-line-terminator'],
      ok: false,
    })
  })

  it('serializes a prepared snapshot with its original consistent line ending and BOM', () => {
    const buffer = createEditorTextBuffer(`${UTF8_BYTE_ORDER_MARK}a\r\nb`)
    const prepared = prepareDocumentTransaction(buffer, [{ from: 2, to: 3, text: 'B' }], 1, null)
    expect(pieceTableDocumentText(prepared.snapshotAfter)).toBe(`${UTF8_BYTE_ORDER_MARK}a\r\nB`)
  })

  it('exports exact safe and unsafe round-trip discriminants and reason codes', () => {
    const safe = documentTextRoundTripStatus('single line')
    const unsafe = documentTextRoundTripStatus('a\rb')
    expect(safe.ok && safe.lineEnding).toBe('\n')
    expect(!unsafe.ok && unsafe.issues).toEqual(['lone-carriage-return'])
  })
})

function transactionTarget(
  buffer: EditorTextBuffer,
  sourceView: EditorViewSession | null = null,
  mutationLease?: DocumentTransactionCommitTarget['mutationLease'],
): DocumentTransactionCommitTarget {
  return { buffer, sourceView, mutationLease }
}

function acquiredLease(buffer: EditorTextBuffer, ownerId: string) {
  const result = acquireDocumentMutationLease(
    buffer,
    buffer.getRevision(),
    buffer.getSnapshot(),
    ownerId,
  )
  if (result.status !== 'acquired') throw new RangeError('expected lease')
  expect(getDocumentMutationLeaseState(buffer)).toEqual({ isLeased: true, ownerId })
  return result.lease
}

function commitExternal(
  buffer: EditorTextBuffer,
  edits: readonly TextEdit[],
  groupId = 'group',
  logicalRevisionCount = 1,
  logicalRevisionScope = null as ReturnType<typeof createDocumentLogicalRevisionScope> | null,
): DocumentTransactionReceipt {
  const result = commitPreparedDocumentTransaction(
    transactionTarget(buffer),
    prepareDocumentTransaction(buffer, edits, logicalRevisionCount, logicalRevisionScope),
    { history: { kind: 'external-barrier', groupId } },
  )
  if (result.status !== 'committed') throw new RangeError('expected external commit')
  return result.receipt
}

function commitTwoSegmentSequence(): {
  readonly buffer: EditorTextBuffer
  readonly receipt: DocumentTransactionReceipt
  readonly target: DocumentTransactionCommitTarget
} {
  const buffer = createEditorTextBuffer('abc')
  const target = transactionTarget(buffer)
  const receipt = commitTwoSegmentSequenceOnTarget(target)
  return { buffer, receipt, target }
}

function commitTwoSegmentSequenceOnTarget(
  target: DocumentTransactionCommitTarget,
): DocumentTransactionReceipt {
  const buffer = target.buffer
  const sequence = prepareDocumentTransactionSequence(buffer, [
    { edits: [{ from: 0, to: 1, text: 'A' }], logicalRevisionCount: 1, logicalRevisionScope: null },
    { edits: [{ from: 1, to: 2, text: 'B' }], logicalRevisionCount: 1, logicalRevisionScope: null },
  ])
  const options = { history: { kind: 'external-barrier', groupId: 'group' } } as const
  commitPreparedDocumentTransactionSequenceSegment(target, sequence, 0, options)
  commitPreparedDocumentTransactionSequenceSegment(target, sequence, 1, options)
  const completed = completePreparedDocumentTransactionSequence(target, sequence)
  if (completed.status !== 'completed' || !completed.receipt) {
    throw new RangeError('expected completed sequence')
  }
  return completed.receipt
}

function mountTwoBufferViews(text: string): {
  readonly buffer: EditorTextBuffer
  readonly dispose: () => void
  readonly inputs: readonly HTMLTextAreaElement[]
  readonly sessions: readonly ReturnType<typeof createEditorBufferSession>[]
} {
  resetEditorInstanceCount()
  const buffer = createEditorTextBuffer(text)
  const sessions = [
    createEditorBufferSession(buffer, createEditorViewSession(buffer, 'first')),
    createEditorBufferSession(buffer, createEditorViewSession(buffer, 'second')),
  ]
  const containers = [document.createElement('div'), document.createElement('div')]
  const editors = containers.map((container, index) => {
    document.body.appendChild(container)
    const editor = new Editor(container, {})
    editor.attachSession(sessions[index]!)
    return editor
  })
  const inputs = containers.map((container) => container.querySelector('textarea')!)
  return {
    buffer,
    inputs,
    sessions,
    dispose: () => {
      for (const editor of editors) editor.dispose()
      for (const container of containers) container.remove()
    },
  }
}

describe('EditorTextBuffer change notifications', () => {
  it('reaches every listener when one of them throws', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: string[] = []

    buffer.subscribe(() => {
      throw new Error('listener failed')
    })
    buffer.subscribe((event) => seen.push(event.change.kind))

    session.applyText('!')

    expect(seen).toEqual(['edit'])
    expect(reported).toHaveBeenCalled()
    reported.mockRestore()
  })

  it('stops notifying an unsubscribed listener', () => {
    const buffer = createEditorTextBuffer('abc')
    const session = createEditorBufferSession(buffer)
    const seen: string[] = []
    const unsubscribe = buffer.subscribe((event) => seen.push(event.change.kind))

    session.applyText('!')
    unsubscribe()
    session.applyText('?')

    expect(seen).toEqual(['edit'])
  })
})

describe('EditorEventSource', () => {
  it('reports the listener that threw under this source name and keeps delivering', () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    const source = new EditorEventSource<number>({ action: 'test.listener_failed' })
    const failure = new Error('listener failed')
    const seen: number[] = []

    source.subscribe(() => {
      throw failure
    })
    source.subscribe((value) => seen.push(value))

    source.fire(1)

    expect(seen).toEqual([1])
    expect(reported).toHaveBeenCalledWith('[editor]', 'test.listener_failed', failure)
    reported.mockRestore()
  })

  it('delivers to the listeners that were subscribed when the event fired', () => {
    const source = new EditorEventSource<number>({ action: 'test.listener_failed' })
    const late: number[] = []

    source.subscribe(() => {
      source.subscribe((value) => late.push(value))
    })

    source.fire(1)
    expect(late).toEqual([])

    source.fire(2)
    expect(late).toEqual([2])
  })

  it('skips a listener disposed by an earlier listener in the same delivery', () => {
    const source = new EditorEventSource<number>({ action: 'test.listener_failed' })
    const seen: number[] = []
    let second: EditorEventSubscription | null = null

    source.subscribe(() => second?.dispose())
    second = source.subscribe((value) => seen.push(value))

    source.fire(1)

    expect(seen).toEqual([])
  })
})

describe('DocumentSession line endings', () => {
  it('round-trips a byte-order-marked CRLF document through open, edit and save', () => {
    const original = `${UTF8_BYTE_ORDER_MARK}alpha\r\nbeta\r\ngamma`
    const session = createDocumentSession(original)

    // Open: the BOM is off the text and the carriage returns are gone, so
    // offsets are the ones every consumer downstream already assumes.
    expect(session.materializeFullText()).toBe('alpha\nbeta\ngamma')
    expect(renderedLines(session)).toEqual(['alpha', 'beta', 'gamma'])

    session.applyEdits([{ from: 16, to: 16, text: '!' }])

    // Save: both the BOM and the document's own line ending come back, so the
    // file does not turn up as every-line-changed in git after one keystroke.
    expect(pieceTableDocumentText(session.getSnapshot())).toBe(
      `${UTF8_BYTE_ORDER_MARK}alpha\r\nbeta\r\ngamma!`,
    )
  })

  it('never leaves a carriage return at the end of a rendered line', () => {
    const session = createDocumentSession(`${UTF8_BYTE_ORDER_MARK}alpha\r\nbeta`)
    session.applyEdits([{ from: 10, to: 10, text: '\r\ngamma\r\n' }])

    for (const line of renderedLines(session)) {
      expect(line.endsWith('\r')).toBe(false)
    }
    expect(renderedLines(session)).toEqual(['alpha', 'beta', 'gamma', ''])
  })
})

describe('EditorTextBuffer materialization budget', () => {
  it('leaves an ordinary document under the budget', () => {
    expect(createEditorTextBuffer('alpha\nbeta\n').isTooLargeForHeapOperation()).toBe(false)
  })

  it('refuses only above the threshold, not at it', () => {
    // Asserted on the decision itself: the boundary is what an off-by-one or a
    // wrong constant gets wrong, and materializing two 256MB fixtures to probe
    // it would cost more than the whole rest of this suite.
    expect(exceedsHeapOperationBudget(MAX_HEAP_OPERATION_LENGTH - 1)).toBe(false)
    expect(exceedsHeapOperationBudget(MAX_HEAP_OPERATION_LENGTH)).toBe(false)
    expect(exceedsHeapOperationBudget(MAX_HEAP_OPERATION_LENGTH + 1)).toBe(true)
    expect(MAX_HEAP_OPERATION_LENGTH).toBe(256 * 1024 * 1024)
  })

  it(
    'keeps the refusal after the document shrinks back under the budget',
    { timeout: 60_000 },
    () => {
      const oversized = MAX_HEAP_OPERATION_LENGTH + 1
      const buffer = createEditorTextBuffer('a'.repeat(oversized))
      const session = createEditorBufferSession(buffer)

      expect(buffer.isTooLargeForHeapOperation()).toBe(true)

      session.applyEdits([{ from: 0, to: oversized, text: 'tiny' }])

      expect(session.materializeFullText()).toBe('tiny')
      expect(buffer.isTooLargeForHeapOperation()).toBe(true)
    },
  )

  it('keeps the permission after the document grows past the budget', () => {
    const buffer = createEditorTextBuffer('')
    const session = createEditorBufferSession(buffer)

    session.applyEdits([{ from: 0, to: 0, text: 'a'.repeat(1_000) }])

    expect(buffer.isTooLargeForHeapOperation()).toBe(false)
  })
})

describe('document session edit reporting', () => {
  const EMOJI_TEXT = 'a\u{1F600}b'

  it('reports the range it applied when an edit is snapped off a surrogate pair', () => {
    const session = createDocumentSession(EMOJI_TEXT)
    const change = session.applyEdits([{ from: 1, to: 2, text: 'X' }])

    expect(session.materializeFullText()).toBe('aXb')
    // Reporting {from:1,to:2} would tell every consumer the document did not
    // change length, and each of them patches its own copy from this list.
    expect(change.edits).toEqual([{ from: 1, to: 3, text: 'X' }])
    expect(appliedLength(EMOJI_TEXT, change.edits)).toBe(session.getSnapshot().length)
  })

  it('inverts a snapped edit back to the original text', () => {
    const session = createDocumentSession(EMOJI_TEXT)
    session.applyEdits([{ from: 1, to: 2, text: 'X' }])
    session.undo()

    expect(session.materializeFullText()).toBe(EMOJI_TEXT)
  })

  it('applies adjacent edits that together consume a surrogate pair', () => {
    const session = createDocumentSession(EMOJI_TEXT)
    const change = session.applyEdits([
      { from: 0, to: 2, text: 'A' },
      { from: 2, to: 4, text: 'B' },
    ])

    expect(session.materializeFullText()).toBe('AB')
    expect(change.edits).toEqual([
      { from: 0, to: 2, text: 'A' },
      { from: 2, to: 4, text: 'B' },
    ])
  })
})

describe('document session ingestion', () => {
  const LINE_SEPARATOR = '\u2028'

  it('reads back the text the piece table holds, not the text it was given', () => {
    const session = createDocumentSession(`ab${LINE_SEPARATOR}cd`)

    expect(session.getTextSnapshot().materializeFullText()).toBe('ab\ncd')
    expect(session.materializeFullText()).toBe('ab\ncd')
    expect(session.getTextSnapshot().readRange(0, 5)).toBe('ab\ncd')
  })

  it('round-trips a CRLF document with a byte order mark through an edit', () => {
    const buffer = createEditorTextBuffer('\uFEFFalpha\r\nbeta\r\n')
    const session = createEditorBufferSession(buffer)

    session.applyEdits([{ from: 5, to: 5, text: '!' }])

    // Stored LF-only, so no line carries a stray CR into the DOM...
    expect(session.materializeFullText()).toBe('alpha!\nbeta\n')
    expect(session.materializeFullText()).not.toContain('\r')
    // ...and saving restores exactly what was opened, plus the edit.
    expect(pieceTableDocumentText(session.getSnapshot())).toBe('\uFEFFalpha!\r\nbeta\r\n')
  })
})

function appliedLength(source: string, edits: readonly TextEdit[]): number {
  return edits.reduce(
    (result, edit) => result.slice(0, edit.from) + edit.text + result.slice(edit.to),
    source,
  ).length
}

/**
 * The editor's own document, swapped out from under everything the previous one was measured
 * against. A replacement is not an edit, so nothing here is carried across it — whatever the old
 * document gave meaning to has to be taken back rather than reinterpreted.
 */
describe('replacing the document an editor owns', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {})
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
  })

  // The lengths match on purpose: the view drops a map describing text of another length, and that
  // check is the only thing that ever took an expired suggestion off screen.
  it('takes back an inline suggestion offered against the document it replaced', async () => {
    await open('aaaaaaa', 7)
    expect(editor.setInlineSuggestion({ from: 0, to: 7, text: 'aaaaaaaGHOST' })).toBe(true)
    await flushEditor()
    expect(ghostText()).toBe('GHOST')

    editor.setText('xx\nxxxx')
    await flushEditor()

    expect(ghostText()).toBe(null)
    expect(rowTexts()).toEqual(['xx', 'xxxx'])
  })

  it('takes it back when another document is opened over the one it was offered against', async () => {
    await open('con', 3)
    editor.setInlineSuggestion({ from: 0, to: 3, text: 'const answer' })
    await flushEditor()
    expect(ghostText()).toBe('st answer')

    editor.openDocument({ documentId: 'other.ts', text: 'zzz' })
    await flushEditor()

    expect(ghostText()).toBe(null)
    expect(rowTexts()).toEqual(['zzz'])
  })

  async function open(text: string, caret: number): Promise<void> {
    editor.openDocument({ documentId: 'main.ts', text })
    editor.setSelection(caret, caret)
    await flushEditor()
  }

  function ghostText(): string | null {
    return container.querySelector('.editor-ghost-text')?.textContent ?? null
  }

  function rowTexts(): readonly (string | null)[] {
    return [...container.querySelectorAll('.editor-virtualized-row')].map((row) => row.textContent)
  }

  async function flushEditor(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 180))
    await Promise.resolve()
    await Promise.resolve()
  }
})
