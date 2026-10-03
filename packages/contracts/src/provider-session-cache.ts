import * as v from 'valibot'
import { isoDateTimeSchema, trimmedNonEmptyStringSchema } from './chat-model'

const count = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))
const timestamp = v.nullable(isoDateTimeSchema)
const share = v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(1)))

export const providerReportedCacheSchema = v.object({
  readTokens: count,
  writeTokens: count,
})

const turnSchema = v.object({
  turnId: trimmedNonEmptyStringSchema,
  models: v.array(trimmedNonEmptyStringSchema),
  recordedAt: isoDateTimeSchema,
  requestedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  ...providerReportedCacheSchema.entries,
  /** Writes divided by reported cache reads plus writes; unknown if either is incomplete. */
  writeShare: share,
})

export const SESSION_CACHE_TURN_LIMIT = 5

export const providerSessionCacheSchema = v.object({
  turns: v.pipe(v.array(turnSchema), v.maxLength(SESSION_CACHE_TURN_LIMIT)),
  ...providerReportedCacheSchema.entries,
  writeShare: share,
})

export type ProviderReportedCache = v.InferOutput<typeof providerReportedCacheSchema>
export type ProviderSessionCache = v.InferOutput<typeof providerSessionCacheSchema>
