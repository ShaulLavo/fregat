import { expect, test } from '../../../../test/fixtures'
import { parseCsv } from '@/features/workbench/utils/csv'
import { nextCsvPosition } from '@/features/workbench/utils/csv-navigation'

test('keyboard destinations follow source rows, including ragged and final records', () => {
  const parsed = parseCsv('a,b\nc\nd,e')
  expect(parsed.kind).toBe('table')
  if (parsed.kind !== 'table') return
  const rows = parsed.table.rows
  expect(nextCsvPosition(rows, { row: 0, column: 1 }, 'next')).toEqual({ row: 1, column: 0 })
  expect(nextCsvPosition(rows, { row: 1, column: 0 }, 'previous')).toEqual({ row: 0, column: 1 })
  expect(nextCsvPosition(rows, { row: 0, column: 1 }, 'down')).toEqual({ row: 1, column: 0 })
  expect(nextCsvPosition(rows, { row: 0, column: 0 }, 'last')).toEqual({ row: 2, column: 0 })
  expect(nextCsvPosition(rows, { row: 2, column: 1 }, 'first')).toEqual({ row: 0, column: 1 })
  expect(nextCsvPosition(rows, { row: 2, column: 1 }, 'next')).toEqual({ row: 2, column: 1 })
  expect(nextCsvPosition(rows, { row: 0, column: 0 }, 'previous')).toEqual({ row: 0, column: 0 })
})
