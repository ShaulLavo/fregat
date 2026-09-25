import type { ProviderUsageHistory } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import {
  formatUsd,
  pricedModelNames,
  usageDays,
  withModelPrice,
} from '@/features/settings/utils/usage'

function history(overrides: Partial<ProviderUsageHistory>): ProviderUsageHistory {
  return {
    daily: [],
    days: 7,
    models: [],
    purposes: [],
    since: new Date(2026, 8, 19).toISOString(),
    totals: { costUsd: 0, tokens: 0, turns: 0, unpricedTokens: 0 },
    ...overrides,
  }
}

test('every day of the range is present, quiet ones as zero', () => {
  const days = usageDays(history({ daily: [{ costUsd: 1.5, day: '2026-09-21', tokens: 900 }] }))

  expect(days.map((day) => day.day)).toEqual([
    '2026-09-19',
    '2026-09-20',
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
  ])
  expect(days[2]).toEqual({ costUsd: 1.5, day: '2026-09-21', tokens: 900 })
  expect(days[0]?.tokens).toBe(0)
})

test('a sub-cent amount says so instead of rounding to zero', () => {
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatUsd(0.004)).toBe('<$0.01')
  expect(formatUsd(3.456)).toBe('$3.46')
  expect(formatUsd(1234.5)).toBe('$1,235')
})

test('the price editor offers unpriced models and keeps priced ones past their range', () => {
  const row = {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    driverKind: 'codex',
    inputTokens: 1,
    outputTokens: 1,
    reasoningTokens: 0,
    turns: 1,
  }
  const names = pricedModelNames(
    history({
      models: [
        { ...row, costSource: 'none', costUsd: null, model: 'gpt-5.5' },
        { ...row, costSource: 'provider', costUsd: 1, driverKind: 'claude', model: 'claude' },
      ],
    }),
    { 'gpt-4.1': { cachedInput: 0, input: 1, output: 1 } },
  )

  expect(names).toEqual(['gpt-4.1', 'gpt-5.5'])
})

test('setting and clearing one price leaves the others alone', () => {
  const price = { cachedInput: 0.5, input: 2, output: 10 }
  const both = withModelPrice({ a: price }, 'b', price)

  expect(both).toEqual({ a: price, b: price })
  expect(withModelPrice(both, 'a', null)).toEqual({ b: price })
})
