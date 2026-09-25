import type { ModelUsage } from '@anthropic-ai/claude-agent-sdk'
import type { CodexTokenUsageBreakdown } from '../adapters/codex-protocol'

/**
 * Running totals for one model inside one provider conversation (`scope`): a Claude
 * `query()` between `/clear`s, a Codex thread. Totals only grow within a scope, so a
 * turn's usage is the difference from the last totals recorded for it.
 *
 * `inputTokens` excludes cache reads and writes; `outputTokens` includes reasoning,
 * which `reasoningTokens` repeats so a reader can split it out.
 */
export type ProviderUsageTotals = {
  scope: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  /** The provider's own estimate; null when it reports none (Codex). */
  costUsd: number | null
  /**
   * The scope was resumed, so its totals may already hold turns from before this
   * runtime. Without a recorded baseline those cannot be told apart from this turn.
   */
  continuesEarlierTurns: boolean
}

export type ProviderUsageAmounts = Omit<
  ProviderUsageTotals,
  'continuesEarlierTurns' | 'model' | 'scope'
>

const COUNT_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
] as const

/**
 * `modelUsage` covers subagents and auxiliary calls too, unlike the result's `usage`,
 * and carries the CLI's own cost estimate. `thinkingTokens` is already in the output.
 */
export function claudeUsageTotals(
  scope: string,
  continuesEarlierTurns: boolean,
  modelUsage: Readonly<Record<string, ModelUsage>>,
): ProviderUsageTotals[] {
  return Object.entries(modelUsage).map(([model, usage]) => ({
    cacheReadTokens: count(usage.cacheReadInputTokens),
    continuesEarlierTurns,
    cacheWriteTokens: count(usage.cacheCreationInputTokens),
    costUsd: Number.isFinite(usage.costUSD) ? Math.max(0, usage.costUSD) : null,
    inputTokens: count(usage.inputTokens),
    model: usage.canonicalModel?.trim() || model,
    outputTokens: count(usage.outputTokens),
    reasoningTokens: count(usage.thinkingTokens),
    scope,
  }))
}

/** Codex counts cached input inside `inputTokens` and reasoning inside `outputTokens`. */
export function codexUsageTotals(
  scope: string,
  model: string,
  continuesEarlierTurns: boolean,
  total: CodexTokenUsageBreakdown,
): ProviderUsageTotals {
  const cacheReadTokens = count(total.cachedInputTokens)

  return {
    cacheReadTokens,
    continuesEarlierTurns,
    cacheWriteTokens: 0,
    costUsd: null,
    inputTokens: Math.max(0, count(total.inputTokens) - cacheReadTokens),
    model,
    outputTokens: count(total.outputTokens),
    reasoningTokens: count(total.reasoningOutputTokens),
    scope,
  }
}

/**
 * What a turn added. A total below its baseline means the scope restarted (a resume
 * with nothing saved, or a counter reset), so the whole reading is new usage.
 * Returns null when nothing was added.
 */
export function usageDelta(
  current: ProviderUsageAmounts,
  baseline: ProviderUsageAmounts | null,
): ProviderUsageAmounts | null {
  const from = usageBaseline(current, baseline)
  const delta: ProviderUsageAmounts = {
    cacheReadTokens: current.cacheReadTokens - (from?.cacheReadTokens ?? 0),
    cacheWriteTokens: current.cacheWriteTokens - (from?.cacheWriteTokens ?? 0),
    costUsd: costDelta(current.costUsd, from?.costUsd ?? null),
    inputTokens: current.inputTokens - (from?.inputTokens ?? 0),
    outputTokens: current.outputTokens - (from?.outputTokens ?? 0),
    reasoningTokens: current.reasoningTokens - (from?.reasoningTokens ?? 0),
  }
  // A late zero-dollar report still replaces an earlier catalog estimate.
  if (isEmptyUsage(delta) && (current.costUsd === null || current.costUsd === from?.costUsd))
    return null

  return delta
}

export function usageBaseline(
  current: ProviderUsageAmounts,
  baseline: ProviderUsageAmounts | null,
) {
  if (!baseline || COUNT_FIELDS.some((field) => current[field] < baseline[field])) return null
  return baseline
}

export function usageAmounts(totals: ProviderUsageAmounts): ProviderUsageAmounts {
  return {
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    costUsd: totals.costUsd,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
  }
}

/** A crashed or unstarted query reports all zeros; it is no reading, not a reset. */
export function isEmptyUsage(amounts: ProviderUsageAmounts) {
  return COUNT_FIELDS.every((field) => amounts[field] === 0) && !amounts.costUsd
}

function costDelta(current: number | null, baseline: number | null) {
  if (current === null) return null

  return Math.max(0, current - (baseline ?? 0))
}

function count(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0

  return Math.max(0, Math.round(value))
}
