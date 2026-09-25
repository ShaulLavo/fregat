import { describe, expect, it } from 'vitest'
import { codexUsageTotals, usageDelta, type ProviderUsageAmounts } from '../utils/usage-totals'

const ZERO: ProviderUsageAmounts = {
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
}

describe('usageDelta', () => {
  it('subtracts the baseline and returns null when nothing was added', () => {
    const baseline = { ...ZERO, costUsd: 1, inputTokens: 100 }

    expect(usageDelta({ ...baseline, costUsd: 1.5, inputTokens: 130 }, baseline)).toEqual({
      ...ZERO,
      costUsd: 0.5,
      inputTokens: 30,
    })
    expect(usageDelta(baseline, baseline)).toBeNull()
  })

  it('counts a reading below its baseline as a restart', () => {
    expect(usageDelta({ ...ZERO, outputTokens: 5 }, { ...ZERO, outputTokens: 50 })).toEqual({
      ...ZERO,
      outputTokens: 5,
    })
  })
})

it('splits Codex cached input out of its input count', () => {
  expect(
    codexUsageTotals('conversation-codex', 'gpt-5.5', false, {
      cachedInputTokens: 60,
      inputTokens: 100,
      outputTokens: 30,
      reasoningOutputTokens: 12,
      totalTokens: 130,
    }),
  ).toMatchObject({ cacheReadTokens: 60, costUsd: null, inputTokens: 40, reasoningTokens: 12 })
})
