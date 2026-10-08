import type { InstanceByteRange } from './types.js'

export interface UploadPlan {
  readonly cell: readonly InstanceByteRange[]
  readonly glyph: readonly InstanceByteRange[]
}

type InstanceUpdate = {
  readonly cell: InstanceByteRange
  readonly glyph: InstanceByteRange
}

function boundingRange(updates: readonly InstanceUpdate[], kind: 'cell' | 'glyph') {
  let start = Infinity
  let end = 0
  for (const update of updates) {
    const range = update[kind]
    if (range.byteLength === 0) continue
    start = Math.min(start, range.byteOffset)
    end = Math.max(end, range.byteOffset + range.byteLength)
  }
  if (start === Infinity) return []
  return [{ byteOffset: start, byteLength: end - start }]
}

export function planUploadRanges(updates: readonly InstanceUpdate[]): UploadPlan {
  return { cell: boundingRange(updates, 'cell'), glyph: boundingRange(updates, 'glyph') }
}

function mergedRanges(updates: readonly InstanceUpdate[], kind: 'cell' | 'glyph') {
  const ranges = updates.map((update) => update[kind]).filter((range) => range.byteLength > 0)
  ranges.sort((left, right) => left.byteOffset - right.byteOffset)
  const result: InstanceByteRange[] = []
  for (const range of ranges) {
    const previous = result.at(-1)
    const end = range.byteOffset + range.byteLength
    if (!previous || range.byteOffset > previous.byteOffset + previous.byteLength) {
      result.push(range)
      continue
    }
    result[result.length - 1] = {
      byteOffset: previous.byteOffset,
      byteLength: Math.max(end, previous.byteOffset + previous.byteLength) - previous.byteOffset,
    }
  }
  return result
}

export function planSparseUploadRanges(updates: readonly InstanceUpdate[]): UploadPlan {
  return { cell: mergedRanges(updates, 'cell'), glyph: mergedRanges(updates, 'glyph') }
}
