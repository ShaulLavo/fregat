import { describe, expect, test } from 'vitest'
import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
} from './index'
import { isHighSurrogate, isLowSurrogate, splitsSurrogatePair } from './reads'
import type { PieceTableSnapshot } from './pieceTableTypes'

const HIGH = '\ud83d'
const LOW = '\ude00'
const OTHER_LOW = '\ude01'

const oracle = (text: string, offset: number): boolean =>
  isHighSurrogate(text.charCodeAt(offset - 1)) && isLowSurrogate(text.charCodeAt(offset))

const expectProbeMatchesText = (snapshot: PieceTableSnapshot): void => {
  const text = materializePieceTableFullText(snapshot)
  for (let offset = 0; offset <= text.length; offset++) {
    expect(
      splitsSurrogatePair(snapshot, offset),
      `offset ${offset} of ${JSON.stringify(text)}`,
    ).toBe(oracle(text, offset))
  }
}

describe('surrogate probe', () => {
  test('never reports a split at the document ends', () => {
    const snapshot = createPieceTableSnapshot(`${HIGH}${LOW}`)
    expect(splitsSurrogatePair(snapshot, 0)).toBe(false)
    expect(splitsSurrogatePair(snapshot, 1)).toBe(true)
    expect(splitsSurrogatePair(snapshot, 2)).toBe(false)
    expect(splitsSurrogatePair(createPieceTableSnapshot(''), 0)).toBe(false)
  })

  test('reads a pair whose halves sit in different pieces and chunks', () => {
    // Appending at the end is never snapped, so the low half lands in a new chunk.
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot(`a${HIGH}`), 2, `${LOW}b`)
    expect(materializePieceTableFullText(snapshot)).toBe(`a${HIGH}${LOW}b`)
    expect(splitsSurrogatePair(snapshot, 2)).toBe(true)
    expectProbeMatchesText(snapshot)
  })

  test('reads across a tombstone left between the halves', () => {
    // Swapping one low half for another is a whole-code-point edit, so it is
    // applied as given: the old half becomes a tombstone between the new halves.
    const snapshot = applyBatchToPieceTable(createPieceTableSnapshot(`a${HIGH}${LOW}b`), [
      { from: 2, to: 3, text: OTHER_LOW },
    ])
    expect(materializePieceTableFullText(snapshot)).toBe(`a${HIGH}${OTHER_LOW}b`)
    expect(snapshot.pieceCount).toBeGreaterThan(3)
    expect(splitsSurrogatePair(snapshot, 2)).toBe(true)
    expectProbeMatchesText(snapshot)
  })

  // The log remembers one tail unit; a newer chunk must not answer for an older view.
  test('reads an older view whose tail chunk is no longer the log tail', () => {
    const snapshot = createPieceTableSnapshot('a\u{1F600}')
    insertIntoPieceTable(snapshot, 0, 'x')
    const text = materializePieceTableFullText(insertIntoPieceTable(snapshot, 2, 'y'))
    expect(text).toBe('ay\u{1F600}')
  })

  test('ignores a low half that follows a low half', () => {
    const snapshot = createPieceTableSnapshot(`${HIGH}${LOW}${HIGH}${LOW}`)
    expect(splitsSurrogatePair(snapshot, 2)).toBe(false)
    expectProbeMatchesText(snapshot)
  })

  test('matches the string oracle across a churned emoji document', () => {
    let state = 1
    const random = (limit: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % limit
    }
    const tokens = ['x', '😀', 'שלום', `${HIGH}${LOW}${HIGH}${LOW}`, '\n']
    let snapshot = createPieceTableSnapshot('😀a😀'.repeat(8))
    for (let step = 0; step < 200; step++) {
      const text = materializePieceTableFullText(snapshot)
      const from = random(text.length + 1)
      const to = Math.min(text.length, from + random(6))
      snapshot =
        random(3) === 0
          ? deleteFromPieceTable(snapshot, from, to - from)
          : insertIntoPieceTable(snapshot, from, tokens[random(tokens.length)]!)
      expectProbeMatchesText(snapshot)
    }
  })
})
