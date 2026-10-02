import type { InstanceByteRange, RowInstanceUpdate } from './types.js'

const maxFrameUploadGapBytes = 4096

export interface InstanceUploadBatch {
  readonly cell: InstanceByteRange
  readonly glyph: InstanceByteRange
}

export function coalesceFrameRanges(
  updates: readonly RowInstanceUpdate[],
  kind: 'cell' | 'glyph',
): readonly InstanceByteRange[] {
  const ranges = updates
    .map((update) => update[kind])
    .filter((range) => range.byteLength > 0)
    .sort((left, right) => left.byteOffset - right.byteOffset)
  const batches: InstanceByteRange[] = []
  for (const range of ranges) {
    const previous = batches.at(-1)
    const end = range.byteOffset + range.byteLength
    // Bound extra copying: widely separated edits retain their changed-only uploads.
    if (
      !previous ||
      range.byteOffset > previous.byteOffset + previous.byteLength + maxFrameUploadGapBytes
    ) {
      batches.push(copiedRange(range))
      continue
    }
    previous.byteLength = Math.max(previous.byteLength, end - previous.byteOffset)
  }
  return batches
}

function copiedRange(range: InstanceByteRange): InstanceByteRange {
  return { byteLength: range.byteLength, byteOffset: range.byteOffset }
}

function copiedBatch(update: RowInstanceUpdate): InstanceUploadBatch {
  return { cell: copiedRange(update.cell), glyph: copiedRange(update.glyph) }
}

function rangesAreAdjacent(left: InstanceByteRange, right: InstanceByteRange): boolean {
  return left.byteOffset + left.byteLength === right.byteOffset
}

function batchesAreAdjacent(batch: InstanceUploadBatch, update: RowInstanceUpdate): boolean {
  return rangesAreAdjacent(batch.cell, update.cell) && rangesAreAdjacent(batch.glyph, update.glyph)
}

function extendBatch(batch: InstanceUploadBatch, update: RowInstanceUpdate): void {
  batch.cell.byteLength += update.cell.byteLength
  batch.glyph.byteLength += update.glyph.byteLength
}

export function coalesceInstanceUpdates(
  updates: readonly RowInstanceUpdate[],
): readonly InstanceUploadBatch[] {
  const batches: InstanceUploadBatch[] = []
  for (const update of updates) {
    const previous = batches.at(-1)
    if (!previous || !batchesAreAdjacent(previous, update)) {
      batches.push(copiedBatch(update))
      continue
    }
    extendBatch(previous, update)
  }
  return batches
}
