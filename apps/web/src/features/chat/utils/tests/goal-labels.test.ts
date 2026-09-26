import type { ProviderSessionGoal } from '@workspace/contracts'

import { goalStatusLabel, goalTokensLabel } from '@/features/chat/utils/goal-labels'
import { expect, test } from '../../../../../test/fixtures'

const goal: ProviderSessionGoal = {
  objective: 'Ship',
  status: 'budget-limited',
  tokenBudget: 50_000,
  tokensUsed: 12_400,
  timeUsedSeconds: 95,
  iterations: null,
  lastReason: null,
}

test('a goal reads its spend against the budget, or alone without one', () => {
  expect(goalTokensLabel(goal)).toBe('12.4k / 50k')
  expect(goalTokensLabel({ ...goal, tokenBudget: null })).toBe('12.4k')
  expect(goalTokensLabel({ ...goal, tokensUsed: null })).toBeNull()
  expect(goalStatusLabel(goal.status)).toBe('Token budget spent')
})
