import { limitDiagnosticString as limitString } from '@workspace/observability/sanitize'
import { createHash } from 'node:crypto'
import { errorNumberField, errorStringField } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import { log, type LogLevel } from 'evlog'

import { observabilityConfig } from './runtime'

export type ClientLogIngestResult =
  | {
      ok: true
    }
  | {
      message: string
      ok: false
    }

const validLogLevels: ReadonlySet<LogLevel> = new Set(['debug', 'error', 'info', 'warn'])
const maxInstanceIdLength = 64
const maxRememberedClientEvents = 1_024
const maxTimestampSkewMs = 24 * 60 * 60 * 1_000
const maxArrayItems = 25
const maxObjectKeys = 50
const maxStringLength = 2_000
const maxDepth = 5
const redactedDiagnosticValue = '[redacted]'
const sensitiveFields = new Set([
  'absolutePath',
  'authorization',
  'body',
  'content',
  'cookie',
  'cwd',
  'dest',
  'destination',
  'fileName',
  'filename',
  'password',
  'patch',
  'secret',
  'set-cookie',
  'stack',
  'text',
  'token',
  'x-api-key',
])
const rememberedClientEvents = new Map<string, true>()

export function recordClientLog(payload: unknown, request: Request): ClientLogIngestResult {
  const events = clientLogEvents(payload, request)
  if (!events) return { ok: false, message: 'Invalid client log payload.' }

  for (const event of events) {
    if (event.dedupeKey && !rememberClientEvent(event.dedupeKey)) continue
    emitClientLog(event.level, event.fields)
  }

  return { ok: true }
}

function clientLogEvents(payload: unknown, request: Request): ClientLogEvent[] | null {
  const payloads = clientLogPayloads(payload)
  if (!payloads) return null

  const events: ClientLogEvent[] = []
  for (const item of payloads) {
    const event = clientLogEvent(item, request)
    if (!event) return null

    events.push(event)
  }

  return events
}

function clientLogPayloads(payload: unknown) {
  if (Array.isArray(payload)) return payload
  if (isRecord(payload)) return [payload]

  return null
}

function clientLogEvent(payload: unknown, request: Request): ClientLogEvent | null {
  const eventPayload = clientEventPayload(payload)
  if (!isRecord(eventPayload)) return null

  const level = clientLogLevel(eventPayload.level)
  const timestamp = clientLogTimestamp(eventPayload.timestamp)
  if (!level || !timestamp) return null

  const config = observabilityConfig()
  const safePayload = clientFields(sanitizeClientPayload(eventPayload))
  const clientService = stringField(eventPayload.service) ?? `${config.service}-web`
  const url = new URL(request.url)
  const eventId = stringField(eventPayload.eventId)

  return {
    dedupeKey: eventId ? clientDedupeKey(url, eventId) : null,
    level,
    fields: {
      ...safePayload,
      client: clientEnvelope(clientService, timestamp, url),
      ingest: {
        method: request.method,
        path: url.pathname,
      },
      source: 'client',
    },
  }
}

// The web app appends `?instance=<id>` to the drain endpoint (see
// `apps/web/src/lib/instance-id.ts`) so every ingested event can be
// attributed to the app instance that produced it.
function clientEnvelope(service: string, timestamp: string, url: URL) {
  const envelope: Record<string, unknown> = { service, timestamp }
  const instanceId = clientInstanceId(url)
  if (instanceId) envelope.instanceId = instanceId

  return envelope
}

function clientInstanceId(url: URL) {
  return stringField(url.searchParams.get('instance'))?.slice(0, maxInstanceIdLength) ?? null
}

function clientDedupeKey(url: URL, eventId: string) {
  const instanceId = stringField(url.searchParams.get('instance')) ?? ''

  return createHash('sha256').update(instanceId).update('\0').update(eventId).digest('hex')
}

type ClientLogEvent = {
  dedupeKey: string | null
  fields: Record<string, unknown>
  level: LogLevel
}

function rememberClientEvent(key: string) {
  if (rememberedClientEvents.has(key)) return false

  rememberedClientEvents.set(key, true)
  while (rememberedClientEvents.size > maxRememberedClientEvents) {
    const oldest = rememberedClientEvents.keys().next().value
    if (typeof oldest !== 'string') break
    rememberedClientEvents.delete(oldest)
  }

  return true
}

function emitClientLog(level: LogLevel, fields: Record<string, unknown>) {
  log[level](fields)
}

function clientEventPayload(payload: unknown) {
  if (!isRecord(payload)) return payload
  if (isDrainContextPayload(payload)) return payload.event

  return payload
}

function isDrainContextPayload(payload: Record<string, unknown>) {
  if (!isRecord(payload.event)) return false

  return clientLogLevel(payload.event.level) !== null
}

function clientLogLevel(value: unknown): LogLevel | null {
  if (typeof value !== 'string') return null
  if (!validLogLevels.has(value as LogLevel)) return null

  return value as LogLevel
}

function clientLogTimestamp(value: unknown): string | null {
  if (typeof value === 'number') return timestampFromNumber(value)
  if (typeof value !== 'string') return null

  return timestampFromString(value)
}

function timestampFromNumber(value: number) {
  if (!Number.isFinite(value)) return null

  return timestampWithinRange(value) ? new Date(value).toISOString() : null
}

function timestampFromString(value: string) {
  if (value.length > 40) return null

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null

  return timestampWithinRange(timestamp) ? new Date(timestamp).toISOString() : null
}

function timestampWithinRange(timestamp: number) {
  const now = Date.now()
  const minTimestamp = new Date('2000-01-01T00:00:00.000Z').getTime()
  const maxTimestamp = now + maxTimestampSkewMs
  return timestamp >= minTimestamp && timestamp <= maxTimestamp
}

function sanitizeClientPayload(payload: Record<string, unknown>) {
  return sanitizeRecord(payload, 0)
}

function clientFields(payload: Record<string, unknown>) {
  const fields = { ...payload }

  delete fields.client
  delete fields.environment
  delete fields.ingest
  delete fields.level
  delete fields.service
  delete fields.source
  delete fields.timestamp

  return fields
}

function sanitizeDiagnosticValue(
  value: unknown,
  depth: number,
  seen = new WeakSet<object>(),
): unknown {
  if (value instanceof Error) return sanitizeError(value, depth, seen)
  if (Array.isArray(value)) return sanitizeArray(value, depth, seen)
  if (!isRecord(value)) return sanitizePrimitive(value)
  if (seen.has(value)) return '[circular]'
  if (depth >= maxDepth) return '[truncated]'

  seen.add(value)
  return sanitizeRecord(value, depth + 1, seen)
}

function sanitizeArray(values: unknown[], depth: number, seen: WeakSet<object>) {
  if (depth >= maxDepth) return '[truncated]'

  return values
    .slice(0, maxArrayItems)
    .map((value) => sanitizeDiagnosticValue(value, depth + 1, seen))
}

function sanitizeError(error: Error, depth: number, seen: WeakSet<object>) {
  if (seen.has(error)) return '[circular]'

  seen.add(error)
  return {
    cause: sanitizeDiagnosticValue(error.cause, depth + 1, seen),
    code: errorStringField(error, 'code', { maxLength: maxStringLength }),
    fix: errorStringField(error, 'fix', { maxLength: maxStringLength }),
    message: limitString(error.message),
    name: error.name,
    status: errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status'),
    why: errorStringField(error, 'why', { maxLength: maxStringLength }),
  }
}

function sanitizeRecord(
  record: Record<string, unknown>,
  depth: number,
  seen = new WeakSet<object>(),
) {
  const safe: Record<string, unknown> = {}
  const entries = Object.entries(record).slice(0, maxObjectKeys)

  for (const [key, value] of entries) {
    safe[key] = sensitiveFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(value, depth, seen)
  }

  return safe
}

function sanitizePrimitive(value: unknown) {
  return typeof value === 'string' ? limitString(value) : value
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? limitString(value.trim()) : null
}
