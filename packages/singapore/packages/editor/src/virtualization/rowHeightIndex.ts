// Retained for variable-height rows; nothing in production feeds non-uniform sizes today.

export type RowHeightIndex = {
  readonly rowSizes: readonly number[]
  readonly rowStarts: readonly number[]
  readonly rowGap: number
  readonly totalSize: number
}

export function createRowHeightIndex(rowSizes: readonly number[], rowGap: number): RowHeightIndex {
  const rowStarts = Array.from({ length: rowSizes.length + 1 }, () => 0)
  return sumRowStartsFrom(rowStarts, rowSizes, rowGap, 0)
}

/**
 * A row resolving to a new measured height rewrites one entry of an otherwise identical size array,
 * and every offset before that row keeps its value, so only the tail is summed again. Finding that
 * row still compares every row ahead of it: what a late change saves is the offset writes and a
 * second array, not the traversal. Sparing the traversal too would need the caller to say which row
 * it dirtied, and none of them knows.
 *
 * The result takes over the offset storage of `previous`, which must not be read afterwards.
 */
export function updateRowHeightIndex(
  previous: RowHeightIndex,
  rowSizes: readonly number[],
  rowGap: number,
): RowHeightIndex {
  // Every offset past the first row carries the gap, so a gap change retires the whole array even
  // where not one row height moved.
  if (rowGap !== previous.rowGap || rowSizes.length !== previous.rowSizes.length) {
    return createRowHeightIndex(rowSizes, rowGap)
  }

  // Handing back the same object, rather than an equal one, is what lets a caller settle an
  // unchanged pass by reference instead of comparing the sizes over again.
  const changedRow = firstChangedRow(previous.rowSizes, rowSizes)
  if (changedRow === rowSizes.length) return previous

  return sumRowStartsFrom(previous.rowStarts as number[], rowSizes, rowGap, changedRow)
}

function sumRowStartsFrom(
  rowStarts: number[],
  rowSizes: readonly number[],
  rowGap: number,
  fromRow: number,
): RowHeightIndex {
  let offset = rowStarts[fromRow] ?? 0

  for (let row = fromRow; row < rowSizes.length; row += 1) {
    offset += rowSizes[row] ?? 0
    if (row < rowSizes.length - 1) offset += rowGap
    rowStarts[row + 1] = offset
  }

  return { rowSizes, rowStarts, rowGap, totalSize: offset }
}

function firstChangedRow(previous: readonly number[], next: readonly number[]): number {
  for (let row = 0; row < next.length; row += 1) {
    if (previous[row] !== next[row]) return row
  }

  return next.length
}

export function rowHeightIndexStart(index: RowHeightIndex, row: number): number {
  return index.rowStarts[clampRowBoundary(row, index.rowSizes.length)] ?? index.totalSize
}

export function rowHeightIndexRowAtOffset(index: RowHeightIndex, offset: number): number {
  const count = index.rowSizes.length
  if (count === 0) return 0

  const normalizedOffset = normalizeOffset(offset)
  if (normalizedOffset >= index.totalSize) return count - 1

  const { rowStarts } = index
  const row = clampRow(
    upperBound(rowStarts.length, (boundary) => rowStarts[boundary] ?? 0, normalizedOffset) - 1,
    count,
  )
  const rowEnd = rowHeightIndexStart(index, row) + (index.rowSizes[row] ?? 0)
  if (normalizedOffset < rowEnd) return row

  return Math.min(row + 1, count - 1)
}

export function rowHeightIndexRowAfterOffset(index: RowHeightIndex, offset: number): number {
  const count = index.rowSizes.length
  if (count === 0) return 0

  const { rowStarts } = index
  return Math.min(
    lowerBound(rowStarts.length, (boundary) => rowStarts[boundary] ?? 0, normalizeOffset(offset)),
    count,
  )
}

/**
 * Both bounds read a value by position rather than take the array, so a list sorted on one field of
 * its records is searched where it lies instead of being copied into a scratch array of that field
 * ahead of every search. `length` doubles as the ceiling, which is how a second search stays inside
 * what a first one already narrowed.
 */
export function lowerBound(
  length: number,
  valueAt: (index: number) => number,
  target: number,
): number {
  let low = 0
  let high = length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (valueAt(middle) >= target) {
      high = middle
      continue
    }

    low = middle + 1
  }

  return low
}

export function upperBound(
  length: number,
  valueAt: (index: number) => number,
  target: number,
): number {
  let low = 0
  let high = length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (valueAt(middle) > target) {
      high = middle
      continue
    }

    low = middle + 1
  }

  return low
}

function clampRow(row: number, count: number): number {
  if (!Number.isFinite(row) || row <= 0) return 0
  if (row >= count) return count - 1
  return Math.floor(row)
}

function clampRowBoundary(row: number, count: number): number {
  if (!Number.isFinite(row) || row <= 0) return 0
  if (row >= count) return count
  return Math.floor(row)
}

function normalizeOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset <= 0) return 0
  return offset
}
