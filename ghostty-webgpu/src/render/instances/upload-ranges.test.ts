import { expect, it } from 'vitest'
import type { InstanceByteRange } from './types.js'
import { planUploadRanges } from './upload-ranges.js'

const empty = { byteOffset: 0, byteLength: 0 }
function range(byteOffset: number, byteLength: number): InstanceByteRange {
  return { byteOffset, byteLength }
}
function update(cell: InstanceByteRange = empty, glyph: InstanceByteRange = empty) {
  return { cell, glyph }
}

it('bounds unordered cell and glyph spans independently', () => {
  expect(
    planUploadRanges([
      update(range(640, 64), range(192, 96)),
      update(range(64, 64), range(960, 96)),
    ]),
  ).toEqual({ cell: [range(64, 640)], glyph: [range(192, 864)] })
})

it('drops empty buffers and retains the first changed byte offset', () => {
  expect(planUploadRanges([update(empty, range(960, 96))])).toEqual({
    cell: [],
    glyph: [range(960, 96)],
  })
  expect(planUploadRanges([])).toEqual({ cell: [], glyph: [] })
  expect(planUploadRanges([update()])).toEqual({ cell: [], glyph: [] })
})

it('handles duplicates, touching ranges and overlaps without duplicate uploads', () => {
  expect(
    planUploadRanges([
      update(range(0, 256)),
      update(range(64, 64)),
      update(range(0, 256)),
      update(range(256, 64)),
    ]),
  ).toEqual({ cell: [range(0, 320)], glyph: [] })
})

it('retains glyph erasure and forced full-frame extents', () => {
  expect(
    planUploadRanges([
      update(range(0, 128), range(0, 192)),
      update(range(128, 128), range(192, 192)),
    ]),
  ).toEqual({ cell: [range(0, 256)], glyph: [range(0, 384)] })
  expect(planUploadRanges([update(empty, range(384, 96))])).toEqual({
    cell: [],
    glyph: [range(384, 96)],
  })
})

it('preserves four-byte granularity without widening alignment', () => {
  expect(
    planUploadRanges([update(range(4, 4), range(12, 4)), update(range(20, 4), range(16, 4))]),
  ).toEqual({ cell: [range(4, 20)], glyph: [range(12, 8)] })
})

it('leaves readonly source ranges and earlier plans untouched', () => {
  const input = Object.freeze([
    Object.freeze(update(Object.freeze(range(64, 64)))),
    Object.freeze(update(Object.freeze(range(64, 0)), Object.freeze(range(96, 0)))),
  ])
  const plan = planUploadRanges(input)
  planUploadRanges([update(range(0, 256))])
  expect(plan).toEqual({ cell: [range(64, 64)], glyph: [] })
  expect(input[0]!.cell).toEqual(range(64, 64))
})
