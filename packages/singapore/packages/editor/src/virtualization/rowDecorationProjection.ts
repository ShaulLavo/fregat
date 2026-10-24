import type { TextEditBatch } from '../textEditBatch'
import type { VirtualizedTextRowDecoration } from './virtualizedTextViewTypes'

export function projectRowDecorationMapThroughEdits(
  source: ReadonlyMap<number, VirtualizedTextRowDecoration>,
  batch: TextEditBatch,
): ReadonlyMap<number, VirtualizedTextRowDecoration> {
  const changes = batch.changes.filter((change) => change.lineDelta !== 0)
  if (changes.length === 0) return source

  const projected = new Map<number, VirtualizedTextRowDecoration>()
  for (const [row, decoration] of source) {
    const nextRow = projectDecorationRow(row, changes)
    if (nextRow !== null) projected.set(nextRow, decoration)
  }
  return projected
}

function projectDecorationRow(row: number, changes: TextEditBatch['changes']): number | null {
  let low = 0
  let high = changes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (changes[middle]!.startRow < row) {
      low = middle + 1
      continue
    }
    high = middle
  }
  const change = changes[low - 1]
  if (!change) return row
  if (row <= change.endRow) return null
  return Math.max(0, row + change.afterEndRow - change.endRow)
}
