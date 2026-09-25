import { estimateUsageCost, type RecordedModelPrice } from './model-prices'
import {
  usageAmounts,
  usageBaseline,
  usageDelta,
  type ProviderUsageAmounts,
  type ProviderUsageTotals,
} from './usage-totals'

/** A contiguous portion of one conversation attributed to this turn and model. */
export type UsageContribution = {
  scope: string
  before: ProviderUsageAmounts | null
  after: ProviderUsageAmounts
}

export function updateUsageContributions(
  contributions: readonly UsageContribution[],
  totals: ProviderUsageTotals,
  baseline: ProviderUsageAmounts | null,
): UsageContribution[] {
  const before = usageBaseline(totals, baseline)
  const after = usageAmounts(totals)
  const index = contributions.findLastIndex(
    (item) =>
      item.scope === totals.scope &&
      before !== null &&
      before.costUsd === item.after.costUsd &&
      (item.after.costUsd === null || after.costUsd !== null) &&
      usageDelta(before, item.after) === null,
  )
  if (index < 0) return [...contributions, { scope: totals.scope, before, after }]
  return contributions.map((item, position) => (position === index ? { ...item, after } : item))
}

/** A cumulative cost cannot price this interval if its starting cost was unknown. */
function reportedCost({ before, after }: UsageContribution) {
  if (after.costUsd === null || before?.costUsd === null) return null
  return Math.max(0, after.costUsd - (before?.costUsd ?? 0))
}

export function needsUsagePrice(contributions: readonly UsageContribution[]) {
  return contributions.some((item) => reportedCost(item) === null)
}

export function contributionCost(
  contributions: readonly UsageContribution[],
  price: RecordedModelPrice | null,
): number | null {
  let total = 0
  for (const contribution of contributions) {
    const reported = reportedCost(contribution)
    const usage = usageDelta(contribution.after, contribution.before)
    const estimate = usage && price ? estimateUsageCost(usage, price) : null
    const cost = reported ?? estimate
    if (cost === null) return null
    total += cost
  }
  return total
}
