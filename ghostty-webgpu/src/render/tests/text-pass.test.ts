import { expect, it } from 'vitest'
import type { RowInstanceUpdate } from '../instances/types.js'
import { coalesceFrameRanges, coalesceInstanceUpdates } from '../instances/uploads.js'

function update(row: number): RowInstanceUpdate {
  return {
    cell: { byteLength: 128, byteOffset: row * 128 },
    glyph: { byteLength: 192, byteOffset: row * 192 },
    invalidatedRows: [],
    row,
  }
}

it('coalesces adjacent row uploads without spanning clean gaps', () => {
  expect(coalesceInstanceUpdates([update(0), update(1), update(2), update(4)])).toEqual([
    {
      cell: { byteLength: 384, byteOffset: 0 },
      glyph: { byteLength: 576, byteOffset: 0 },
    },
    {
      cell: { byteLength: 128, byteOffset: 512 },
      glyph: { byteLength: 192, byteOffset: 768 },
    },
  ])
})

it('does not mutate row update ranges while coalescing', () => {
  const updates = [update(0), update(1)]
  coalesceInstanceUpdates(updates)

  expect(updates).toEqual([update(0), update(1)])
})

it('coalesces each stream independently across unordered sparse changes', () => {
  const updates = [update(4), update(1), update(3)]
  updates[0]!.glyph.byteLength = 0
  updates[1]!.cell.byteLength = 0
  const original = structuredClone(updates)
  expect(coalesceFrameRanges(updates, 'cell')).toEqual([{ byteOffset: 384, byteLength: 256 }])
  expect(coalesceFrameRanges(updates, 'glyph')).toEqual([{ byteOffset: 192, byteLength: 576 }])
  expect(coalesceFrameRanges([], 'cell')).toEqual([])
  expect(
    coalesceFrameRanges([{ ...update(10), cell: { byteOffset: 1280, byteLength: 0 } }], 'cell'),
  ).toEqual([])
  expect(updates).toEqual(original)
})

it('keeps far-apart edits changed-only and bounds each merged gap', () => {
  const updates = [update(0), update(1)]
  updates[1]!.cell.byteOffset = 128 + 4096
  expect(coalesceFrameRanges(updates, 'cell')).toEqual([{ byteOffset: 0, byteLength: 4352 }])
  updates[1]!.cell.byteOffset += 4
  expect(coalesceFrameRanges(updates, 'cell')).toEqual([updates[0]!.cell, updates[1]!.cell])
  updates[1]!.glyph.byteOffset = 200 * 100 * 96 - 192
  expect(coalesceFrameRanges(updates, 'glyph')).toEqual([updates[0]!.glyph, updates[1]!.glyph])
})

it('merges overlapping ranges without truncating the longer record', () => {
  const updates = [update(1), update(0)]
  updates[1]!.cell.byteLength = 512
  expect(coalesceFrameRanges(updates, 'cell')).toEqual([{ byteOffset: 0, byteLength: 512 }])
})
