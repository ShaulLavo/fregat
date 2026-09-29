import { describe, expect, test } from 'vitest'
import {
  anchorAt,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  materializePieceTableFullText,
  insertIntoPieceTable,
  resolveAnchor,
  resolveAnchorLinear,
} from './index'
import { validatePieceTreeInvariants } from './debug'
import type { PieceTableSnapshot, RealAnchor } from './pieceTableTypes'
import { reverseIndexEntries } from './reverseIndex'
import { flattenPieces } from './tree'

const expectValid = (snapshot: PieceTableSnapshot): void =>
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])

const expectResolvesLikeLinear = (
  snapshot: PieceTableSnapshot,
  anchors: readonly RealAnchor[],
): void => {
  for (const anchor of anchors) {
    expect(resolveAnchor(snapshot, anchor)).toEqual(resolveAnchorLinear(snapshot, anchor))
  }
}

const randomSource = (seed: number) => {
  let state = seed >>> 0
  return (limit: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % limit
  }
}

describe('reverse index maintenance', () => {
  test('holds one entry per inserted piece and none for the original buffer', () => {
    let snapshot = createPieceTableSnapshot('alpha\nbeta\ngamma')
    snapshot = insertIntoPieceTable(snapshot, 8, 'one')
    snapshot = insertIntoPieceTable(snapshot, 9, 'two')
    snapshot = deleteFromPieceTable(snapshot, 2, 9)
    snapshot = insertIntoPieceTable(snapshot, 2, 'three')

    const inserted = flattenPieces(snapshot.root, []).filter((piece) => piece.buffer !== 0)
    const entries = reverseIndexEntries(snapshot.reverseIndex)
    expect(entries.map((entry) => entry.order).toSorted()).toEqual(
      inserted.map((piece) => piece.order).toSorted(),
    )
    expect(entries.every((entry) => entry.buffer !== 0)).toBe(true)
    expectValid(snapshot)
  })

  // An entry holds a key and an order. Typing into a piece, hiding one and
  // cutting the original buffer change neither, so the index is reused whole.
  test('typing, deleting and cutting original text write nothing', () => {
    const typed = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'x')
    const more = insertIntoPieceTable(typed, 4, 'y')
    const hidden = deleteFromPieceTable(more, 3, 2)
    const cut = deleteFromPieceTable(hidden, 1, 1)

    expect(more.pieceCount).toBe(typed.pieceCount)
    expect(more.reverseIndex).toBe(typed.reverseIndex)
    expect(hidden.reverseIndex).toBe(typed.reverseIndex)
    expect(cut.reverseIndex).toBe(typed.reverseIndex)
    expectValid(cut)
  })

  test('grows through every level of the vector and still finds each buffer', () => {
    let snapshot = createPieceTableSnapshot('0123456789'.repeat(40))
    const anchors: RealAnchor[] = []
    const random = randomSource(39)
    // Two units at a time, at scattered offsets, so no insert coalesces.
    for (let edit = 0; edit < 4500; edit += 1) {
      const offset = random(snapshot.length + 1)
      snapshot = insertIntoPieceTable(snapshot, offset, 'ab')
      if (edit % 9 === 0) anchors.push(anchorAt(snapshot, offset + 1, edit % 2 ? 'left' : 'right'))
    }

    expect(snapshot.reverseIndex.count).toBeGreaterThan(4096)
    expect(materializePieceTableFullText(snapshot).length).toBe(400 + 9000)
    expectResolvesLikeLinear(snapshot, anchors)
    expectValid(snapshot)
  }, 30_000)

  test('two branches of one snapshot append without seeing each other', () => {
    const root = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 2, 'ROOT')
    const first = insertIntoPieceTable(root, 1, 'first')
    const second = insertIntoPieceTable(root, 9, 'second!')
    const inFirst = anchorAt(first, 3, 'right')
    const inSecond = anchorAt(second, 12, 'right')

    // Both branches numbered their insert 2: the anchor is only theirs to read.
    expect(inFirst.buffer).toBe(inSecond.buffer)
    expect(first.reverseIndex.tail).toBe(root.reverseIndex.tail)
    expect(second.reverseIndex.tail).not.toBe(root.reverseIndex.tail)
    expect(resolveAnchor(first, inFirst)).toEqual({ offset: 3, liveness: 'live' })
    expect(resolveAnchor(second, inSecond)).toEqual({ offset: 12, liveness: 'live' })
    expect(resolveAnchor(root, inFirst)).toEqual({ offset: 0, liveness: 'deleted' })
    for (const snapshot of [root, first, second]) expectValid(snapshot)
  })

  test('an older snapshot reads its own entries after newer ones cut a buffer', () => {
    const older = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'WXYZ')
    const anchor = anchorAt(older, 6, 'left')
    const newer = insertIntoPieceTable(older, 5, '--')

    expect(resolveAnchor(older, anchor)).toEqual({ offset: 6, liveness: 'live' })
    expect(resolveAnchor(newer, anchor)).toEqual({ offset: 8, liveness: 'live' })
    expectValid(older)
    expectValid(newer)
  })
})

describe('anchors resolved after every edit', () => {
  // A stale or half-written index shows up as a disagreement with the linear
  // resolver on the very edit that caused it, not at the end of a run.
  const runScenario = (seed: number): void => {
    const random = randomSource(seed)
    let snapshot = createPieceTableSnapshot('const value = "original text";\n'.repeat(6))
    const anchors: RealAnchor[] = []
    const tokens = ['x', 'hello ', '\n', '😀', 'paste me in here ']
    for (let edit = 0; edit < 160; edit += 1) {
      for (let made = 0; made < 3; made += 1) {
        anchors.push(anchorAt(snapshot, random(snapshot.length + 1), made % 2 ? 'left' : 'right'))
      }
      const from = random(snapshot.length + 1)
      const to = Math.min(snapshot.length, from + (random(3) === 0 ? random(12) : 0))
      const text = random(4) === 0 ? '' : tokens[random(tokens.length)]!
      snapshot = applyBatchToPieceTable(snapshot, [{ from, to, text }])
      expectResolvesLikeLinear(snapshot, anchors)
    }
    expectValid(snapshot)
  }

  test.each([1, 2, 3, 4, 5, 6])('matches the linear resolver, seed %i', runScenario, 30_000)
})

describe('relabelling after order normalization', () => {
  test('keeps deleted anchors and every entry through the rebuild', () => {
    let snapshot = createPieceTableSnapshot('ab')
    snapshot = insertIntoPieceTable(snapshot, 1, 'DELETED')
    const left = anchorAt(snapshot, 4, 'left')
    const right = anchorAt(snapshot, 4, 'right')
    snapshot = deleteFromPieceTable(snapshot, 1, 7)
    const before = snapshot
    // Inserting at one spot halves the same order gap until none is left.
    for (let edit = 0; edit < 120; edit += 1)
      snapshot = insertIntoPieceTable(snapshot, 1, `${edit % 10}`)

    const orders = flattenPieces(snapshot.root, []).map((piece) => piece.order)
    expect(orders.every((order) => Number.isInteger(order))).toBe(true)
    expect(resolveAnchor(before, left)).toEqual({ offset: 1, liveness: 'deleted' })
    expectResolvesLikeLinear(snapshot, [left, right])
    expect(resolveAnchor(snapshot, left).liveness).toBe('deleted')
    expectValid(snapshot)
  })
})

describe('deleted anchors in an insert with no other piece of its buffer', () => {
  const deletedInsert = () => {
    const inserted = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'WORD')
    const anchors = {
      left: anchorAt(inserted, 5, 'left'),
      right: anchorAt(inserted, 5, 'right'),
    }
    return { snapshot: deleteFromPieceTable(inserted, 3, 4), anchors }
  }

  test('a left-biased anchor takes the gap, not the document start', () => {
    const { snapshot, anchors } = deletedInsert()
    expect(resolveAnchor(snapshot, anchors.left)).toEqual({ offset: 3, liveness: 'deleted' })
    expect(resolveAnchorLinear(snapshot, anchors.left)).toEqual({ offset: 3, liveness: 'deleted' })
  })

  test('a right-biased anchor takes the gap, not the document end', () => {
    const { snapshot, anchors } = deletedInsert()
    expect(resolveAnchor(snapshot, anchors.right)).toEqual({ offset: 3, liveness: 'deleted' })
    expect(resolveAnchorLinear(snapshot, anchors.right)).toEqual({ offset: 3, liveness: 'deleted' })
  })

  test('bias puts the two on either side of text that replaces the insert', () => {
    const inserted = insertIntoPieceTable(createPieceTableSnapshot('abcdef'), 3, 'WORD')
    const left = anchorAt(inserted, 5, 'left')
    const right = anchorAt(inserted, 5, 'right')
    const replaced = applyBatchToPieceTable(inserted, [{ from: 3, to: 7, text: 'new' }])

    expect(materializePieceTableFullText(replaced)).toBe('abcnewdef')
    expect(resolveAnchor(replaced, left)).toEqual({ offset: 3, liveness: 'deleted' })
    expect(resolveAnchor(replaced, right)).toEqual({ offset: 6, liveness: 'deleted' })
    expectResolvesLikeLinear(replaced, [left, right])
  })

  test('text typed into the gap later lands between the two as well', () => {
    const { snapshot, anchors } = deletedInsert()
    const typed = insertIntoPieceTable(snapshot, 3, 'later')

    expect(resolveAnchor(typed, anchors.left)).toEqual({ offset: 3, liveness: 'deleted' })
    expect(resolveAnchor(typed, anchors.right)).toEqual({ offset: 8, liveness: 'deleted' })
  })
})
