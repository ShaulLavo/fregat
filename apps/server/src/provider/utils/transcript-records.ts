import * as v from 'valibot'
import { usageTokenCount, providerUsagePurposeSchema } from '@workspace/contracts'
import {
  claudeTranscriptUsage,
  claudePromptIdentity,
  initialCodexUsageState,
  reduceCodexUsage,
  codexUsageStateSchema,
} from './imported-usage'
import { estimateUsageCost, type RecordedModelPrice } from './model-prices'
import { initialTranscriptJsonState, transcriptJsonStateSchema } from './transcript-json'

const count = v.pipe(v.number(), v.integer(), v.minValue(0))
const rates = v.object({
  provider: v.string(),
  model: v.string(),
  fetchedAt: v.pipe(v.string(), v.isoTimestamp()),
  input: v.number(),
  output: v.number(),
  cacheRead: v.nullable(v.number()),
  cacheWrite: v.nullable(v.number()),
})
const transcriptRecordSchema = v.object({
  billingKey: v.string(),
  turnKey: v.string(),
  model: v.string(),
  recordedAt: v.pipe(v.string(), v.isoTimestamp()),
  driverKind: v.string(),
  identityKind: v.picklist(['native', 'source']),
  purpose: providerUsagePurposeSchema,
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  reasoningTokens: count,
  costUsd: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
  price: v.nullable(rates),
  reportedCostUsd: v.nullable(v.pipe(v.number(), v.finite(), v.minValue(0))),
})
export type TranscriptRecord = v.InferOutput<typeof transcriptRecordSchema>
export const transcriptReducerSchema = v.object({
  records: v.record(v.string(), transcriptRecordSchema),
  codex: codexUsageStateSchema,
  claudeTurn: v.nullable(v.string()),
  projector: transcriptJsonStateSchema,
  lines: count,
  malformedLines: count,
  oversizedLines: count,
})
export type TranscriptReducer = v.InferOutput<typeof transcriptReducerSchema>
export type LocalPriceCatalog = {
  lookupLocal(driverKind: string, model: string): RecordedModelPrice | null
}

export function initialTranscriptReducer(): TranscriptReducer {
  return {
    records: {},
    codex: initialCodexUsageState(),
    claudeTurn: null,
    projector: initialTranscriptJsonState(),
    lines: 0,
    malformedLines: 0,
    oversizedLines: 0,
  }
}

/** Claude fragments keep maxima; Codex observations add cumulative deltas within native turns. */
export function reduceTranscriptRecord(
  state: TranscriptReducer,
  driverKind: 'claude' | 'codex',
  value: unknown,
  catalog: LocalPriceCatalog,
  sourceScope: string,
) {
  if (driverKind === 'claude') state.claudeTurn = claudePromptIdentity(value) ?? state.claudeTurn
  const projected = sourceScopedUsage(value, driverKind, sourceScope, state.lines)
  const entries =
    driverKind === 'claude'
      ? claudeTranscriptUsage([projected.value], [])
      : [reduceCodexUsage(state.codex, projected.value)]
  for (const entry of entries) {
    if (!entry || !Number.isFinite(Date.parse(entry.recordedAt))) continue
    const key = JSON.stringify([entry.billingKey, entry.model])
    const previous = state.records[key]
    const record: TranscriptRecord = {
      ...entry,
      turnKey: driverKind === 'claude' ? (state.claudeTurn ?? entry.billingKey) : entry.turnKey,
      driverKind,
      identityKind:
        projected.unknownIdentity || entry.billingKey.startsWith('source:') ? 'source' : 'native',
      purpose: 'turn',
      recordedAt: new Date(entry.recordedAt).toISOString(),
      price: previous ? previous.price : catalog.lookupLocal(driverKind, entry.model),
      reportedCostUsd: reportedCost(projected.value),
    }
    if (previous) combineRecord(record, previous, driverKind === 'claude' ? 'max' : 'sum')
    record.reasoningTokens = Math.min(record.reasoningTokens, record.outputTokens)
    if (!usageTokenCount(record)) continue
    record.costUsd =
      record.reportedCostUsd ?? (record.price ? estimateUsageCost(record, record.price) : null)
    state.records[key] = record
  }
}

function combineRecord(current: TranscriptRecord, previous: TranscriptRecord, mode: 'max' | 'sum') {
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
  ] as const) {
    current[key] =
      mode === 'max' ? Math.max(current[key], previous[key]) : current[key] + previous[key]
  }
  if (previous.reportedCostUsd !== null)
    current.reportedCostUsd = Math.max(current.reportedCostUsd ?? 0, previous.reportedCostUsd)
  if (current.turnKey === current.billingKey && previous.turnKey !== previous.billingKey)
    current.turnKey = previous.turnKey
  if (previous.recordedAt > current.recordedAt) current.recordedAt = previous.recordedAt
}

/** Native request/turn IDs prove copies. Home credentials cannot prove historical account attribution. */
export function deduplicateTranscriptRecords(
  records: Iterable<TranscriptRecord>,
): TranscriptRecord[] {
  const unique = new Map<string, TranscriptRecord>()
  for (const source of records) {
    const key = JSON.stringify([source.driverKind, source.billingKey, source.model])
    const current = { ...source }
    const previous = unique.get(key)
    if (previous) combineRecord(current, previous, 'max')
    current.price = previous ? previous.price : current.price
    current.costUsd =
      current.reportedCostUsd ?? (current.price ? estimateUsageCost(current, current.price) : null)
    unique.set(key, current)
  }
  return [...unique.values()]
}

const projectedIdentitySchema = v.looseObject({
  type: v.string(),
  requestId: v.optional(v.string()),
  message: v.optional(v.looseObject({ id: v.optional(v.string()) })),
  payload: v.optional(
    v.looseObject({ turn_id: v.optional(v.string()), model: v.optional(v.string()) }),
  ),
})

function sourceScopedUsage(
  value: unknown,
  driverKind: 'claude' | 'codex',
  scope: string,
  line: number,
) {
  const parsed = v.safeParse(projectedIdentitySchema, value)
  if (!parsed.success) return { value, unknownIdentity: false }
  const row = parsed.output
  if (driverKind === 'claude' && row.type === 'assistant' && row.message && !row.message.id) {
    if (row.requestId)
      return {
        value: { ...row, message: { ...row.message, id: `request:${row.requestId}` } },
        unknownIdentity: false,
      }
    return {
      value: { ...row, message: { ...row.message, id: `source:${scope}:${line}` } },
      unknownIdentity: true,
    }
  }
  if (
    driverKind === 'codex' &&
    row.type === 'turn_context' &&
    row.payload &&
    !row.payload.turn_id
  ) {
    return {
      value: { ...row, payload: { ...row.payload, turn_id: `source:${scope}:${line}` } },
      unknownIdentity: true,
    }
  }
  return { value, unknownIdentity: false }
}

function reportedCost(value: unknown) {
  const parsed = v.safeParse(
    v.looseObject({ costUSD: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))) }),
    value,
  )
  return parsed.success ? (parsed.output.costUSD ?? null) : null
}
