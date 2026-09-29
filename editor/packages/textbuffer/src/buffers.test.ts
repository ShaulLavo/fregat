import { describe, expect, test } from 'vitest'
import {
  anchorAfter,
  anchorBefore,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  pointToOffset,
  resolveAnchor,
  resolveAnchorLinear,
} from './index'
import { validatePieceTreeInvariants } from './inspection'
import { BUFFER_CHUNK_SIZE, chunkOfBuffer, getBufferText } from './buffers'
import { flattenPieces } from './tree'
import type { PieceTableSnapshot } from './pieceTableTypes'

type Random = () => number

const createRandom = (seed: number): Random => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const TOKENS = ['x', '\n', 'hello ', '😀', 'שלום', 'é', '\t', '中']

const safeOffset = (text: string, offset: number): number => {
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  const insidePair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
  return insidePair ? offset - 1 : offset
}

const expectValid = (snapshot: PieceTableSnapshot): void => {
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
}

// Every offset mapped both ways against the text itself. A stale or foreign
// line index shows up as a row that does not exist or a column off by one.
const expectEveryOffsetMapped = (snapshot: PieceTableSnapshot, text: string): void => {
  let row = 0
  let lineStart = 0
  for (let offset = 0; offset <= text.length; offset += 1) {
    const point = { row, column: offset - lineStart }
    const mapped = offsetToPoint(snapshot, offset)
    if (mapped.row !== point.row || mapped.column !== point.column) {
      expect({ offset, point: mapped }).toEqual({ offset, point })
    }
    const back = pointToOffset(snapshot, point)
    if (back !== offset) expect({ point, offset: back }).toEqual({ point, offset })
    if (text.charCodeAt(offset) === 0x0a) {
      row += 1
      lineStart = offset + 1
    }
  }
}

const randomInserts = (
  snapshot: PieceTableSnapshot,
  text: string,
  random: Random,
  count: number,
): { snapshot: PieceTableSnapshot; text: string; history: [PieceTableSnapshot, string][] } => {
  const history: [PieceTableSnapshot, string][] = []
  let next = snapshot
  let expected = text
  for (let index = 0; index < count; index += 1) {
    const at = safeOffset(expected, Math.floor(random() * (expected.length + 1)))
    const token = TOKENS[Math.floor(random() * TOKENS.length)]!
    next = insertIntoPieceTable(next, at, token)
    expected = expected.slice(0, at) + token + expected.slice(at)
    history.push([next, expected])
  }
  return { snapshot: next, text: expected, history }
}

describe('filling chunks before opening new ones', () => {
  test('unrelated inserts share the newest chunk under distinct buffer ids', () => {
    const base = createPieceTableSnapshot('0123456789'.repeat(20))
    const first = insertIntoPieceTable(base, 5, 'A')
    const second = insertIntoPieceTable(first, 150, 'BB')
    const third = insertIntoPieceTable(second, 42, 'C\n')

    const oracle = (text: string, at: number, inserted: string) =>
      text.slice(0, at) + inserted + text.slice(at)
    const expected = oracle(oracle(oracle('0123456789'.repeat(20), 5, 'A'), 150, 'BB'), 42, 'C\n')
    expect(materializePieceTableFullText(third)).toBe(expected)
    // One original chunk and one append chunk, holding three buffers.
    expect(third.buffers.chunks.size).toBe(2)
    expect(third.buffers.nextBufferSequence).toBe(4)
    const appended = flattenPieces(third.root, []).filter((piece) => piece.buffer !== 0)
    expect(appended.map((piece) => [piece.buffer, piece.start, piece.length])).toEqual([
      [1, 0, 1],
      [3, 3, 2],
      [2, 1, 2],
    ])
    for (const piece of appended) expect(chunkOfBuffer(third.buffers, piece.buffer)).toBe(1)
    expect(getBufferText(third.buffers, appended[0]!.buffer)).toBe('ABBC\n')
    expectValid(third)
  })

  test('a fill that would split a pair or CRLF at the chunk limit opens the next chunk instead', () => {
    const base = createPieceTableSnapshot('')
    const nearlyFull = insertIntoPieceTable(base, 0, 'x'.repeat(BUFFER_CHUNK_SIZE - 1))
    expect(nearlyFull.buffers.chunks.size).toBe(2)

    for (const text of ['\u{1d11e}yy', '\r\nyy']) {
      const inserted = insertIntoPieceTable(nearlyFull, 10, text)
      const pieces = flattenPieces(inserted.root, []).filter((piece) => piece.buffer !== 0)
      const texts = pieces.map((piece) =>
        getBufferText(inserted.buffers, piece.buffer).slice(
          piece.start,
          piece.start + piece.length,
        ),
      )
      // The insert is one buffer in the new chunk, not a one-unit fill plus a remainder.
      expect(texts).toEqual(['x'.repeat(10), text, 'x'.repeat(BUFFER_CHUNK_SIZE - 11)])
      expect(inserted.buffers.chunks.size).toBe(3)
      expect(materializePieceTableFullText(inserted)).toBe(
        'x'.repeat(10) + text + 'x'.repeat(BUFFER_CHUNK_SIZE - 11),
      )
      expectValid(inserted)
    }

    const plain = insertIntoPieceTable(nearlyFull, 10, 'ab')
    expect(plain.buffers.chunks.size).toBe(3)
    const filled = flattenPieces(plain.root, []).find(
      (piece) => piece.start === BUFFER_CHUNK_SIZE - 1,
    )
    expect(filled).toMatchObject({ length: 1 })
    expectValid(plain)
  })

  test('chunk count grows with text volume, not edit count', () => {
    const random = createRandom(7)
    const { snapshot, text } = randomInserts(
      createPieceTableSnapshot('seed\n'),
      'seed\n',
      random,
      800,
    )
    expect(materializePieceTableFullText(snapshot)).toBe(text)
    expect(snapshot.buffers.chunks.size).toBeLessThanOrEqual(
      2 + Math.ceil(text.length / BUFFER_CHUNK_SIZE),
    )
    expect(snapshot.buffers.nextBufferSequence).toBeGreaterThan(400)
    expectValid(snapshot)
  })
})

describe('branches over a shared log', () => {
  test('two branches from one snapshot never see each other, nor do retained ancestors', () => {
    const original = 'alpha\nbeta\ngamma\n'.repeat(40)
    const base = createPieceTableSnapshot(original)
    const trunk = randomInserts(base, original, createRandom(1), 60)
    const fork = trunk.snapshot
    const forkText = trunk.text

    const left = randomInserts(fork, forkText, createRandom(2), 120)
    const right = randomInserts(fork, forkText, createRandom(3), 120)
    const leftAgain = randomInserts(left.snapshot, left.text, createRandom(4), 40)

    for (const branch of [left, right, leftAgain]) {
      expect(materializePieceTableFullText(branch.snapshot)).toBe(branch.text)
      expectEveryOffsetMapped(branch.snapshot, branch.text)
      expectValid(branch.snapshot)
    }
    expect(materializePieceTableFullText(fork)).toBe(forkText)
    expectEveryOffsetMapped(fork, forkText)
    expect(materializePieceTableFullText(base)).toBe(original)

    // Every retained intermediate state on every branch still reads exactly.
    for (const [snapshot, text] of [...trunk.history, ...left.history, ...right.history]) {
      expect(materializePieceTableFullText(snapshot)).toBe(text)
    }
  })

  test('two branches filling one tail chunk place their own line breaks, then cut them', () => {
    const original = 'one\ntwo\nthree\n'
    let trunk = createPieceTableSnapshot(original)
    trunk = insertIntoPieceTable(trunk, 4, 'T\nT\n')
    const trunkText = 'one\nT\nT\ntwo\nthree\n'

    // The left branch appends in place; the right one forks the log, so the
    // same tail offsets hold different breaks at the same index positions.
    const left = insertIntoPieceTable(trunk, 0, 'L\n\nL\nL')
    const right = insertIntoPieceTable(trunk, trunkText.length, 'RR\nR\n\n\nR')
    const leftCut = deleteFromPieceTable(insertIntoPieceTable(left, 3, '\n!\n'), 1, 8)
    const rightCut = deleteFromPieceTable(right, trunkText.length + 1, 5)

    const leftText = 'L\n\nL\nL' + trunkText
    const leftCutText = (leftText.slice(0, 3) + '\n!\n' + leftText.slice(3)).replace(
      /^(.).{8}/s,
      '$1',
    )
    const rightText = trunkText + 'RR\nR\n\n\nR'
    const rightCutText =
      rightText.slice(0, trunkText.length + 1) + rightText.slice(trunkText.length + 6)
    for (const [snapshot, text] of [
      [trunk, trunkText],
      [left, leftText],
      [right, rightText],
      [leftCut, leftCutText],
      [rightCut, rightCutText],
    ] as const) {
      expect(materializePieceTableFullText(snapshot)).toBe(text)
      expectEveryOffsetMapped(snapshot, text)
      expectValid(snapshot)
    }
  })

  test('an undone branch re-minting a buffer id does not leak its text or line index', () => {
    const base = createPieceTableSnapshot('one\ntwo\nthree')
    expectEveryOffsetMapped(base, 'one\ntwo\nthree')

    const abandoned = insertIntoPieceTable(base, 8, 'x\ny')
    expectEveryOffsetMapped(abandoned, 'one\ntwo\nx\nythree')
    const abandonedMore = insertIntoPieceTable(abandoned, 2, '\n\n')
    expectEveryOffsetMapped(abandonedMore, 'on\n\ne\ntwo\nx\nythree')

    const kept = insertIntoPieceTable(base, 9, 'QQQ')
    expect(materializePieceTableFullText(kept)).toBe('one\ntwo\ntQQQhree')
    expect(offsetToPoint(kept, 11)).toEqual({ row: 2, column: 3 })
    expectEveryOffsetMapped(kept, 'one\ntwo\ntQQQhree')
    expect(kept.buffers.nextBufferSequence).toBe(abandoned.buffers.nextBufferSequence)

    expect(materializePieceTableFullText(abandonedMore)).toBe('on\n\ne\ntwo\nx\nythree')
    expectEveryOffsetMapped(abandonedMore, 'on\n\ne\ntwo\nx\nythree')
    expectValid(kept)
    expectValid(abandonedMore)
  })

  test('an older snapshot keeps reading its own extent after newer appends', () => {
    const base = createPieceTableSnapshot('abc')
    const one = insertIntoPieceTable(base, 1, 'X')
    const two = insertIntoPieceTable(one, 2, 'Y')
    const three = insertIntoPieceTable(two, 0, 'Z')
    const tail = flattenPieces(one.root, []).find((piece) => piece.buffer !== 0)!

    expect(base.buffers.chunks.size).toBe(1)
    expect(base.buffers.chunks.get(tail.buffer)).toBeUndefined()
    expect(one.buffers.chunks.size).toBe(2)
    expect(getBufferText(one.buffers, tail.buffer)).toBe('X')
    expect(getBufferText(two.buffers, tail.buffer)).toBe('XY')
    expect(getBufferText(three.buffers, tail.buffer)).toBe('XYZ')
    expect([...one.buffers.chunks.keys()]).toEqual([0, 1])
    // Y coalesced onto X's buffer; only Z minted another id.
    expect([...three.buffers.chunks.keys()]).toEqual([0, 1, 2])
    expect(materializePieceTableFullText(one)).toBe('aXbc')
    expect(materializePieceTableFullText(two)).toBe('aXYbc')
    expect(materializePieceTableFullText(three)).toBe('ZaXYbc')
  })

  test('sequential typing keeps extending one piece in place', () => {
    let snapshot = createPieceTableSnapshot('')
    let text = ''
    for (let index = 0; index < 300; index += 1) {
      const token = index % 7 === 6 ? '\n' : String.fromCharCode(97 + (index % 26))
      snapshot = insertIntoPieceTable(snapshot, text.length, token)
      text += token
      if (index % 5 === 0)
        expect(offsetToPoint(snapshot, text.length)).toEqual(offsetToPoint(snapshot, text.length))
    }
    expect(materializePieceTableFullText(snapshot)).toBe(text)
    expect(snapshot.pieceCount).toBe(1)
    expect(snapshot.buffers.chunks.size).toBe(2)
    expect(snapshot.buffers.nextBufferSequence).toBe(2)
    expectEveryOffsetMapped(snapshot, text)
    expectValid(snapshot)
  })
})

describe('deleted anchors inside a shared chunk', () => {
  // Unrelated inserts now sit next to each other in one chunk. The edge rules
  // read the reverse index's same-buffer neighbours as the gap edges, so a
  // buffer id must still mean one insert: otherwise a deleted anchor would
  // snap to wherever the previous insert happened to land in the document.
  test('take their gap edges from their own insert, not from a chunk neighbour', () => {
    const base = createPieceTableSnapshot('0123456789'.repeat(20))
    const first = insertIntoPieceTable(base, 5, 'x')
    const second = insertIntoPieceTable(first, 100, 'yyy')
    expect(second.buffers.chunks.size).toBe(2)
    const left = anchorBefore(second, 102)
    const right = anchorAfter(second, 101)

    const deleted = deleteFromPieceTable(second, 101, 1)
    expect(resolveAnchor(deleted, left)).toEqual({ offset: 101, liveness: 'deleted' })
    expect(resolveAnchor(deleted, right)).toEqual({ offset: 101, liveness: 'deleted' })

    const retyped = insertIntoPieceTable(deleted, 101, 'ZZ')
    expect(materializePieceTableFullText(retyped).slice(99, 105)).toBe('8yZZy9')
    expect(resolveAnchor(retyped, left)).toEqual({ offset: 101, liveness: 'deleted' })
    expect(resolveAnchor(retyped, right)).toEqual({ offset: 103, liveness: 'deleted' })
    for (const anchor of [left, right]) {
      expect(resolveAnchor(retyped, anchor)).toEqual(resolveAnchorLinear(retyped, anchor))
    }

    // The mirror image: the insert holding the anchor comes first in the chunk.
    const reversed = insertIntoPieceTable(insertIntoPieceTable(base, 100, 'yyy'), 5, 'x')
    const anchor = anchorBefore(reversed, 103)
    const gone = deleteFromPieceTable(reversed, 102, 1)
    expect(resolveAnchor(gone, anchor)).toEqual({ offset: 102, liveness: 'deleted' })
    const filled = insertIntoPieceTable(gone, 102, 'ZZ')
    expect(resolveAnchor(filled, anchor)).toEqual({ offset: 102, liveness: 'deleted' })
    expect(resolveAnchor(filled, anchorAfter(reversed, 102))).toEqual({
      offset: 104,
      liveness: 'deleted',
    })
  })
})
