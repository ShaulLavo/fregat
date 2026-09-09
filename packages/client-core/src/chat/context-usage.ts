import type { OrchestrationSessionActivity } from '@workspace/contracts'
import * as v from 'valibot'

/**
 * Providers report context occupancy as a `context-window.updated` activity whose
 * payload is the adapter's own usage snapshot. This is the one place that shape is
 * read, so a provider that omits a field degrades the gauge instead of the session.
 */
export const CONTEXT_WINDOW_ACTIVITY_KIND = 'context-window.updated'

const nonNegativeNumber = v.pipe(v.number(), v.minValue(0))

const tokenUsagePayloadSchema = v.object({
  cachedInputTokens: v.optional(nonNegativeNumber),
  /** Codex compacts on its own, so a used-token count that drops is expected. */
  compactsAutomatically: v.optional(v.boolean()),
  inputTokens: v.optional(nonNegativeNumber),
  maxTokens: v.optional(nonNegativeNumber),
  outputTokens: v.optional(nonNegativeNumber),
  reasoningOutputTokens: v.optional(nonNegativeNumber),
  totalProcessedTokens: v.optional(nonNegativeNumber),
  usedTokens: v.optional(nonNegativeNumber),
})

export type ContextUsage = {
  readonly compactsAutomatically: boolean
  /** Null when the provider reported occupancy without saying what it is out of. */
  readonly maxTokens: number | null
  /** 0–1, clamped: a provider that over-reports must not paint past a full ring. Null with no window. */
  readonly ratio: number | null
  readonly totalProcessedTokens: number | null
  readonly usedTokens: number
}

/**
 * The newest usable snapshot in the session. Activities arrive oldest-first, so the
 * scan runs backwards and stops at the first snapshot that reports occupancy.
 *
 * A provider can report used tokens without a window size (Claude's per-turn result
 * usage does). Dropping those snapshots hid the gauge outright; taking them at face
 * value would throw away a window size an earlier snapshot already established. The
 * window is a property of the session, not of one turn, so the newest count is kept
 * and the most recent known window is carried onto it.
 */
export function contextUsageForActivities(
  activities: readonly OrchestrationSessionActivity[],
): ContextUsage | null {
  let latest: ContextUsage | null = null

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity?.kind !== CONTEXT_WINDOW_ACTIVITY_KIND) continue

    const usage = contextUsageForPayload(activity.payload)
    if (!usage) continue
    if (!latest) latest = usage
    if (latest.maxTokens !== null) return latest
    if (usage.maxTokens === null) continue

    return withMaxTokens(latest, usage.maxTokens)
  }

  return latest
}

export function contextUsageForPayload(payload: unknown): ContextUsage | null {
  const parsed = v.safeParse(tokenUsagePayloadSchema, payload)
  if (!parsed.success) return null

  const { compactsAutomatically, maxTokens, totalProcessedTokens, usedTokens } = parsed.output
  if (usedTokens === undefined) return null

  return {
    compactsAutomatically: compactsAutomatically ?? false,
    maxTokens: maxTokens ?? null,
    ratio: contextUsageRatio(usedTokens, maxTokens),
    totalProcessedTokens: totalProcessedTokens ?? null,
    usedTokens,
  }
}

export function formatContextTokens(tokens: number) {
  if (tokens < 1000) return `${tokens}`
  if (tokens < 1_000_000) return `${roundedTo(tokens / 1000, 1)}k`

  return `${roundedTo(tokens / 1_000_000, 1)}M`
}

export function contextUsageTone(ratio: number | null) {
  if (ratio === null) return 'muted' as const
  if (ratio >= 0.9) return 'destructive' as const
  if (ratio >= 0.7) return 'warning' as const

  return 'muted' as const
}

function contextUsageRatio(usedTokens: number, maxTokens: number | undefined) {
  if (!maxTokens) return null

  return Math.min(1, usedTokens / maxTokens)
}

function withMaxTokens(usage: ContextUsage, maxTokens: number): ContextUsage {
  return {
    ...usage,
    maxTokens,
    ratio: contextUsageRatio(usage.usedTokens, maxTokens),
  }
}

function roundedTo(value: number, decimals: number) {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor

  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(decimals)
}
