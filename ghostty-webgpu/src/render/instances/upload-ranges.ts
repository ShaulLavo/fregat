import type { InstanceByteRange } from './types.js'

export interface UploadPlan {
  readonly cell: readonly InstanceByteRange[]
  readonly glyph: readonly InstanceByteRange[]
}

type InstanceUpdate = {
  readonly cell: InstanceByteRange
  readonly glyph: InstanceByteRange
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

export function planUploadRanges(updates: readonly InstanceUpdate[]): UploadPlan {
  return { cell: mergedRanges(updates, 'cell'), glyph: mergedRanges(updates, 'glyph') }
}
