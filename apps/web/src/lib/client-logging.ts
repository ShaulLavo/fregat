import { isAbortError } from '@/lib/abort-error'
import { elapsedMs } from '@workspace/utils/timing'
import { limitDiagnosticString, sanitizeRecord } from '@workspace/observability/sanitize'
import { initLogger, isLevelEnabled, log as evlog, type DrainContext, type LogLevel } from 'evlog'
import { createHttpLogDrain } from 'evlog/http'
import { errorNumberField, errorStringField } from '@workspace/contracts'
import { observabilityEnabledFromEnv } from '@workspace/observability/env'

import { annotateClientError } from '@/lib/client-error-context'
import { primaryServerOrigin } from '@/lib/client'
import { eventLogContext } from '@/lib/environments/state/log-context'
import { clientInstanceId, instanceQueryParam } from '@/lib/instance-id'

export type ClientLogLevel = LogLevel

export type ClientLogEvent = {
  readonly action: string
  readonly area: string
  readonly level?: ClientLogLevel
  readonly [key: string]: unknown
}

type ClientLogInput = Record<string, unknown> | (() => Record<string, unknown>)
type ClientLogMethod = {
  (event: ClientLogInput): void
  (tag: string, message: string): void
}
type ClientLogApi = Record<ClientLogLevel, ClientLogMethod>

const serviceName = 'platform-web'
const ingestPath = '/_log/ingest'
let initialized = false
let policy: ReturnType<typeof resolveClientLogPolicy> | null = null
let clientEventSequence = 0

export const log: ClientLogApi = {
  debug: createClientLogMethod('debug'),
  error: createClientLogMethod('error'),
  info: createClientLogMethod('info'),
  warn: createClientLogMethod('warn'),
}

export function initializeClientLogging() {
  if (initialized) return

  initialized = true
  policy = resolveClientLogPolicy()
  if (!policy.enabled) {
    initLogger({ enabled: false })
    return
  }

  const drain = createHttpLogDrain({
    pipeline: {
      maxBufferSize: 1000,
      onDropped: (events) => {
        console.warn(`[logging] Dropped ${events.length} events from the bounded delivery queue.`)
      },
    },
    drain: {
      credentials: 'omit',
      endpoint: logIngestEndpoint(),
    },
  })

  initLogger({
    drain: (context) => {
      writeClientConsole(context)
      drain({ ...context, event: withClientEventId(context.event) })
    },
    enabled: true,
    env: {
      environment: import.meta.env.MODE,
      service: serviceName,
    },
    minLevel: policy.minLevel,
    pretty: false,
    redact: true,
    silent: true,
    stringify: true,
  })
}

export async function observeClientOperation<T>(
  event: ClientLogEvent & { readonly signal?: AbortSignal },
  operation: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
  classifyError?: (error: unknown) => string,
): Promise<T> {
  const startedAt = performance.now()
  const { level, signal, ...baseEvent } = { ...eventLogContext(event), ...event }

  try {
    const result = await operation()
    log.info(() => ({
      ...baseEvent,
      durationMs: elapsedMs(startedAt),
      outcome: 'ok',
      ...summarize?.(result),
    }))
    return result
  } catch (error) {
    annotateClientError(error, {
      context: clientErrorContext(baseEvent),
      operation: baseEvent.action,
    })

    // A failure after the caller aborted is cancellation, not an error —
    // Chromium surfaces mid-stream cancellation as TypeError ("Error in
    // input stream"), which no error-shape check can tell apart from a real
    // network failure. The signal is ground truth.
    if (!isAbortError(error) && !signal?.aborted) {
      log[failedOperationLevel(level)]({
        ...baseEvent,
        durationMs: elapsedMs(startedAt),
        error: errorSummary(error),
        outcome: classifyError?.(error) ?? 'error',
      })
    }

    throw error
  }
}

function createClientLogMethod(level: ClientLogLevel): ClientLogMethod {
  return ((tagOrEvent: ClientLogInput | string, message?: string) => {
    if (typeof tagOrEvent === 'string') {
      emitClientLog(level, { message, tag: tagOrEvent })
      return
    }

    emitClientLog(level, tagOrEvent)
  }) as ClientLogMethod
}

function emitClientLog(level: ClientLogLevel, event: ClientLogInput): void {
  if (!clientLogEnabled(level)) return

  try {
    const fields = typeof event === 'function' ? event() : event
    evlog[level](safeClientEvent(withClientEventId({ ...fields, level })))
  } catch {
    // Logging must never affect user-facing app flows.
  }
}

function withClientEventId<T extends Record<string, unknown>>(event: T) {
  if (typeof event.eventId === 'string' && event.eventId.length > 0) return event

  clientEventSequence += 1
  const eventId = globalThis.crypto?.randomUUID?.()
  if (eventId) return { ...event, eventId }

  return { ...event, eventId: `${clientInstanceId()}:${clientEventSequence}` }
}

// The instance id rides the endpoint URL instead of a header because the
// drain falls back to sendBeacon on page hide, and sendBeacon cannot send
// custom headers.
function logIngestEndpoint() {
  const endpoint = `${primaryServerOrigin().replace(/\/$/u, '')}${ingestPath}`

  return `${endpoint}?${instanceQueryParam}=${encodeURIComponent(clientInstanceId())}`
}

export function clientLoggingEnabled() {
  return (policy ?? resolveClientLogPolicy()).enabled
}

export function clientLogEnabled(level: ClientLogLevel): boolean {
  const current = policy ?? resolveClientLogPolicy()
  return current.enabled && isLevelEnabled(level, current.minLevel)
}

function resolveClientLogPolicy() {
  const level = import.meta.env.VITE_CLIENT_LOG_LEVEL
  const minLevel = level === 'debug' || level === 'error' || level === 'warn' ? level : 'info'
  return {
    enabled: observabilityEnabledFromEnv({
      NODE_ENV: import.meta.env.MODE,
      OBSERVABILITY_ENABLED: import.meta.env.OBSERVABILITY_ENABLED,
    }),
    minLevel,
  } satisfies { enabled: boolean; minLevel: ClientLogLevel }
}

function writeClientConsole({ event }: DrainContext) {
  if (!import.meta.env.DEV) return
  if (event.level === 'warn' || event.level === 'error') {
    console[event.level](event)
    return
  }
  if (clientLogEnabled('debug')) console.debug(event)
}

function safeClientEvent(event: Record<string, unknown>) {
  return { ...eventLogContext(event), ...sanitizeRecord(event), runtime: 'browser' }
}

function clientErrorContext(event: ClientLogEvent): Record<string, unknown> {
  const { action: _action, area: _area, ...context } = event

  return context
}

function errorSummary(error: unknown) {
  const code = errorStringField(error, 'code')
  const status = errorNumberField(error, 'status') ?? errorNumberField(error, 'statusCode')
  if (error instanceof Error) {
    return {
      code,
      message: limitDiagnosticString(error.message),
      name: error.name,
      status,
    }
  }

  return {
    code,
    message: limitDiagnosticString(String(error)),
    name: typeof error,
    status,
  }
}

function failedOperationLevel(level: ClientLogLevel | undefined): ClientLogLevel {
  if (level === 'debug' || level === 'error') return level

  return 'warn'
}

// Catches only direct, unwrapped aborts. Wrapped aborts and mid-stream
// cancellations are unrecognizable by shape — operations that can be aborted
// must pass their AbortSignal to observeClientOperation instead.
