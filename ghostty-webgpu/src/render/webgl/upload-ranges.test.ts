import { describe, expect, it } from 'vitest'
import { planRowUploads } from './upload-ranges.js'

const empty = { byteOffset: 0, byteLength: 0 }

function cells(...ranges: readonly [number, number][]) {
  return ranges.map(([byteOffset, byteLength]) => ({
    cell: { byteOffset, byteLength },
    glyph: empty,
  }))
}

describe('physical-row WebGL uploads', () => {
  it('coalesces fragmentation that saves less than a cell row', () => {
    expect(planRowUploads(cells([0, 640], [704, 576], [1344, 576]), 640, 960).cell).toEqual([
      { byteOffset: 0, byteLength: 1920 },
    ])
  })

  it('keeps sparse ranges when they save a whole row', () => {
    expect(planRowUploads(cells([0, 64], [704, 64]), 640, 960).cell).toEqual([
      { byteOffset: 0, byteLength: 64 },
      { byteOffset: 704, byteLength: 64 },
    ])
  })

  it('applies glyph-row savings independently and preserves ring wrap gaps', () => {
    const updates = [
      {
        cell: { byteOffset: 64, byteLength: 64 },
        glyph: { byteOffset: 96, byteLength: 96 },
      },
      {
        cell: { byteOffset: 3200, byteLength: 64 },
        glyph: { byteOffset: 4800, byteLength: 96 },
      },
    ]
    expect(planRowUploads(updates, 640, 960)).toEqual({
      cell: updates.map((update) => update.cell),
      glyph: updates.map((update) => update.glyph),
    })
  })

  it('keeps empty and contiguous updates as zero or one upload', () => {
    expect(planRowUploads([], 640, 960)).toEqual({ cell: [], glyph: [] })
    expect(planRowUploads(cells([0, 64], [64, 64]), 640, 960).cell).toEqual([
      { byteOffset: 0, byteLength: 128 },
    ])
  })
})
