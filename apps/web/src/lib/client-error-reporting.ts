import { errorNumberField, errorStringField } from '@workspace/contracts'

import { log } from './client-logging'

type ClientErrorReport = {
  area: string
  operation: string
  message: string
  category?: string
  cause?: unknown
  context?: Record<string, unknown>
}

const redactedDiagnosticValue = '[redacted]'
// Server events retain workspace paths and stacks in the same log. Keep client
// diagnostics aligned while continuing to redact credentials.
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
  'text',
  'token',
  'x-api-key',
])

export function reportClientError(report: ClientErrorReport): void {
  const safeReport = safeClientErrorReport(report)

  const level = report.category === 'connectivity' ? 'warn' : 'error'
  log[level]({
    action: 'client.error',
    area: report.area,
    category: report.category,
    cause: safeReport.cause,
    context: safeReport.context,
    message: report.message,
    operation: report.operation,
  })
}

function safeClientErrorReport(report: ClientErrorReport) {
  return {
    category: report.category,
    cause: sanitizeDiagnosticValue(report.cause),
    context: sanitizeDiagnosticValue(report.context),
    message: report.message,
  }
}

function sanitizeDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return sanitizeError(value, seen)
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item, seen))
  if (!isPlainObject(value)) return value
  if (seen.has(value)) return '[circular]'

  seen.add(value)
  return sanitizeRecord(value, seen)
}

function sanitizeError(error: Error, seen: WeakSet<object>) {
  if (seen.has(error)) return '[circular]'

  seen.add(error)
  return {
    cause: sanitizeDiagnosticValue(error.cause, seen),
    code: errorStringField(error, 'code'),
    fix: errorStringField(error, 'fix'),
    message: error.message,
    name: error.name,
    stack: error.stack,
    status: errorNumberField(error, 'statusCode') ?? errorNumberField(error, 'status'),
    why: errorStringField(error, 'why'),
  }
}

function sanitizeRecord(record: Record<string, unknown>, seen: WeakSet<object>) {
  const safe: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    safe[key] = sensitiveFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(value, seen)
  }

  return safe
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
