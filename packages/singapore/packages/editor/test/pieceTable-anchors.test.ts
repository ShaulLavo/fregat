import { describe, expect, it } from 'vitest'

import {
  Anchor,
  anchorAfter,
  anchorAt,
  anchorBefore,
  applyBatchToPieceTable,
  compareAnchors,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  type PieceTableAnchor,
  type PieceTableSnapshot,
  resolveAnchor,
  resolveAnchorLinear,
} from '@singapore-editor/textbuffer'

import {
  commitEditorHistory,
  createEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from '../src/history.ts'

const expectIndexedMatchesLinear = (
  snapshot: PieceTableSnapshot,
  anchors: readonly PieceTableAnchor[],
): void => {
  for (const anchor of anchors) {
    expect(resolveAnchor(snapshot, anchor)).toEqual(resolveAnchorLinear(snapshot, anchor))
  }
}

describe('piece table anchors', () => {
  it('resolves sentinel anchors against the current snapshot length', () => {
    const snapshot = createPieceTableSnapshot('abc')

    expect(resolveAnchor(snapshot, Anchor.MIN)).toEqual({ offset: 0, liveness: 'live' })
    expect(resolveAnchor(snapshot, Anchor.MAX)).toEqual({ offset: 3, liveness: 'live' })
  })

  it('uses bias to order anchors at piece boundaries', () => {
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot('ac'), 1, 'b')
    const left = anchorBefore(snapshot, 1)
    const right = anchorAfter(snapshot, 1)

    expect(resolveAnchor(snapshot, left)).toEqual({ offset: 1, liveness: 'live' })
    expect(resolveAnchor(snapshot, right)).toEqual({ offset: 1, liveness: 'live' })
    expect(compareAnchors(snapshot, left, right)).toBeLessThan(0)
  })

  it('reports deleted liveness and keeps indexed resolution aligned with linear resolution', () => {
    const initial = createPieceTableSnapshot('abcdef')
    const anchors = [anchorAt(initial, 1, 'right'), anchorAt(initial, 4, 'left')]
    const edited = insertIntoPieceTable(deleteFromPieceTable(initial, 1, 3), 2, 'XX')

    for (const anchor of anchors) {
      expect(resolveAnchor(edited, anchor)).toEqual(resolveAnchorLinear(edited, anchor))
    }

    expect(resolveAnchor(edited, anchors[0]!)).toMatchObject({ liveness: 'deleted' })
  })

  it('keeps deleted anchors stable through delete and retype', () => {
    const initial = createPieceTableSnapshot('one two three')
    const leftStart = anchorBefore(initial, 4)
    const rightStart = anchorAfter(initial, 4)
    const insideLeft = anchorAt(initial, 5, 'left')
    const insideRight = anchorAt(initial, 5, 'right')
    const leftEnd = anchorBefore(initial, 7)
    const rightEnd = anchorAfter(initial, 7)
    const anchors = [leftStart, rightStart, insideLeft, insideRight, leftEnd, rightEnd]
    const deleted = deleteFromPieceTable(initial, 4, 3)
    const retyped = insertIntoPieceTable(deleted, 4, 'TWO')

    expect(materializePieceTableFullText(retyped)).toBe('one TWO three')
    expectIndexedMatchesLinear(retyped, anchors)
    expect(resolveAnchor(retyped, leftStart)).toEqual({ offset: 4, liveness: 'live' })
    expect(resolveAnchor(retyped, rightStart)).toEqual({ offset: 7, liveness: 'deleted' })
    expect(resolveAnchor(retyped, insideLeft)).toEqual({ offset: 4, liveness: 'deleted' })
    expect(resolveAnchor(retyped, insideRight)).toEqual({ offset: 7, liveness: 'deleted' })
    expect(resolveAnchor(retyped, leftEnd)).toEqual({ offset: 4, liveness: 'deleted' })
    expect(resolveAnchor(retyped, rightEnd)).toEqual({ offset: 7, liveness: 'live' })
  })

  it('preserves replacement bias for single and batched replacements', () => {
    const initial = createPieceTableSnapshot('alpha beta gamma delta')
    const singleLeft = anchorAt(initial, 7, 'left')
    const singleRight = anchorAt(initial, 9, 'right')
    const batchLeft = anchorAt(initial, 0, 'left')
    const batchRight = anchorAt(initial, 22, 'right')
    const single = insertIntoPieceTable(deleteFromPieceTable(initial, 6, 4), 6, 'BETA')
    const batched = applyBatchToPieceTable(initial, [
      { from: 0, to: 5, text: 'ALPHA' },
      { from: 17, to: 22, text: 'DELTA' },
    ])

    expect(materializePieceTableFullText(single)).toBe('alpha BETA gamma delta')
    expectIndexedMatchesLinear(single, [singleLeft, singleRight])
    expect(resolveAnchor(single, singleLeft)).toEqual({ offset: 6, liveness: 'deleted' })
    expect(resolveAnchor(single, singleRight)).toEqual({ offset: 10, liveness: 'deleted' })

    expect(materializePieceTableFullText(batched)).toBe('ALPHA beta gamma DELTA')
    expectIndexedMatchesLinear(batched, [batchLeft, batchRight])
    expect(resolveAnchor(batched, batchLeft)).toEqual({ offset: 0, liveness: 'deleted' })
    expect(resolveAnchor(batched, batchRight)).toEqual({ offset: 22, liveness: 'deleted' })
  })

  it('clamps deleted boundary anchors at document edges', () => {
    const initial = createPieceTableSnapshot('abcdef')
    const prefixLeft = anchorAt(initial, 1, 'left')
    const prefixRight = anchorAt(initial, 1, 'right')
    const suffixLeft = anchorAt(initial, 5, 'left')
    const suffixRight = anchorAt(initial, 5, 'right')
    const prefixDeleted = deleteFromPieceTable(initial, 0, 2)
    const suffixDeleted = deleteFromPieceTable(initial, 4, 2)

    expect(materializePieceTableFullText(prefixDeleted)).toBe('cdef')
    expectIndexedMatchesLinear(prefixDeleted, [prefixLeft, prefixRight, Anchor.MIN, Anchor.MAX])
    expect(resolveAnchor(prefixDeleted, prefixLeft)).toEqual({ offset: 0, liveness: 'deleted' })
    expect(resolveAnchor(prefixDeleted, prefixRight)).toEqual({ offset: 0, liveness: 'deleted' })
    expect(resolveAnchor(prefixDeleted, Anchor.MAX)).toEqual({ offset: 4, liveness: 'live' })

    expect(materializePieceTableFullText(suffixDeleted)).toBe('abcd')
    expectIndexedMatchesLinear(suffixDeleted, [suffixLeft, suffixRight, Anchor.MIN, Anchor.MAX])
    expect(resolveAnchor(suffixDeleted, suffixLeft)).toEqual({ offset: 4, liveness: 'deleted' })
    expect(resolveAnchor(suffixDeleted, suffixRight)).toEqual({ offset: 4, liveness: 'deleted' })
    expect(resolveAnchor(suffixDeleted, Anchor.MAX)).toEqual({ offset: 4, liveness: 'live' })
  })

  it('snaps an offset inside a surrogate pair instead of throwing', () => {
    const snapshot = createPieceTableSnapshot('a\u{1F600}b')

    expect(resolveAnchor(snapshot, anchorAt(snapshot, 2, 'left'))).toEqual({
      offset: 1,
      liveness: 'live',
    })
    expect(resolveAnchor(snapshot, anchorAt(snapshot, 2, 'right'))).toEqual({
      offset: 1,
      liveness: 'live',
    })
  })

  it('toggles liveness across undo and redo snapshot swaps', () => {
    const initial = createPieceTableSnapshot('abcdef')
    const anchor = anchorAt(initial, 2, 'right')
    const history = createEditorHistory(initial, null)
    const deleted = deleteFromPieceTable(initial, 1, 3)
    const committed = commitEditorHistory(history, deleted, null)
    const undone = undoEditorHistory(committed)
    const redone = redoEditorHistory(undone)

    expect(resolveAnchor(initial, anchor)).toEqual({ offset: 2, liveness: 'live' })
    expect(resolveAnchor(committed.current, anchor)).toEqual({ offset: 1, liveness: 'deleted' })
    expect(resolveAnchor(undone.current, anchor)).toEqual({ offset: 2, liveness: 'live' })
    expect(resolveAnchor(redone.current, anchor)).toEqual({ offset: 1, liveness: 'deleted' })
    expectIndexedMatchesLinear(redone.current, [anchor])
  })
})
