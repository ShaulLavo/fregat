import { isRecord } from '@workspace/utils/objects'
const maxStringLength = 2_000
const redactedDiagnosticValue = '[redacted]'
// Server logs already retain stack traces, so the client keeps them for the
// same diagnostic value while credentials and request payloads stay redacted.
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

type DiagnosticPolicy = {
  readonly formatString: (value: string) => string
  readonly errorFields?: (error: Error) => Record<string, unknown>
}

const logPolicy: DiagnosticPolicy = { formatString: limitDiagnosticString }

export function createDiagnosticSanitizer(policy: DiagnosticPolicy) {
  return (value: unknown) => sanitizeDiagnosticValue(value, new WeakSet(), policy)
}

export function sanitizeRecord(record: Record<string, unknown>, seen = new WeakSet<object>()) {
  return sanitizeFields(record, seen, logPolicy)
}

function sanitizeFields(
  record: Record<string, unknown>,
  seen: WeakSet<object>,
  policy: DiagnosticPolicy,
) {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    safe[key] = sensitiveFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(value, seen, policy)
  }
  return safe
}

function sanitizeDiagnosticValue(
  value: unknown,
  seen: WeakSet<object>,
  policy: DiagnosticPolicy,
): unknown {
  if (value instanceof Error) return sanitizeError(value, seen, policy)
  if (Array.isArray(value)) return value.map((item) => sanitizeDiagnosticValue(item, seen, policy))
  if (typeof value === 'string') return policy.formatString(value)
  if (!isRecord(value)) return value
  if (seen.has(value)) return '[circular]'

  seen.add(value)
  return sanitizeFields(value, seen, policy)
}

function sanitizeError(error: Error, seen: WeakSet<object>, policy: DiagnosticPolicy) {
  if (seen.has(error)) return '[circular]'

  seen.add(error)
  return {
    cause: sanitizeDiagnosticValue(error.cause, seen, policy),
    message: policy.formatString(error.message),
    name: error.name,
    stack: error.stack,
    ...policy.errorFields?.(error),
  }
}

export function limitDiagnosticString(value: string) {
  if (value.length <= maxStringLength) return value

  return value.slice(0, maxStringLength)
}
