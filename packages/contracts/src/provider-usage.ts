import * as v from 'valibot'
import { providerInstanceIdSchema } from './chat-ids'
import { isoDateTimeSchema, trimmedNonEmptyStringSchema } from './chat-model'
import { providerDriverKindSchema } from './orchestration-runtime'

const providerUsageWindowKindSchema = v.picklist(['session', 'weekly', 'monthly', 'other'])

/** `warning` is the provider's own early warning, not a threshold we picked. */
const providerUsageWindowStatusSchema = v.picklist(['allowed', 'warning', 'rejected'])

/**
 * One plan window of a provider account. `id` is stable per provider (`five_hour`,
 * `seven_day_opus`, Codex `primary`), so a sparse update lands on the row it names.
 */
export const providerUsageWindowSchema = v.object({
  id: trimmedNonEmptyStringSchema,
  kind: providerUsageWindowKindSchema,
  label: trimmedNonEmptyStringSchema,
  usedPercent: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
  resetsAt: v.nullable(isoDateTimeSchema),
  /** How long the window runs; with `resetsAt` it gives how much of it has passed. */
  windowMinutes: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1))),
  status: v.nullable(providerUsageWindowStatusSchema),
})

/**
 * The latest windows of one account. Instances that share a credential home are one
 * account, so they share one entry; `accountKey` is opaque and never an identifier.
 * Windows whose reset has passed are already gone from the answer.
 */
export const providerAccountUsageSchema = v.object({
  accountKey: trimmedNonEmptyStringSchema,
  driverKind: providerDriverKindSchema,
  providerInstanceIds: v.array(providerInstanceIdSchema),
  planType: v.nullable(trimmedNonEmptyStringSchema),
  windows: v.array(providerUsageWindowSchema),
  /** When a reading last confirmed these windows; the client tells old from current by it. */
  checkedAt: isoDateTimeSchema,
  resetCredits: v.optional(
    v.nullable(
      v.object({
        available: v.pipe(v.number(), v.integer(), v.minValue(0)),
        accountKey: trimmedNonEmptyStringSchema,
        creditId: v.nullable(trimmedNonEmptyStringSchema),
      }),
    ),
  ),
  resetPending: v.optional(v.boolean()),
})

export const providerUsageResultSchema = v.object({
  accounts: v.array(providerAccountUsageSchema),
})

export type ProviderUsageWindowKind = v.InferOutput<typeof providerUsageWindowKindSchema>
export type ProviderUsageWindowStatus = v.InferOutput<typeof providerUsageWindowStatusSchema>
export type ProviderUsageWindow = v.InferOutput<typeof providerUsageWindowSchema>
export type ProviderAccountUsage = v.InferOutput<typeof providerAccountUsageSchema>
export type ProviderUsageResult = v.InferOutput<typeof providerUsageResultSchema>

/** What a recorded turn was for: a chat turn, or a generation the app ran itself. */
export const providerUsagePurposeSchema = v.picklist(['turn', 'title', 'commit-message'])

export const USAGE_HISTORY_DAYS = [7, 30, 90] as const

const queryIntegerSchema = v.pipe(v.string(), v.toNumber(), v.integer())

/**
 * `utcOffsetMinutes` is the client's, so a day is the user's calendar day, not UTC's.
 * The server has no clock of the viewer's to read.
 */
export const providerUsageHistoryQuerySchema = v.object({
  days: v.pipe(queryIntegerSchema, v.picklist(USAGE_HISTORY_DAYS)),
  utcOffsetMinutes: v.pipe(queryIntegerSchema, v.minValue(-14 * 60), v.maxValue(14 * 60)),
})

const tokenCountSchema = v.pipe(v.number(), v.integer(), v.minValue(0))

const usageTokensEntries = {
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  cacheReadTokens: tokenCountSchema,
  cacheWriteTokens: tokenCountSchema,
  /** Already inside `outputTokens`; shown apart, never added again. */
  reasoningTokens: tokenCountSchema,
}

/**
 * `provider`: the CLI's estimate. `catalog`: standard API rates saved with the turn.
 * `none`: cost is unknown, never zero.
 */
const providerUsageCostSourceSchema = v.picklist(['provider', 'catalog', 'none'])

/** Dollars per million tokens, as recorded with the turns. */
const providerUsageRatesSchema = v.object({
  input: v.number(),
  output: v.number(),
  cacheRead: v.nullable(v.number()),
  cacheWrite: v.nullable(v.number()),
})

const providerUsageModelRowSchema = v.object({
  model: trimmedNonEmptyStringSchema,
  driverKind: trimmedNonEmptyStringSchema,
  turns: tokenCountSchema,
  ...usageTokensEntries,
  costUsd: v.nullable(v.number()),
  costSource: providerUsageCostSourceSchema,
  /** The standard rates behind a catalog price; null when none, or when they changed in the range. */
  rates: v.nullable(providerUsageRatesSchema),
})

const providerUsageDayModelSchema = v.object({
  model: trimmedNonEmptyStringSchema,
  driverKind: trimmedNonEmptyStringSchema,
  tokens: tokenCountSchema,
  costUsd: v.nullable(v.number()),
})

const providerUsageDayRowSchema = v.object({
  /** `YYYY-MM-DD` in the viewer's time zone. */
  day: v.pipe(v.string(), v.isoDate()),
  tokens: tokenCountSchema,
  costUsd: v.nullable(v.number()),
  /** Tokens that day with no price, so a day with only unpriced usage never reads as quiet. */
  unpricedTokens: tokenCountSchema,
  models: v.array(providerUsageDayModelSchema),
})

const providerUsagePurposeRowSchema = v.object({
  purpose: providerUsagePurposeSchema,
  turns: tokenCountSchema,
  tokens: tokenCountSchema,
  costUsd: v.nullable(v.number()),
})

/**
 * Everything the usage page shows for one range. Costs sum what is known; `unpricedTokens`
 * says how much usage has no cost behind it, so a total is never silently low.
 */
export const providerUsageHistorySchema = v.object({
  days: v.picklist(USAGE_HISTORY_DAYS),
  since: isoDateTimeSchema,
  totals: v.object({
    costUsd: v.nullable(v.number()),
    tokens: tokenCountSchema,
    turns: tokenCountSchema,
    unpricedTokens: tokenCountSchema,
  }),
  models: v.array(providerUsageModelRowSchema),
  daily: v.array(providerUsageDayRowSchema),
  purposes: v.array(providerUsagePurposeRowSchema),
})

/** What one session has used so far. `costUsd` sums priced turns; unpriced tokens are named apart. */
export const providerUsageSessionTotalSchema = v.object({
  costUsd: v.nullable(v.number()),
  tokens: tokenCountSchema,
  turns: tokenCountSchema,
  unpricedTokens: tokenCountSchema,
})

export type ProviderUsageSessionTotal = v.InferOutput<typeof providerUsageSessionTotalSchema>
export type ProviderUsagePurpose = v.InferOutput<typeof providerUsagePurposeSchema>
export type ProviderUsageHistoryQuery = v.InferOutput<typeof providerUsageHistoryQuerySchema>
export type ProviderUsageCostSource = v.InferOutput<typeof providerUsageCostSourceSchema>
export type ProviderUsageModelRow = v.InferOutput<typeof providerUsageModelRowSchema>
export type ProviderUsageDayRow = v.InferOutput<typeof providerUsageDayRowSchema>
export type ProviderUsageDayModel = v.InferOutput<typeof providerUsageDayModelSchema>
export type ProviderUsageRates = v.InferOutput<typeof providerUsageRatesSchema>
export type ProviderUsagePurposeRow = v.InferOutput<typeof providerUsagePurposeRowSchema>
export type ProviderUsageHistory = v.InferOutput<typeof providerUsageHistorySchema>

/** Tokens a row processed. Reasoning is already inside the output and is not added again. */
export function usageTokenCount(row: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}) {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
}

export const providerResetCreditOutcomeSchema = v.picklist([
  'reset',
  'nothingToReset',
  'noCredit',
  'alreadyRedeemed',
])
export const providerResetCreditBodySchema = v.object({
  accountKey: trimmedNonEmptyStringSchema,
  creditId: trimmedNonEmptyStringSchema,
  checkedAt: v.pipe(v.string(), v.isoTimestamp()),
  confirmed: v.literal(true),
})
export const providerResetCreditResultSchema = v.object({
  outcome: providerResetCreditOutcomeSchema,
  refresh: v.picklist(['confirmed', 'unconfirmed']),
  usage: providerUsageResultSchema,
})
export type ProviderResetCreditOutcome = v.InferOutput<typeof providerResetCreditOutcomeSchema>
export type ProviderResetCreditBody = v.InferOutput<typeof providerResetCreditBodySchema>
export type ProviderResetCreditResult = v.InferOutput<typeof providerResetCreditResultSchema>
