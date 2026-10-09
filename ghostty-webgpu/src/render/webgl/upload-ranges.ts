import type { InstanceByteRange } from '../instances/types.js'
import type { UploadPlan } from '../instances/upload-ranges.js'

type InstanceUpdate = {
  readonly cell: InstanceByteRange
  readonly glyph: InstanceByteRange
}

function rowRanges(
  updates: readonly InstanceUpdate[],
  kind: 'cell' | 'glyph',
  rowBytes: number,
): readonly InstanceByteRange[] {
  const ranges = updates.map((update) => update[kind]).filter((range) => range.byteLength > 0)
  ranges.sort((left, right) => left.byteOffset - right.byteOffset)
  const merged: InstanceByteRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    const end = range.byteOffset + range.byteLength
    if (!previous || range.byteOffset > previous.byteOffset + previous.byteLength) {
      merged.push(range)
      continue
    }
    merged[merged.length - 1] = {
      byteOffset: previous.byteOffset,
      byteLength: Math.max(end, previous.byteOffset + previous.byteLength) - previous.byteOffset,
    }
  }
  if (merged.length < 2) return merged
  const first = merged[0]!
  const last = merged.at(-1)!
  const byteLength = last.byteOffset + last.byteLength - first.byteOffset
  const changedBytes = merged.reduce((total, range) => total + range.byteLength, 0)
  // Fragmented submissions must save at least one physical row of payload.
  if (byteLength - changedBytes < rowBytes) return [{ byteOffset: first.byteOffset, byteLength }]
  return merged
}

export function planRowUploads(
  updates: readonly InstanceUpdate[],
  cellRowBytes: number,
  glyphRowBytes: number,
): UploadPlan {
  return {
    cell: rowRanges(updates, 'cell', cellRowBytes),
    glyph: rowRanges(updates, 'glyph', glyphRowBytes),
  }
}
