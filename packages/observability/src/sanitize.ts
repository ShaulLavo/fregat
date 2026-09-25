import { isRecord } from '@workspace/utils/objects'
const maxStringLength = 2_000
const redactedDiagnosticValue = '[redacted]'
// Server logs already retain stack traces, so the client keeps them for the
// same diagnostic value while credentials and request payloads stay redacted.
export const sensitiveDiagnosticFields: ReadonlySet<string> = new Set([
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

type DiagnosticLimits = {
  readonly maxArrayItems: number
  readonly maxDepth: number
  readonly maxObjectKeys: number
}

type DiagnosticPolicy = {
  readonly formatString: (value: string) => string
  readonly errorFields?: (error: Error) => Record<string, unknown>
  /** Redacted on top of the default set, which a policy can widen but never narrow. */
  readonly extraSensitiveFields?: readonly string[]
  readonly limits?: DiagnosticLimits
}

type Walk = {
  readonly policy: DiagnosticPolicy
  readonly limits: DiagnosticLimits
  readonly sensitiveFields: ReadonlySet<string>
  readonly seen: WeakSet<object>
}

const unlimited: DiagnosticLimits = {
  maxArrayItems: Number.POSITIVE_INFINITY,
  maxDepth: Number.POSITIVE_INFINITY,
  maxObjectKeys: Number.POSITIVE_INFINITY,
}
const logPolicy = resolvePolicy({ formatString: limitDiagnosticString })

export function createDiagnosticSanitizer(policy: DiagnosticPolicy) {
  const resolved = resolvePolicy(policy)
  return (value: unknown) => sanitizeDiagnosticValue(value, 0, { ...resolved, seen: new WeakSet() })
}

/** Like `createDiagnosticSanitizer`, but the record's own fields sit at depth 0. */
export function createRecordSanitizer(policy: DiagnosticPolicy) {
  const resolved = resolvePolicy(policy)
  return (record: Record<string, unknown>) =>
    sanitizeFields(record, 0, { ...resolved, seen: new WeakSet() })
}

export function sanitizeRecord(record: Record<string, unknown>) {
  return sanitizeFields(record, 0, { ...logPolicy, seen: new WeakSet() })
}

function resolvePolicy(policy: DiagnosticPolicy): Omit<Walk, 'seen'> {
  return { policy, limits: policy.limits ?? unlimited, sensitiveFields: sensitiveFieldsFor(policy) }
}

function sensitiveFieldsFor(policy: DiagnosticPolicy): ReadonlySet<string> {
  if (!policy.extraSensitiveFields?.length) return sensitiveDiagnosticFields

  return new Set([...sensitiveDiagnosticFields, ...policy.extraSensitiveFields])
}

function sanitizeFields(record: Record<string, unknown>, depth: number, walk: Walk) {
  const safe: Record<string, unknown> = {}
  const entries = Object.entries(record).slice(0, walk.limits.maxObjectKeys)
  for (const [key, value] of entries) {
    safe[key] = walk.sensitiveFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(value, depth, walk)
  }
  return safe
}

function sanitizeDiagnosticValue(value: unknown, depth: number, walk: Walk): unknown {
  if (value instanceof Error) return sanitizeError(value, depth, walk)
  if (Array.isArray(value)) return sanitizeArray(value, depth, walk)
  if (typeof value === 'string') return walk.policy.formatString(value)
  if (!isRecord(value)) return value
  if (walk.seen.has(value)) return '[circular]'
  if (depth >= walk.limits.maxDepth) return '[truncated]'

  walk.seen.add(value)
  return sanitizeFields(value, depth + 1, walk)
}

function sanitizeArray(values: readonly unknown[], depth: number, walk: Walk) {
  if (depth >= walk.limits.maxDepth) return '[truncated]'

  return values
    .slice(0, walk.limits.maxArrayItems)
    .map((item) => sanitizeDiagnosticValue(item, depth + 1, walk))
}

function sanitizeError(error: Error, depth: number, walk: Walk) {
  if (walk.seen.has(error)) return '[circular]'

  walk.seen.add(error)
  return {
    cause: sanitizeDiagnosticValue(error.cause, depth + 1, walk),
    message: walk.policy.formatString(error.message),
    name: error.name,
    ...(walk.sensitiveFields.has('stack') ? {} : { stack: error.stack }),
    ...walk.policy.errorFields?.(error),
  }
}

export function limitDiagnosticString(value: string) {
  if (value.length <= maxStringLength) return value

  return value.slice(0, maxStringLength)
}
