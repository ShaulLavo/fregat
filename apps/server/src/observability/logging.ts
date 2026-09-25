import { sanitizeErrorMessage } from './sanitize-message'
import { elapsedMs, roundMs } from '@workspace/utils/timing'
import { AsyncLocalStorage } from 'node:async_hooks'

import { errorStringField, errorSummary, type ErrorSummaryOptions } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { RequestLogger } from 'evlog'
import { useLogger as getRequestLogger } from 'evlog/elysia'

import { isObservabilityActive, recordProcessWarning } from './runtime'
import { createStructuredError } from './structured-errors'

export type OperationContext = {
  area: string
  operation: string
  path?: string
  [key: string]: unknown
}

type OperationSummary = OperationContext & {
  durationMs: number
  // 'aborted' is for a streamed operation the client abandoned: neither a
  // success nor a failure, and previously recorded as nothing at all.
  status: 'aborted' | 'error' | 'ok'
}

// A streamed response outlives the hooks that bind evlog's own request storage,
// so the pulls that drive the stream run with no ambient logger. The route
// captures it while the request context is still live and re-enters it here for
// every step; see `sseResponse`.
const streamRequestLogger = new AsyncLocalStorage<RequestLogger<Record<string, unknown>>>()

const redactedDiagnosticValue = '[redacted]'
// Error diagnostics redact quoted substrings and keep 500-character tails;
// the shared sanitizer keeps 2000-character heads and preserves quoted text.
const sensitiveErrorFields = new Set([
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
  'path',
  'secret',
  'set-cookie',
  'text',
  'token',
  'x-api-key',
])

export async function observeRequestOperation<T>(
  context: OperationContext,
  operation: () => Promise<T>,
  summarize?: (result: T) => Record<string, unknown>,
): Promise<T> {
  if (!isObservabilityActive()) return operation()

  const startedAt = performance.now()
  recordRequestContext(baseContext(context))

  try {
    const result = await operation()
    recordOperationSummary({
      ...context,
      ...summarize?.(result),
      durationMs: elapsedMs(startedAt),
      status: 'ok',
    })
    return result
  } catch (error) {
    recordRequestError(error, {
      ...context,
      durationMs: elapsedMs(startedAt),
    })
    recordOperationSummary({
      ...context,
      durationMs: elapsedMs(startedAt),
      error: operatorErrorSummary(error),
      status: 'error',
    })
    throw error
  }
}

export function recordRequestContext(context: Record<string, unknown>) {
  const logger = currentRequestLogger()
  if (!logger) return

  logger.set(context)
}

// The web app sends `x-client-instance` on every request (see
// `apps/web/src/lib/instance-id.ts`) so request logs can be attributed to the
// app instance that produced them — multiple tabs and the desktop app share
// one log file in dev.
export function recordClientInstance(request: Request) {
  const instanceId = request.headers.get('x-client-instance')?.trim()
  if (!instanceId) return

  recordRequestContext({ client: { instanceId: instanceId.slice(0, 64) } })
}

export function recordRequestWarning(message: string, context: Record<string, unknown> = {}) {
  const logger = currentRequestLogger()
  if (!logger) {
    recordProcessWarning(message, context)
    return
  }

  logger.warn(message, safeDiagnosticContext(context))
}

export function recordRequestError(error: unknown, context: Record<string, unknown> = {}) {
  const logger = currentRequestLogger()
  if (!logger) return

  logger.error(errorForLogger(error), safeDiagnosticContext(context))
}

export function recordGitCommand(summary: {
  action: string
  allowFailure: boolean
  durationMs: number
  exitCode: number
  stderrTail?: string
}) {
  const logger = currentRequestLogger()
  if (!logger) return

  const previous = gitContext(logger)
  const failed = summary.exitCode !== 0
  logger.set({
    area: 'git',
    git: {
      allowedFailureCount: previous.allowedFailureCount + allowedFailure(summary),
      commandCount: previous.commandCount + 1,
      commandDurationMs: roundMs(previous.commandDurationMs + summary.durationMs),
      failedCommand: failed ? failedCommand(summary) : previous.failedCommand,
      failedCommandCount: previous.failedCommandCount + failedCommandCount(summary),
      slowestCommand: slowestCommand(previous.slowestCommand, summary),
    },
  })
}

export function recordStreamSummary(context: OperationSummary) {
  if (!isObservabilityActive()) return

  recordOperationSummary(context)
}

// A server message is most telling at its tail, where the underlying cause lands.
const operatorSummaryOptions: ErrorSummaryOptions = {
  guidance: true,
  limit: { maxLength: 500, preserve: 'end' },
}

/** Contracts' `errorSummary` for server logs: adds `fix` and `why`, and keeps each string's tail. */
export function operatorErrorSummary(error: unknown) {
  return errorSummary(error, operatorSummaryOptions)
}

export function limitText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value

  return value.slice(Math.max(0, value.length - maxLength))
}

/** Runs `step` under `logger`, for stream code the request hooks no longer cover. */
export function runWithRequestLogger<T>(
  logger: RequestLogger<Record<string, unknown>> | null,
  step: () => T,
): T {
  if (!logger) return step()

  return streamRequestLogger.run(logger, step)
}

export function captureRequestLogger(): RequestLogger<Record<string, unknown>> | null {
  return currentRequestLogger()
}

function currentRequestLogger(): RequestLogger<Record<string, unknown>> | null {
  if (!isObservabilityActive()) return null

  const streamed = streamRequestLogger.getStore()
  if (streamed) return streamed

  // Throws with no request in scope at all: a background task, or a stream whose
  // owner never captured one. Callers already treat null as nothing to enrich.
  try {
    return getRequestLogger()
  } catch {
    return null
  }
}

function baseContext(context: OperationContext) {
  return {
    area: context.area,
    operation: context.operation,
  }
}

function recordOperationSummary(summary: OperationSummary) {
  recordRequestContext({
    area: summary.area,
    operation: summary.operation,
    [summary.area]: {
      operations: [summary],
    },
  })
}

function errorForLogger(error: unknown) {
  if (error instanceof Error) return sanitizedErrorForLogger(error)

  return String(error)
}

function sanitizedErrorForLogger(error: Error) {
  const cause = errorCause(error)
  const clone = createStructuredError({
    code: errorStringField(error, 'code'),
    message: error.message,
  })
  clone.name = error.name
  clone.stack = error.stack
  copySafeErrorFields(error, clone as unknown as Error & Record<string, unknown>)
  if (cause !== undefined) clone.cause = sanitizeErrorCause(cause)

  return clone
}

function sanitizeErrorCause(cause: unknown, seen = new WeakSet<object>()): unknown {
  if (cause instanceof Error) return sanitizeErrorObject(cause, seen)
  if (Array.isArray(cause)) return cause.map((value) => sanitizeErrorCause(value, seen))
  if (!isRecord(cause)) return cause
  if (seen.has(cause)) return '[circular]'

  seen.add(cause)
  return sanitizeRecord(cause, seen)
}

function sanitizeErrorObject(error: Error, seen: WeakSet<object>) {
  if (seen.has(error)) return '[circular]'

  seen.add(error)
  const cause = errorCause(error)
  const summary: Record<string, unknown> = {
    message: sanitizeErrorMessage(error.message),
    name: error.name,
  }
  copySafeErrorFields(error, summary, seen)
  if (cause !== undefined) summary.cause = sanitizeErrorCause(cause, seen)

  return summary
}

function sanitizeRecord(record: Record<string, unknown>, seen: WeakSet<object>) {
  const safe: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    safe[key] = sensitiveErrorFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeErrorCause(value, seen)
  }

  return safe
}

function copySafeErrorFields(
  source: Error,
  target: Record<string, unknown>,
  seen = new WeakSet<object>(),
) {
  for (const [key, value] of Object.entries(source)) {
    if (key === 'cause') continue
    target[key] = sensitiveErrorFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeErrorCause(value, seen)
  }
}

function errorCause(error: Error) {
  return 'cause' in error ? error.cause : undefined
}

function safeDiagnosticContext(context: Record<string, unknown>) {
  if (!('path' in context)) return context

  const { path, ...rest } = context
  return {
    ...rest,
    targetPath: path,
  }
}

function gitContext(logger: RequestLogger<Record<string, unknown>>) {
  const context = logger.getContext()
  const git = isRecord(context.git) ? context.git : {}

  return {
    allowedFailureCount: numberField(git.allowedFailureCount),
    commandCount: numberField(git.commandCount),
    commandDurationMs: numberField(git.commandDurationMs),
    failedCommand: isRecord(git.failedCommand) ? git.failedCommand : undefined,
    failedCommandCount: numberField(git.failedCommandCount),
    slowestCommand: isRecord(git.slowestCommand) ? git.slowestCommand : undefined,
  }
}

function allowedFailure(summary: { allowFailure: boolean; exitCode: number }) {
  return summary.allowFailure && summary.exitCode !== 0 ? 1 : 0
}

function failedCommandCount(summary: { allowFailure: boolean; exitCode: number }) {
  return !summary.allowFailure && summary.exitCode !== 0 ? 1 : 0
}

function failedCommand(summary: {
  action: string
  durationMs: number
  exitCode: number
  stderrTail?: string
}) {
  return {
    action: summary.action,
    durationMs: summary.durationMs,
    exitCode: summary.exitCode,
    stderrTail: summary.stderrTail,
  }
}

function slowestCommand(
  previous: Record<string, unknown> | undefined,
  summary: { action: string; durationMs: number; exitCode: number },
) {
  const previousDuration = numberField(previous?.durationMs)
  if (previous && previousDuration >= summary.durationMs) return previous

  return {
    action: summary.action,
    durationMs: summary.durationMs,
    exitCode: summary.exitCode,
  }
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
