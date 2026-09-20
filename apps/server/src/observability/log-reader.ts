import { roundMs } from '@workspace/utils/timing'
import { createHash } from 'node:crypto'
import type {
  LogDashboardBreakdownItem,
  LogDashboardFilters,
  LogDashboardLevel,
  LogDashboardSummary,
  LogDashboardTimelineBucket,
  LogEventDetail,
  LogEventsResult,
  LogEventSummary,
  LogLiveStreamItem,
} from '@workspace/contracts'
import { errorStringField } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { LogLevel, WideEvent } from 'evlog'
import { readFsLogs, tailFsLogs } from 'evlog/fs'

import { observabilityConfig } from './runtime'

export type LogEventsInput = LogDashboardFilters & {
  cursor?: string
  limit?: number
}

export type LogTailInput = LogDashboardFilters & {
  pollIntervalMs?: number
  signal?: AbortSignal
}

type NormalizedLogEvent = {
  rawJson: Record<string, unknown>
  rawText: string
  summary: LogEventSummary
}

type TimelineRange = {
  endMs: number
  startMs: number
}

const defaultEventLimit = 200
const maxEventLimit = 1_000
const defaultSlowMs = 500
const timelineBucketCount = 48
const maxBreakdownItems = 12
const maxDetailCacheEvents = 5_000
const validLevels: ReadonlySet<string> = new Set(['debug', 'error', 'info', 'warn'])

export class LogReaderService {
  private readonly dir: string
  private readonly detailCache = new Map<string, NormalizedLogEvent>()

  constructor(options: { dir?: string } = {}) {
    this.dir = options.dir ?? observabilityConfig().logDir
  }

  async summary(filters: LogDashboardFilters = {}): Promise<LogDashboardSummary> {
    const events = await this.filteredEvents(filters)

    return logSummary(events, filters)
  }

  async events(input: LogEventsInput = {}): Promise<LogEventsResult> {
    const limit = eventLimit(input.limit)
    const offset = cursorOffset(input.cursor)
    const events = await this.filteredEvents(input)
    const sorted = sortNewest(events)
    const pageEvents = sorted.slice(offset, offset + limit)
    const page = pageEvents.map((event) => event.summary)
    const nextOffset = offset + pageEvents.length

    return {
      detailsById: eventDetailsById(pageEvents),
      events: page,
      nextCursor: nextOffset < sorted.length ? String(nextOffset) : null,
      total: sorted.length,
    }
  }

  async event(id: string, filters: LogDashboardFilters = {}): Promise<LogEventDetail | null> {
    const cached = this.detailCache.get(id)
    if (cached && matchesEventFilters(cached, filters)) return eventDetail(cached)

    for await (const rawEvent of readFsLogs(readOptions(this.dir, filters))) {
      const event = normalizeLogEvent(rawEvent)
      this.rememberEvent(event)
      if (!matchesEventFilters(event, filters)) continue
      if (event.summary.id !== id) continue

      return eventDetail(event)
    }

    return null
  }

  async *live(input: LogTailInput = {}): AsyncGenerator<LogLiveStreamItem> {
    const options = {
      ...readOptions(this.dir, input),
      fromEnd: true,
      pollIntervalMs: input.pollIntervalMs,
      signal: input.signal,
    }

    for await (const rawEvent of tailFsLogs(options)) {
      const event = normalizeLogEvent(rawEvent)
      if (!matchesFilters(event, input)) continue

      this.rememberEvent(event)
      yield { detail: eventDetail(event), event: event.summary, kind: 'event' }
    }
  }

  private async filteredEvents(filters: LogDashboardFilters) {
    const events: NormalizedLogEvent[] = []

    for await (const rawEvent of readFsLogs(readOptions(this.dir, filters))) {
      const event = normalizeLogEvent(rawEvent)
      this.rememberEvent(event)
      if (!matchesFilters(event, filters)) continue

      events.push(event)
    }

    return events
  }

  private rememberEvent(event: NormalizedLogEvent) {
    this.detailCache.delete(event.summary.id)
    this.detailCache.set(event.summary.id, event)

    while (this.detailCache.size > maxDetailCacheEvents) {
      const oldestId = this.detailCache.keys().next().value
      if (!oldestId) return

      this.detailCache.delete(oldestId)
    }
  }
}

export function normalizeLogEvent(event: WideEvent): NormalizedLogEvent {
  const rawJson = rawEventRecord(event)
  const rawText = stableStringify(rawJson)
  const summary: LogEventSummary = {
    action: stringField(rawJson.action),
    area: stringField(rawJson.area),
    durationMs: durationMs(rawJson),
    environment: stringField(rawJson.environment),
    errorCode: stringField(errorStringField(rawJson.error, 'code')),
    errorMessage: stringField(errorStringField(rawJson.error, 'message')),
    errorName: stringField(errorStringField(rawJson.error, 'name')),
    id: eventId(rawJson, rawText),
    level: logLevel(rawJson.level),
    message: stringField(rawJson.message),
    method: stringField(rawJson.method),
    operation: stringField(rawJson.operation),
    outcome: stringField(rawJson.outcome),
    path: stringField(rawJson.path),
    requestId: stringField(rawJson.requestId),
    service: stringField(rawJson.service),
    source: stringField(rawJson.source),
    status: numberField(rawJson.status),
    sessionId: stringField(rawJson.sessionId),
    timestamp: timestampString(rawJson.timestamp),
  }

  return { rawJson, rawText, summary }
}

function readOptions(dir: string, filters: LogDashboardFilters) {
  return {
    dir,
    level: logLevels(filters.levels),
    since: filters.since,
    until: filters.until,
  }
}

function matchesFilters(event: NormalizedLogEvent, filters: LogDashboardFilters) {
  if (!includesNullable(filters.areas, event.summary.area)) return false
  if (!includesNullable(filters.sources, event.summary.source)) return false
  if (!matchesSearch(event, filters.search)) return false

  return true
}

function matchesEventFilters(event: NormalizedLogEvent, filters: LogDashboardFilters) {
  if (!matchesReadFilters(event, filters)) return false

  return matchesFilters(event, filters)
}

function matchesReadFilters(event: NormalizedLogEvent, filters: LogDashboardFilters) {
  if (filters.levels?.length && !filters.levels.includes(event.summary.level)) return false

  const timestamp = timestampMs(event.summary)
  const since = timestampFromFilter(filters.since)
  const until = timestampFromFilter(filters.until)
  if (since !== undefined && timestamp < since) return false
  if (until !== undefined && timestamp > until) return false

  return true
}

function eventDetail(event: NormalizedLogEvent): LogEventDetail {
  return { event: event.summary, rawJson: event.rawJson }
}

function eventDetailsById(events: readonly NormalizedLogEvent[]) {
  const detailsById: Record<string, LogEventDetail> = {}

  for (const event of events) {
    detailsById[event.summary.id] = eventDetail(event)
  }

  return detailsById
}

function includesNullable(values: readonly string[] | undefined, value: string | null) {
  if (!values?.length) return true
  if (value === null) return values.includes('(none)')

  return values.includes(value)
}

function matchesSearch(event: NormalizedLogEvent, search: string | undefined) {
  const normalized = search?.trim().toLowerCase()
  if (!normalized) return true

  return searchText(event).includes(normalized)
}

function searchText(event: NormalizedLogEvent) {
  return [
    event.summary.action,
    event.summary.area,
    event.summary.errorCode,
    event.summary.errorMessage,
    event.summary.message,
    event.summary.operation,
    event.summary.path,
    event.summary.requestId,
    event.summary.source,
    event.summary.sessionId,
    event.rawText,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .toLowerCase()
}

function logSummary(
  events: readonly NormalizedLogEvent[],
  filters: LogDashboardFilters,
): LogDashboardSummary {
  const summaries = events.map((event) => event.summary)
  const durations = numericDurations(summaries)
  const range = timelineRange(summaries, filters)

  return {
    actions: breakdown(summaries, (event) => event.action),
    areas: breakdown(summaries, (event) => event.area),
    durationP95Ms: percentile(durations, 0.95),
    errorCount: countWhere(summaries, (event) => event.level === 'error'),
    firstTimestamp: firstTimestamp(summaries),
    generatedAt: new Date().toISOString(),
    lastTimestamp: lastTimestamp(summaries),
    levels: breakdown(summaries, (event) => event.level),
    slowCount: countWhere(summaries, (event) => isSlowEvent(event, filters)),
    sources: breakdown(summaries, (event) => event.source),
    timeline: timeline(summaries, range, filters),
    total: summaries.length,
    warnCount: countWhere(summaries, (event) => event.level === 'warn'),
  }
}

function sortNewest(events: readonly NormalizedLogEvent[]) {
  return events.toSorted((left, right) => timestampMs(right.summary) - timestampMs(left.summary))
}

function breakdown(
  events: readonly LogEventSummary[],
  valueForEvent: (event: LogEventSummary) => string | null,
): LogDashboardBreakdownItem[] {
  const counts = new Map<string, number>()

  for (const event of events) {
    const value = valueForEvent(event) ?? '(none)'
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return Array.from(counts, ([value, count]) => ({ count, value }))
    .toSorted(compareBreakdownItems)
    .slice(0, maxBreakdownItems)
}

function compareBreakdownItems(left: LogDashboardBreakdownItem, right: LogDashboardBreakdownItem) {
  return right.count - left.count || left.value.localeCompare(right.value)
}

function timeline(
  events: readonly LogEventSummary[],
  range: TimelineRange,
  filters: LogDashboardFilters,
): LogDashboardTimelineBucket[] {
  const bucketMs = Math.max(1, Math.ceil((range.endMs - range.startMs) / timelineBucketCount))
  const buckets = createTimelineBuckets(range.startMs, bucketMs)

  for (const event of events) {
    addEventToTimelineBucket(buckets, event, range.startMs, bucketMs, filters)
  }

  return buckets
}

function createTimelineBuckets(startMs: number, bucketMs: number) {
  return Array.from({ length: timelineBucketCount }, (_, index) => ({
    end: new Date(startMs + bucketMs * (index + 1)).toISOString(),
    error: 0,
    slow: 0,
    start: new Date(startMs + bucketMs * index).toISOString(),
    total: 0,
    warn: 0,
  }))
}

function addEventToTimelineBucket(
  buckets: LogDashboardTimelineBucket[],
  event: LogEventSummary,
  startMs: number,
  bucketMs: number,
  filters: LogDashboardFilters,
) {
  const index = Math.min(
    buckets.length - 1,
    Math.max(0, Math.floor((timestampMs(event) - startMs) / bucketMs)),
  )
  const bucket = buckets[index]

  bucket.total += 1
  bucket.error += event.level === 'error' ? 1 : 0
  bucket.warn += event.level === 'warn' ? 1 : 0
  bucket.slow += isSlowEvent(event, filters) ? 1 : 0
}

function timelineRange(
  events: readonly LogEventSummary[],
  filters: LogDashboardFilters,
): TimelineRange {
  const endMs = timestampFromFilter(filters.until) ?? Date.now()
  const startMs = timestampFromFilter(filters.since) ?? earliestTimelineStart(events, endMs)

  return startMs < endMs ? { endMs, startMs } : { endMs: endMs + 1, startMs: endMs }
}

function earliestTimelineStart(events: readonly LogEventSummary[], fallbackEndMs: number) {
  if (!events.length) return fallbackEndMs - 60 * 60 * 1_000

  return Math.min(...events.map(timestampMs))
}

function timestampFromFilter(value: string | undefined) {
  if (!value) return undefined

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function firstTimestamp(events: readonly LogEventSummary[]) {
  if (!events.length) return null

  return new Date(Math.min(...events.map(timestampMs))).toISOString()
}

function lastTimestamp(events: readonly LogEventSummary[]) {
  if (!events.length) return null

  return new Date(Math.max(...events.map(timestampMs))).toISOString()
}

function countWhere(
  events: readonly LogEventSummary[],
  predicate: (event: LogEventSummary) => boolean,
) {
  let count = 0

  for (const event of events) {
    if (predicate(event)) count += 1
  }

  return count
}

function isSlowEvent(event: LogEventSummary, filters: LogDashboardFilters) {
  if (event.durationMs === null) return false

  return event.durationMs >= (filters.slowMs ?? defaultSlowMs)
}

function numericDurations(events: readonly LogEventSummary[]) {
  return events
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .toSorted((left, right) => left - right)
}

function percentile(values: readonly number[], percentileValue: number) {
  if (!values.length) return null

  const index = Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)
  return roundMs(values[index])
}

function eventLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) return defaultEventLimit
  if (limit === undefined) return defaultEventLimit

  return Math.min(maxEventLimit, Math.max(1, Math.trunc(limit)))
}

function cursorOffset(cursor: string | undefined) {
  if (!cursor) return 0

  const parsed = Number.parseInt(cursor, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function logLevels(levels: readonly LogDashboardLevel[] | undefined) {
  return levels?.length ? (Array.from(levels) as LogLevel[]) : undefined
}

function rawEventRecord(event: WideEvent) {
  return isRecord(event) ? (event as Record<string, unknown>) : { value: event }
}

function eventId(event: Record<string, unknown>, rawText: string) {
  const existing = stringField(event.logId) ?? stringField(event.id) ?? stringField(event.eventId)
  if (existing) return existing

  return createHash('sha256').update(eventIdMaterial(event, rawText)).digest('hex').slice(0, 24)
}

function eventIdMaterial(event: Record<string, unknown>, rawText: string) {
  return stableStringify({
    action: event.action,
    area: event.area,
    level: event.level,
    path: event.path,
    raw: rawText,
    requestId: event.requestId,
    source: event.source,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
  })
}

function logLevel(value: unknown): LogDashboardLevel {
  if (typeof value === 'string' && validLevels.has(value)) return value as LogDashboardLevel

  return 'info'
}

function timestampString(value: unknown) {
  if (typeof value === 'string') return dateString(value)
  if (typeof value === 'number') return new Date(value).toISOString()

  return new Date().toISOString()
}

function dateString(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return new Date().toISOString()

  return new Date(timestamp).toISOString()
}

function timestampMs(event: LogEventSummary) {
  return Date.parse(event.timestamp)
}

function durationMs(event: Record<string, unknown>) {
  const numeric = numberField(event.durationMs)
  if (numeric !== null) return roundMs(numeric)
  if (typeof event.duration !== 'string') return null

  return durationTextMs(event.duration)
}

function durationTextMs(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/u)
  if (!match) return null

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null

  return roundMs(amount * durationUnitMultiplier(match[2]))
}

function durationUnitMultiplier(unit: string | undefined) {
  if (unit === 's') return 1_000
  if (unit === 'm') return 60_000

  return 1
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'undefined'

  return `{${stableEntries(value).join(',')}}`
}

function stableEntries(value: Record<string, unknown>) {
  return Object.keys(value)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
}
