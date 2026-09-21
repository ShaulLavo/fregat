import * as v from 'valibot'
import { isoDateTimeSchema, nonNegativeIntegerSchema } from './chat-model'

export const logDashboardLevelSchema = v.picklist(['debug', 'error', 'info', 'warn'])

const logDashboardFiltersSchema = v.object({
  areas: v.optional(v.array(v.string())),
  levels: v.optional(v.array(logDashboardLevelSchema)),
  search: v.optional(v.string()),
  since: v.optional(isoDateTimeSchema),
  slowMs: v.optional(nonNegativeIntegerSchema),
  sources: v.optional(v.array(v.string())),
  until: v.optional(isoDateTimeSchema),
})

const logEventSummarySchema = v.object({
  action: v.nullable(v.string()),
  area: v.nullable(v.string()),
  durationMs: v.nullable(v.number()),
  environment: v.nullable(v.string()),
  errorCode: v.nullable(v.string()),
  errorMessage: v.nullable(v.string()),
  errorName: v.nullable(v.string()),
  id: v.string(),
  level: logDashboardLevelSchema,
  message: v.nullable(v.string()),
  method: v.nullable(v.string()),
  operation: v.nullable(v.string()),
  outcome: v.nullable(v.string()),
  path: v.nullable(v.string()),
  requestId: v.nullable(v.string()),
  service: v.nullable(v.string()),
  source: v.nullable(v.string()),
  status: v.nullable(v.number()),
  sessionId: v.nullable(v.string()),
  timestamp: isoDateTimeSchema,
})

const logEventDetailSchema = v.object({
  event: logEventSummarySchema,
  rawJson: v.record(v.string(), v.unknown()),
})

const logEventDetailsByIdSchema = v.record(v.string(), logEventDetailSchema)

const logDashboardBreakdownItemSchema = v.object({
  count: nonNegativeIntegerSchema,
  value: v.string(),
})

const logDashboardTimelineBucketSchema = v.object({
  end: isoDateTimeSchema,
  error: nonNegativeIntegerSchema,
  slow: nonNegativeIntegerSchema,
  start: isoDateTimeSchema,
  total: nonNegativeIntegerSchema,
  warn: nonNegativeIntegerSchema,
})

export const logDashboardSummarySchema = v.object({
  actions: v.array(logDashboardBreakdownItemSchema),
  areas: v.array(logDashboardBreakdownItemSchema),
  durationP95Ms: v.nullable(v.number()),
  errorCount: nonNegativeIntegerSchema,
  firstTimestamp: v.nullable(isoDateTimeSchema),
  generatedAt: isoDateTimeSchema,
  lastTimestamp: v.nullable(isoDateTimeSchema),
  levels: v.array(logDashboardBreakdownItemSchema),
  slowCount: nonNegativeIntegerSchema,
  sources: v.array(logDashboardBreakdownItemSchema),
  timeline: v.array(logDashboardTimelineBucketSchema),
  total: nonNegativeIntegerSchema,
  warnCount: nonNegativeIntegerSchema,
})

export const logEventsResultSchema = v.object({
  detailsById: logEventDetailsByIdSchema,
  events: v.array(logEventSummarySchema),
  nextCursor: v.nullable(v.string()),
  total: nonNegativeIntegerSchema,
})

export const logLiveStreamItemSchema = v.variant('kind', [
  v.object({
    detail: logEventDetailSchema,
    event: logEventSummarySchema,
    kind: v.literal('event'),
  }),
])

// The server always fills this many buckets, so the client can size its skeleton.
export const logDashboardTimelineBucketCount = 48

export type LogDashboardLevel = v.InferOutput<typeof logDashboardLevelSchema>
export type LogDashboardFilters = v.InferOutput<typeof logDashboardFiltersSchema>
export type LogEventSummary = v.InferOutput<typeof logEventSummarySchema>
export type LogEventDetail = v.InferOutput<typeof logEventDetailSchema>
export type LogEventDetailsById = v.InferOutput<typeof logEventDetailsByIdSchema>
export type LogDashboardBreakdownItem = v.InferOutput<typeof logDashboardBreakdownItemSchema>
export type LogDashboardTimelineBucket = v.InferOutput<typeof logDashboardTimelineBucketSchema>
export type LogDashboardSummary = v.InferOutput<typeof logDashboardSummarySchema>
export type LogEventsResult = v.InferOutput<typeof logEventsResultSchema>
export type LogLiveStreamItem = v.InferOutput<typeof logLiveStreamItemSchema>
