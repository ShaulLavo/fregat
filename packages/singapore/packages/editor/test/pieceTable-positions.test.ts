import { describe, expect, it } from 'vitest'

import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  type PieceTableSnapshot,
  type Point,
  pointToOffset,
} from '@singapore-editor/textbuffer'
import type { PieceTreeNode } from '@singapore-editor/textbuffer/internal/pieceTableTypes'
import { lineStartOffset } from '@singapore-editor/textbuffer/internal/positions'

describe('piece table positions', () => {
  it('converts offsets to points at line boundaries', () => {
    const snapshot = createPieceTableSnapshot('ab\ncde\n\nf')

    expect(offsetToPoint(snapshot, 0)).toEqual({ row: 0, column: 0 })
    expect(offsetToPoint(snapshot, 2)).toEqual({ row: 0, column: 2 })
    expect(offsetToPoint(snapshot, 3)).toEqual({ row: 1, column: 0 })
    expect(offsetToPoint(snapshot, 7)).toEqual({ row: 2, column: 0 })
    expect(offsetToPoint(snapshot, 8)).toEqual({ row: 3, column: 0 })
    expect(offsetToPoint(snapshot, 9)).toEqual({ row: 3, column: 1 })
  })

  it('converts points to offsets and clamps outside line bounds', () => {
    const snapshot = createPieceTableSnapshot('ab\ncde\n\nf')

    expect(pointToOffset(snapshot, { row: -1, column: -1 })).toBe(0)
    expect(pointToOffset(snapshot, { row: 0, column: 99 })).toBe(2)
    expect(pointToOffset(snapshot, { row: 1, column: 2 })).toBe(5)
    expect(pointToOffset(snapshot, { row: 2, column: 99 })).toBe(7)
    expect(pointToOffset(snapshot, { row: 99, column: 0 })).toBe(9)
  })

  it('round-trips every offset after edits split pieces', () => {
    const snapshot = insertIntoPieceTable(createPieceTableSnapshot('ab\ncd'), 3, 'XX\n')

    for (let offset = 0; offset <= snapshot.length; offset += 1) {
      expect(pointToOffset(snapshot, offsetToPoint(snapshot, offset))).toBe(offset)
    }
  })

  it('converts an offset whose row start lies in the piece it lands in', () => {
    const snapshot = createPieceTableSnapshot('alpha\nbeta\ngamma\ndelta')

    expect(offsetToPoint(snapshot, 13)).toEqual({ row: 2, column: 2 })
  })

  it('finds a row start from the line break counts, not from the pieces before it', () => {
    const text = Array.from({ length: 600 }, (_, row) => `row ${row} of the document`).join('\n')
    const point = { row: 450, column: 4 }
    const few = buildChunkedSnapshot(text, 50)
    const many = buildChunkedSnapshot(text, 2000)

    expect(few.pieceCount).toBe(50)
    expect(many.pieceCount).toBe(2000)
    expect(pointToOffset(few, point)).toBe(oraclePointToOffset(text, point))
    expect(pointToOffset(many, point)).toBe(oraclePointToOffset(text, point))

    const fewReads = countTreeReads(few, (probe) => pointToOffset(probe, point))
    const manyReads = countTreeReads(many, (probe) => pointToOffset(probe, point))

    // Forty times the pieces for the same query and the same answer: a descent
    // steered by the subtree line break counts grows with tree depth, one that
    // scans the pieces ahead of the row grows with the piece count.
    expect(manyReads).toBeLessThan(fewReads * 4)
  })

  it('finds both ends of a row for little more than the descent to its start', () => {
    const snapshot = buildEditedSourceSnapshot()
    const text = materializePieceTableFullText(snapshot)
    let startReads = 0
    let pointReads = 0

    for (let offset = 0; offset <= text.length; offset += 1) {
      const point = oracleOffsetToPoint(text, offset)
      startReads += countTreeReads(snapshot, (probe) => {
        lineStartOffset(probe, point.row)
      })
      pointReads += countTreeReads(snapshot, (probe) => {
        expect(pointToOffset(probe, point)).toBe(offset)
      })
    }

    // The row's end is in the piece the descent lands in, or a short walk on
    // from it. A second descent for the end would double the reads.
    expect(pointReads).toBeLessThan(startReads * 1.5)
  })

  it('matches a brute-force scan of the materialized text at every offset', () => {
    const fragmented = buildFragmentedSnapshot()
    // The same document minus its final line break, so the last row is covered
    // both as an empty row after a break and as a row that ends the text.
    const trimmed = deleteFromPieceTable(fragmented, fragmented.length - 1, 1)

    expect(materializePieceTableFullText(fragmented).endsWith('\n')).toBe(true)
    expect(materializePieceTableFullText(trimmed).endsWith('\n')).toBe(false)

    for (const snapshot of [fragmented, trimmed]) {
      const text = materializePieceTableFullText(snapshot)

      expect(snapshot.pieceCount).toBeGreaterThan(50)
      expect(text).toContain('\n')

      for (let offset = 0; offset <= text.length; offset += 1) {
        expect(offsetToPoint(snapshot, offset)).toEqual(oracleOffsetToPoint(text, offset))
      }

      expect(offsetToPoint(snapshot, 0)).toEqual({ row: 0, column: 0 })
      expect(offsetToPoint(snapshot, text.length)).toEqual(oracleOffsetToPoint(text, text.length))
    }
  })

  it('matches a brute-force scan at every piece boundary', () => {
    const snapshot = buildFragmentedSnapshot()
    const text = materializePieceTableFullText(snapshot)
    const boundaries = visiblePieceBoundaries(snapshot.root)

    // Boundaries are where a row start can land in a subtree the offset descent
    // never enters, so they are the offsets the derived column gets wrong first.
    expect(boundaries.length).toBeGreaterThan(50)

    for (const offset of boundaries) {
      expect(offsetToPoint(snapshot, offset)).toEqual(oracleOffsetToPoint(text, offset))
      expect(pointToOffset(snapshot, offsetToPoint(snapshot, offset))).toBe(offset)
    }
  })

  it('matches a brute-force scan for every point, including out-of-range ones', () => {
    const snapshot = buildFragmentedSnapshot()
    const text = materializePieceTableFullText(snapshot)
    const rowCount = text.split('\n').length

    for (let row = -2; row <= rowCount + 2; row += 1) {
      for (const column of [-3, 0, 1, 2, 5, Number.MAX_SAFE_INTEGER]) {
        const point = { row, column }
        expect(pointToOffset(snapshot, point)).toBe(oraclePointToOffset(text, point))
      }
    }
  })

  it('stays correct when point and offset queries interleave on one snapshot', () => {
    const snapshot = buildFragmentedSnapshot()
    const text = materializePieceTableFullText(snapshot)

    for (const offset of shuffledOffsets(text.length)) {
      const point = offsetToPoint(snapshot, offset)
      expect(point).toEqual(oracleOffsetToPoint(text, offset))
      expect(pointToOffset(snapshot, point)).toBe(offset)
    }
  })

  it('handles documents without a tree, a trailing newline, or any content', () => {
    for (const text of ['', '\n', 'no trailing newline', '\n\n\n', 'a\nb']) {
      const snapshot = createPieceTableSnapshot(text)

      for (let offset = 0; offset <= text.length; offset += 1) {
        expect(offsetToPoint(snapshot, offset)).toEqual(oracleOffsetToPoint(text, offset))
        expect(pointToOffset(snapshot, offsetToPoint(snapshot, offset))).toBe(offset)
      }
    }
  })
})

// A descent reaches the tree only by reading fields off nodes, so the number of
// those reads is the number of nodes it actually walks — a count of calls says
// how many walks start and nothing about how far each one goes.
const countTreeReads = (
  snapshot: PieceTableSnapshot,
  run: (probe: PieceTableSnapshot) => void,
): number => {
  let reads = 0
  const probes = new WeakMap<PieceTreeNode, PieceTreeNode>()
  const probeNode = (node: PieceTreeNode | null): PieceTreeNode | null => {
    if (!node) return null

    const existing = probes.get(node)
    if (existing) return existing

    const probe = new Proxy(node, {
      get(target, key, receiver) {
        reads += 1
        if (key === 'left') return probeNode(target.left)
        if (key === 'right') return probeNode(target.right)

        return Reflect.get(target, key, receiver)
      },
    })
    probes.set(node, probe)

    return probe
  }

  run(
    new Proxy(snapshot, {
      get(target, key, receiver) {
        if (key === 'root') return probeNode(target.root)

        return Reflect.get(target, key, receiver)
      },
    }),
  )

  return reads
}

const visiblePieceBoundaries = (root: PieceTreeNode | null): number[] => {
  const boundaries = [0]
  const walk = (node: PieceTreeNode | null): void => {
    if (!node) return

    walk(node.left)
    if (node.piece.visible) boundaries.push(boundaries.at(-1)! + node.piece.length)
    walk(node.right)
  }

  walk(root)
  return boundaries
}

// What the model actually looks like in use: one big original piece with a
// scatter of small edits through it.
const buildEditedSourceSnapshot = (): PieceTableSnapshot => {
  let snapshot = createPieceTableSnapshot(
    Array.from({ length: 200 }, (_, row) => `const value${row} = compute(${row})`).join('\n'),
  )

  for (let edit = 0; edit < 20; edit += 1) {
    snapshot = insertIntoPieceTable(snapshot, (edit * 331) % snapshot.length, `x${edit}`)
  }

  return snapshot
}

// Interleaved inserts and deletes leave a tree of many small pieces separated
// by tombstones, which is where a row start derived from one descent is easiest
// to get wrong.
const buildFragmentedSnapshot = (): PieceTableSnapshot => {
  let snapshot = createPieceTableSnapshot('line zero\nline one\nline two\n')

  for (let round = 0; round < 60; round += 1) {
    const at = (round * 13) % (snapshot.length + 1)
    snapshot = insertIntoPieceTable(snapshot, at, round % 4 === 0 ? `\nr${round}` : `r${round}`)

    if (round % 3 === 2) {
      snapshot = deleteFromPieceTable(snapshot, (round * 7) % snapshot.length, 2)
    }
  }

  return snapshot
}

// The same text at a chosen piece count: inserting the slices back to front at
// offset 0 leaves no piece ending where the next insert lands, so nothing
// coalesces and every slice becomes its own node.
const buildChunkedSnapshot = (text: string, chunks: number): PieceTableSnapshot => {
  let snapshot = createPieceTableSnapshot('')

  for (let chunk = chunks - 1; chunk >= 0; chunk -= 1) {
    const start = Math.floor((chunk * text.length) / chunks)
    const end = Math.floor(((chunk + 1) * text.length) / chunks)
    snapshot = insertIntoPieceTable(snapshot, 0, text.slice(start, end))
  }

  return snapshot
}

// Deterministic non-monotonic visit order, so forward, backward and repeated
// queries all land within one run.
const shuffledOffsets = (length: number): number[] => {
  const offsets = Array.from({ length: length + 1 }, (_, offset) => offset)
  let seed = 0x5eed

  for (let at = offsets.length - 1; at > 0; at -= 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const swap = seed % (at + 1)
    ;[offsets[at], offsets[swap]] = [offsets[swap]!, offsets[at]!]
  }

  return offsets
}

const lineStartsOf = (text: string): number[] => {
  const starts = [0]
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\n') starts.push(at + 1)
  }

  return starts
}

const oracleOffsetToPoint = (text: string, offset: number): Point => {
  let row = 0
  let lineStart = 0

  for (let at = 0; at < offset; at += 1) {
    if (text[at] === '\n') {
      row += 1
      lineStart = at + 1
    }
  }

  return { row, column: offset - lineStart }
}

const oraclePointToOffset = (text: string, point: Point): number => {
  const starts = lineStartsOf(text)
  const lastRow = starts.length - 1
  const row = Math.max(0, point.row)
  const column = Math.max(0, point.column)
  const start = row <= lastRow ? starts[row]! : text.length
  const end = row >= lastRow ? text.length : starts[row + 1]! - 1

  return Math.min(start + column, end)
}
