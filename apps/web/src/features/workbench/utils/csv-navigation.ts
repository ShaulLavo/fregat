import type { CsvCell } from '@/features/workbench/utils/csv'

export type CsvPosition = { readonly row: number; readonly column: number }
export type CsvMove = 'next' | 'previous' | 'left' | 'right' | 'up' | 'down' | 'first' | 'last'

export function nextCsvPosition(
  rows: readonly (readonly CsvCell[])[],
  from: CsvPosition,
  move: CsvMove,
): CsvPosition {
  const cells = rows[from.row]
  if (!cells) return from
  let { row, column } = from
  if (move === 'first') row = 0
  if (move === 'last') row = rows.length - 1
  if (move === 'up') row--
  if (move === 'down') row++
  if (move === 'left' || move === 'previous') column--
  if (move === 'right' || move === 'next') column++
  if (move === 'next' && column >= cells.length && row + 1 < rows.length) {
    row++
    column = 0
  }
  if (move === 'previous' && column < 0 && row > 0) {
    row--
    column = rows[row]!.length - 1
  }
  row = Math.max(0, Math.min(rows.length - 1, row))
  column = Math.max(0, Math.min(rows[row]!.length - 1, column))
  return { row, column }
}
