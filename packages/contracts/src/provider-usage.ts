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
 * `provider`: the CLI's own estimate. `price`: the user's per-model price applied at
 * read time. `none`: no estimate and no price, so the cost is unknown, not zero.
 */
const providerUsageCostSourceSchema = v.picklist(['provider', 'price', 'none'])

const providerUsageModelRowSchema = v.object({
  model: trimmedNonEmptyStringSchema,
  driverKind: trimmedNonEmptyStringSchema,
  turns: tokenCountSchema,
  ...usageTokensEntries,
  costUsd: v.nullable(v.number()),
  costSource: providerUsageCostSourceSchema,
})

const providerUsageDayRowSchema = v.object({
  /** `YYYY-MM-DD` in the viewer's time zone. */
  day: v.pipe(v.string(), v.isoDate()),
  tokens: tokenCountSchema,
  costUsd: v.number(),
})

const providerUsagePurposeRowSchema = v.object({
  purpose: providerUsagePurposeSchema,
  turns: tokenCountSchema,
  tokens: tokenCountSchema,
  costUsd: v.number(),
})

/**
 * Everything the usage page shows for one range. Costs sum what is known; `unpricedTokens`
 * says how much usage has no cost behind it, so a total is never silently low.
 */
export const providerUsageHistorySchema = v.object({
  days: v.picklist(USAGE_HISTORY_DAYS),
  since: isoDateTimeSchema,
  totals: v.object({
    costUsd: v.number(),
    tokens: tokenCountSchema,
    turns: tokenCountSchema,
    unpricedTokens: tokenCountSchema,
  }),
  models: v.array(providerUsageModelRowSchema),
  daily: v.array(providerUsageDayRowSchema),
  purposes: v.array(providerUsagePurposeRowSchema),
})

/** US dollars per million tokens, for models whose provider reports no cost. */
const modelPriceSchema = v.object({
  input: v.pipe(v.number(), v.minValue(0)),
  cachedInput: v.pipe(v.number(), v.minValue(0)),
  output: v.pipe(v.number(), v.minValue(0)),
})

export const modelPricesSchema = v.record(trimmedNonEmptyStringSchema, modelPriceSchema)

export type ProviderUsagePurpose = v.InferOutput<typeof providerUsagePurposeSchema>
export type ProviderUsageHistoryQuery = v.InferOutput<typeof providerUsageHistoryQuerySchema>
export type ProviderUsageCostSource = v.InferOutput<typeof providerUsageCostSourceSchema>
export type ProviderUsageModelRow = v.InferOutput<typeof providerUsageModelRowSchema>
export type ProviderUsageDayRow = v.InferOutput<typeof providerUsageDayRowSchema>
export type ProviderUsagePurposeRow = v.InferOutput<typeof providerUsagePurposeRowSchema>
export type ProviderUsageHistory = v.InferOutput<typeof providerUsageHistorySchema>
export type ModelPrice = v.InferOutput<typeof modelPriceSchema>
export type ModelPrices = v.InferOutput<typeof modelPricesSchema>

/** Tokens a row processed. Reasoning is already inside the output and is not added again. */
export function usageTokenCount(row: {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}) {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens
}
