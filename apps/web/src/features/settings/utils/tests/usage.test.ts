import type { ProviderUsageHistory } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import { usageDays } from '@/features/settings/utils/usage'

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
