import type { ProviderUsageHistory } from '@workspace/contracts'

import { expect, test } from '../../../../../test/fixtures'
import { usageCostArithmetic, usageDays, visibleUsageDay } from '@/features/settings/utils/usage'

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
  const day = { costUsd: 1.5, day: '2026-09-21', models: [], tokens: 900, unpricedTokens: 0 }
  const days = usageDays(history({ daily: [day] }))

  expect(days.map((day) => day.day)).toEqual([
    '2026-09-19',
    '2026-09-20',
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
  ])
  expect(days[2]).toEqual(day)
  expect(days[0]?.tokens).toBe(0)
})

test('a day without the hidden models recounts its cost and unpriced tokens', () => {
  const day = {
    costUsd: 2,
    day: '2026-09-21',
    models: [
      { costUsd: 2, driverKind: 'claude', model: 'opus', tokens: 900 },
      { costUsd: null, driverKind: 'codex', model: 'mystery', tokens: 400 },
    ],
    tokens: 1300,
    unpricedTokens: 400,
  }

  expect(visibleUsageDay(day, new Set(['claude:opus']))).toMatchObject({
    costUsd: null,
    tokens: 400,
    unpricedTokens: 400,
  })
  expect(visibleUsageDay(day, new Set(['codex:mystery']))).toMatchObject({
    costUsd: 2,
    tokens: 900,
    unpricedTokens: 0,
  })
})

test('a catalog-priced row spells out quantity times rate', () => {
  const row = {
    cacheReadTokens: 400_000,
    cacheWriteTokens: 0,
    costSource: 'catalog' as const,
    costUsd: 3.45,
    driverKind: 'codex',
    inputTokens: 1_200_000,
    model: 'gpt-5.5',
    outputTokens: 90_000,
    rates: { cacheRead: 0.125, cacheWrite: null, input: 1.25, output: 10 },
    reasoningTokens: 0,
    turns: 3,
  }

  expect(usageCostArithmetic(row)).toBe(
    '1.2M in × $1.25 + 400k cached × $0.125 + 90k out × $10 per 1M',
  )
  expect(usageCostArithmetic({ ...row, costSource: 'provider', rates: null })).toBe(
    "Claude's estimate",
  )
})
