import { formatUsd } from '@/lib/usd'
import { expect, test } from '../../../test/fixtures'

test('a sub-cent amount keeps its digits instead of rounding to zero', () => {
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatUsd(0.004)).toBe('$0.0040')
  expect(formatUsd(0.00042)).toBe('$0.00042')
  expect(formatUsd(3.456)).toBe('$3.46')
  expect(formatUsd(1234.5)).toBe('$1,235')
})
