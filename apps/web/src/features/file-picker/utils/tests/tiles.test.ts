import { expect, test } from '../../../../../test/fixtures'

import { tileColumns, tileRows } from '@/features/file-picker/utils/tiles'

test('as many tiles fit across as the width allows, and never fewer than one', () => {
  expect(tileColumns(null)).toBe(1)
  expect(tileColumns(50)).toBe(1)
  expect(tileColumns(600)).toBe(5)
})

test('rows fill left to right and the last one may be short', () => {
  expect(tileRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
})
