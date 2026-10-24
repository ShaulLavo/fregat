import type { TextSnapshot } from './documentTextSnapshot'
import type { TextEdit } from './tokens'

export type TextEditBatchChange = {
  readonly from: number
  readonly to: number
  readonly afterFrom: number
  readonly afterTo: number
  readonly startRow: number
  readonly endRow: number
  readonly afterStartRow: number
  readonly afterEndRow: number
  readonly offsetDelta: number
  readonly lineDelta: number
}

export type TextEditBatch = {
  readonly before: TextSnapshot
  readonly after: TextSnapshot
  readonly edits: readonly TextEdit[]
  readonly changes: readonly TextEditBatchChange[]
}

export function createTextEditBatch(
  before: TextSnapshot,
  after: TextSnapshot,
  edits: readonly TextEdit[],
): TextEditBatch {
  const ordered = edits.toSorted((left, right) => left.from - right.from || left.to - right.to)
  const changes: TextEditBatchChange[] = []
  let delta = 0
  let index = 0
  while (index < ordered.length) {
    const first = ordered[index]!
    let to = first.to
    let insertedLength = 0
    while (ordered[index]?.from === first.from) {
      const edit = ordered[index]!
      to = Math.max(to, edit.to)
      insertedLength += edit.text.length
      index += 1
    }

    const change = createBatchChange(before, after, first.from, to, insertedLength, delta)
    changes.push(change)
    delta += change.offsetDelta
  }
  return { before, after, edits: ordered, changes }
}

export function mapTextEditBatchOffset(
  batch: TextEditBatch,
  offset: number,
  affinity: 'before' | 'after',
): number {
  const index = firstBatchChangeEndingAtOrAfter(batch, offset)
  const change = batch.changes[index]
  if (!change) return offset + batch.after.length - batch.before.length
  if (offset < change.from) return offset + change.afterFrom - change.from
  if (affinity === 'before') return change.afterFrom
  const next = batch.changes[index + 1]
  if (next?.from === offset) return next.afterTo
  return change.afterTo
}

export function firstBatchChangeEndingAtOrAfter(batch: TextEditBatch, offset: number): number {
  let low = 0
  let high = batch.changes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (batch.changes[middle]!.to >= offset) {
      high = middle
      continue
    }
    low = middle + 1
  }
  return low
}

function createBatchChange(
  before: TextSnapshot,
  after: TextSnapshot,
  from: number,
  to: number,
  insertedLength: number,
  delta: number,
): TextEditBatchChange {
  const afterFrom = from + delta
  const afterTo = afterFrom + insertedLength
  const startRow = before.lineAt(from)
  const endRow = before.lineAt(to)
  const afterStartRow = after.lineAt(afterFrom)
  const afterEndRow = after.lineAt(afterTo)
  return {
    from,
    to,
    afterFrom,
    afterTo,
    startRow,
    endRow,
    afterStartRow,
    afterEndRow,
    offsetDelta: insertedLength - (to - from),
    lineDelta: afterEndRow - afterStartRow - (endRow - startRow),
  }
}
