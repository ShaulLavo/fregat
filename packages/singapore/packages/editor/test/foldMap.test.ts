import { describe, expect, it } from 'vitest'

import {
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  offsetToPoint,
  resolveAnchor,
} from '../src/public/document'
import {
  bufferPointToFoldPoint,
  createFoldMap,
  foldPointToBufferPoint,
  updateFoldMapForEdit,
} from '../src/foldMap'
import type { FoldRange } from '../src/syntax'

describe('FoldMap', () => {
  it('converts syntax folds into anchor-backed ranges', () => {
    const snapshot = createPieceTableSnapshot('function f() {\n  return 1;\n}\n')
    const map = createFoldMap(snapshot, [fold(0, 27, 0, 2, 'function_declaration')])
    const range = map.ranges[0]!

    expect(resolveAnchor(snapshot, range.start)).toEqual({ offset: 0, liveness: 'live' })
    expect(resolveAnchor(snapshot, range.end)).toEqual({ offset: 27, liveness: 'live' })
    expect(range.startPoint).toEqual({ row: 0, column: 0 })
    expect(range.endPoint).toEqual({ row: 2, column: 0 })
  })

  it('round-trips points outside folded interiors', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(3, 5, 1, 2, 'block')])
    const folded = bufferPointToFoldPoint(map, { row: 3, column: 0 })

    expect(folded).toEqual({ row: 2, column: 0 })
    expect(foldPointToBufferPoint(map, folded)).toEqual({ row: 3, column: 0 })
  })

  it('round-trips every visible buffer point through FoldPoint', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\ne\n')
    const map = createFoldMap(snapshot, [
      fold(2, 6, 1, 3, 'block'),
      fold(8, 9, 4, 4, 'single_line'),
    ])
    const points = [
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 4, column: 0 },
      offsetToPoint(snapshot, snapshot.length),
    ]

    for (const point of points) {
      const folded = bufferPointToFoldPoint(map, point)
      expect(foldPointToBufferPoint(map, folded)).toEqual(point)
    }
  })

  it('uses the outer range for nested folds', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\ne\n')
    const map = createFoldMap(snapshot, [fold(0, 8, 0, 4, 'outer'), fold(2, 6, 1, 3, 'inner')])

    expect(map.ranges).toHaveLength(1)
    expect(map.ranges[0]!.type).toBe('outer')
    expect(bufferPointToFoldPoint(map, { row: 4, column: 0 })).toEqual({ row: 0, column: 0 })
  })

  it('supports folds at document edges', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\n')
    const map = createFoldMap(snapshot, [fold(0, snapshot.length, 0, 3, 'document')])

    expect(map.ranges).toHaveLength(1)
    expect(bufferPointToFoldPoint(map, { row: 3, column: 0 })).toEqual({ row: 0, column: 0 })
    expect(foldPointToBufferPoint(map, bufferPointToFoldPoint(map, { row: 0, column: 0 }))).toEqual(
      {
        row: 0,
        column: 0,
      },
    )
  })

  it('resolves fold anchors against later snapshots', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\n')
    const map = createFoldMap(snapshot, [fold(3, 5, 1, 2, 'block')])
    const edited = deleteFromPieceTable(snapshot, 2, 2)
    const range = map.ranges[0]!

    expect(resolveAnchor(edited, range.start).liveness).toBe('deleted')
    expect(resolveAnchor(edited, range.end).offset).toBeGreaterThanOrEqual(2)
  })

  it('emits no output invalidation for edits inside a folded interior', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(2, 6, 1, 3, 'block')])
    const edit = { from: 3, to: 3, text: 'hidden\n' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const update = updateFoldMapForEdit(map, edit, nextSnapshot)

    expect(update.invalidations).toEqual([])
    expect(update.map.ranges[0]!.endPoint.row).toBe(4)
    expect(bufferPointToFoldPoint(update.map, { row: 5, column: 0 })).toEqual({
      row: 2,
      column: 0,
    })
  })

  it('invalidates only the placeholder when a fold boundary edit survives', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(2, 6, 1, 3, 'block')])
    const edit = { from: 2, to: 2, text: 'x' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const update = updateFoldMapForEdit(map, edit, nextSnapshot)

    expect(update.invalidations).toEqual([
      {
        start: { row: 1, column: 0 },
        end: { row: 2, column: 0 },
        lineCountDelta: 0,
        reason: 'fold-placeholder',
      },
    ])
  })

  it('expands invalidation when a boundary edit destroys the fold', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(2, 6, 1, 3, 'block')])
    const edit = { from: 6, to: 7, text: '' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const update = updateFoldMapForEdit(map, edit, nextSnapshot)

    expect(update.map.ranges).toHaveLength(0)
    expect(update.invalidations).toEqual([
      {
        start: { row: 1, column: 0 },
        end: { row: 2, column: 0 },
        lineCountDelta: 2,
        reason: 'fold-expanded',
      },
    ])
  })

  it('accounts for replacement line deltas when destroyed folds expand', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(2, 6, 1, 3, 'block')])
    const edit = { from: 2, to: 6, text: 'x' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const update = updateFoldMapForEdit(map, edit, nextSnapshot)

    expect(update.invalidations[0]!.lineCountDelta).toBe(0)
  })

  it('passes outside edits through in FoldPoint space', () => {
    const snapshot = createPieceTableSnapshot('a\nb\nc\nd\n')
    const map = createFoldMap(snapshot, [fold(4, 6, 2, 3, 'block')])
    const edit = { from: 0, to: 0, text: 'top\n' }
    const nextSnapshot = applyBatchToPieceTable(snapshot, [edit])
    const update = updateFoldMapForEdit(map, edit, nextSnapshot)

    expect(update.invalidations).toEqual([
      {
        start: { row: 0, column: 0 },
        end: { row: 0, column: 0 },
        lineCountDelta: 1,
        reason: 'external-edit',
      },
    ])
    expect(update.map.ranges[0]!.startPoint.row).toBe(3)
  })
})

function fold(
  startIndex: number,
  endIndex: number,
  startLine: number,
  endLine: number,
  type: string,
): FoldRange {
  return { startIndex, endIndex, startLine, endLine, type, languageId: 'typescript' }
}
