import type { OrchestrationSessionActivity } from '@workspace/contracts'
import * as v from 'valibot'

/**
 * Providers report context occupancy as a `context-window.updated` activity whose
 * payload is the adapter's own usage snapshot. This is the one place that shape is
 * read, so a provider that omits a field degrades the gauge instead of the session.
 */
export const CONTEXT_WINDOW_ACTIVITY_KIND = 'context-window.updated'

const nonNegativeNumber = v.pipe(v.number(), v.minValue(0))

const contextSegmentSchema = v.object({
  kind: v.picklist(['used', 'deferred']),
  name: v.string(),
  tokens: nonNegativeNumber,
})

const tokenUsagePayloadSchema = v.object({
  cachedInputTokens: v.optional(nonNegativeNumber),
  cacheWriteTokens: v.optional(nonNegativeNumber),
  /** Codex compacts on its own, so a used-token count that drops is expected. */
  compactsAutomatically: v.optional(v.boolean()),
  /** A snapshot the provider did not measure, such as Claude's summed per-turn usage. */
  estimated: v.optional(v.boolean()),
  inputTokens: v.optional(nonNegativeNumber),
  maxTokens: v.optional(nonNegativeNumber),
  outputTokens: v.optional(nonNegativeNumber),
  reasoningOutputTokens: v.optional(nonNegativeNumber),
  /** Held back for compaction; `maxTokens` already excludes it. */
  reserveTokens: v.optional(nonNegativeNumber),
  segments: v.optional(v.array(contextSegmentSchema)),
  totalProcessedTokens: v.optional(nonNegativeNumber),
  usedTokens: v.optional(nonNegativeNumber),
})

export type ContextSegment = v.InferOutput<typeof contextSegmentSchema>

/** What one turn's usage was made of. A kind the provider did not report stays null. */
export type ContextTokenBreakdown = {
  readonly cachedInputTokens: number | null
  readonly cacheWriteTokens: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  /** Counted inside `outputTokens`. */
  readonly reasoningOutputTokens: number | null
}

export type ContextUsage = {
  readonly breakdown: ContextTokenBreakdown | null
  readonly compactsAutomatically: boolean
  readonly estimated: boolean
  /** The usable window: 100 % is where the provider compacts or stops. Null when unreported. */
  readonly maxTokens: number | null
  /** 0–1, clamped: a provider that over-reports must not paint past a full ring. Null with no window. */
  readonly ratio: number | null
  readonly reserveTokens: number | null
  /** What fills the window, when the provider says (Claude). */
  readonly segments: readonly ContextSegment[] | null
  readonly totalProcessedTokens: number | null
  readonly usedTokens: number
}

/**
 * The newest usable snapshot in the session, completed from older ones.
 * Activities arrive oldest-first, so the scan runs backwards.
 *
 * Claude sends two snapshots per turn and each holds half the picture: the
 * per-turn usage has the token kinds and no window, `getContextUsage` has the
 * window and what fills it. The window is a property of the session, so the
 * newest count keeps the newest known window, breakdown and segments.
 */
export function contextUsageForActivities(
  activities: readonly OrchestrationSessionActivity[],
): ContextUsage | null {
  let latest: ContextUsage | null = null
  let latestTurnId: string | null = null

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity?.kind !== CONTEXT_WINDOW_ACTIVITY_KIND) continue

    const usage = contextUsageForPayload(activity.payload)
    if (!usage) continue
    if (!latest) {
      latest = usage
      latestTurnId = activity.turnId
    } else if (activity.turnId === latestTurnId) {
      latest = completedUsage(latest, usage)
    } else {
      // Segments describe one turn's fill, so an older turn only lends the window.
      if (hasWindowAndBreakdown(latest)) return latest
      latest = completedUsage(latest, { ...usage, segments: null })
    }
    if (isComplete(latest)) return latest
  }

  return latest
}

export function contextUsageForPayload(payload: unknown): ContextUsage | null {
  const parsed = v.safeParse(tokenUsagePayloadSchema, payload)
  if (!parsed.success) return null

  const usage = parsed.output
  if (usage.usedTokens === undefined) return null

  return {
    breakdown: tokenBreakdown(usage),
    compactsAutomatically: usage.compactsAutomatically ?? false,
    estimated: usage.estimated ?? false,
    maxTokens: usage.maxTokens ?? null,
    ratio: contextUsageRatio(usage.usedTokens, usage.maxTokens ?? null),
    reserveTokens: usage.reserveTokens ?? null,
    segments: usage.segments && usage.segments.length > 0 ? usage.segments : null,
    totalProcessedTokens: usage.totalProcessedTokens ?? null,
    usedTokens: usage.usedTokens,
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

function contextUsageRatio(usedTokens: number, maxTokens: number | null) {
  if (!maxTokens) return null

  return Math.min(1, usedTokens / maxTokens)
}

function tokenBreakdown(
  usage: v.InferOutput<typeof tokenUsagePayloadSchema>,
): ContextTokenBreakdown | null {
  const breakdown = {
    cachedInputTokens: usage.cachedInputTokens ?? null,
    cacheWriteTokens: usage.cacheWriteTokens ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningOutputTokens: usage.reasoningOutputTokens ?? null,
  }
  return Object.values(breakdown).some((value) => value !== null) ? breakdown : null
}

function completedUsage(newer: ContextUsage, older: ContextUsage): ContextUsage {
  const window = newer.maxTokens === null ? older : newer
  return {
    ...newer,
    breakdown: newer.breakdown ?? older.breakdown,
    maxTokens: window.maxTokens,
    ratio: contextUsageRatio(newer.usedTokens, window.maxTokens),
    reserveTokens: window.reserveTokens,
    segments: newer.segments ?? older.segments,
  }
}

function isComplete(usage: ContextUsage) {
  return hasWindowAndBreakdown(usage) && usage.segments !== null
}

function hasWindowAndBreakdown(usage: ContextUsage) {
  return usage.maxTokens !== null && usage.breakdown !== null
}

function roundedTo(value: number, decimals: number) {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor

  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(decimals)
}
