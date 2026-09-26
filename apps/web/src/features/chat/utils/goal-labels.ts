import type { ProviderSessionGoal, ProviderSessionGoalStatus } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'

const STATUS_LABELS: Record<ProviderSessionGoalStatus, string> = {
  active: 'Working on it',
  paused: 'Paused',
  blocked: 'Blocked',
  'usage-limited': 'Usage limit reached',
  'budget-limited': 'Token budget spent',
  complete: 'Met',
}

export function goalStatusLabel(status: ProviderSessionGoalStatus) {
  return STATUS_LABELS[status]
}

/** Spent against the budget when the goal has one, else what it has spent. */
export function goalTokensLabel(goal: ProviderSessionGoal) {
  if (goal.tokensUsed === null) return null
  const used = formatContextTokens(goal.tokensUsed)
  if (goal.tokenBudget === null) return used
  return `${used} / ${formatContextTokens(goal.tokenBudget)}`
}
