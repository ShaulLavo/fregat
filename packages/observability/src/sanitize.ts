import { isObject, isRecord } from '@workspace/utils/objects'
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

export function errorInternalContext(error: unknown): Record<string, unknown> | undefined {
  if (!isRecord(error)) return undefined

  const internal = readDiagnosticField(error, 'internal')
  return isRecord(internal) ? internal : undefined
}

/** Diagnostic getters are optional evidence; their failures cannot replace the operation's error. */
export function readDiagnosticField(record: unknown, key: string | number): unknown {
  if (!isObject(record)) return undefined

  try {
    return record[key]
  } catch {
    return '[unreadable: getter threw]'
  }
}

export function readDiagnosticStringField(record: unknown, key: string) {
  const value = readDiagnosticField(record, key)
  return typeof value === 'string' ? value : undefined
}

export function readDiagnosticNumberField(record: unknown, key: string) {
  const value = readDiagnosticField(record, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function sanitizeRecord(record: Record<string, unknown>) {
  return sanitizeFields(record, 0, { ...logPolicy, seen: new WeakSet() })
}

function resolvePolicy(policy: DiagnosticPolicy): Omit<Walk, 'seen'> {
  return { policy, limits: policy.limits ?? unlimited, sensitiveFields: sensitiveFieldsFor(policy) }
}

function sensitiveFieldsFor(policy: DiagnosticPolicy): ReadonlySet<string> {
  if (!policy.extraSensitiveFields?.length) return sensitiveDiagnosticFields

  return new Set(Array.from(sensitiveDiagnosticFields).concat(policy.extraSensitiveFields))
}

function sanitizeFields(record: Record<string, unknown>, depth: number, walk: Walk) {
  const safe: Record<string, unknown> = {}
  const keys = Object.keys(record).slice(0, walk.limits.maxObjectKeys)
  for (const key of keys) {
    safe[key] = walk.sensitiveFields.has(key)
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(readDiagnosticField(record, key), depth, walk)
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

  // `seen` holds the ancestors only: an object reached twice by two fields is shared, not a cycle.
  walk.seen.add(value)
  const safe = sanitizeFields(value, depth + 1, walk)
  walk.seen.delete(value)
  return safe
}

function sanitizeArray(values: readonly unknown[], depth: number, walk: Walk) {
  if (walk.seen.has(values)) return '[circular]'
  if (depth >= walk.limits.maxDepth) return '[truncated]'

  walk.seen.add(values)
  const length = readDiagnosticField(values, 'length')
  const count = typeof length === 'number' ? Math.min(length, walk.limits.maxArrayItems) : 0
  const safe: unknown[] = []
  for (let index = 0; index < count; index++) {
    safe.push(sanitizeDiagnosticValue(readDiagnosticField(values, index), depth + 1, walk))
  }
  walk.seen.delete(values)
  return safe
}

function sanitizeError(error: Error, depth: number, walk: Walk) {
  if (walk.seen.has(error)) return '[circular]'

  walk.seen.add(error)
  const internal = errorInternalContext(error)
  const safe: Record<string, unknown> = {
    cause: sanitizeDiagnosticValue(readDiagnosticField(error, 'cause'), depth + 1, walk),
    message: walk.policy.formatString(readDiagnosticStringField(error, 'message') ?? ''),
    name: readDiagnosticStringField(error, 'name') ?? 'Error',
    ...(walk.sensitiveFields.has('stack') ? {} : { stack: readDiagnosticField(error, 'stack') }),
    ...walk.policy.errorFields?.(error),
  }
  if (internal !== undefined) {
    safe.internal = walk.sensitiveFields.has('internal')
      ? redactedDiagnosticValue
      : sanitizeDiagnosticValue(internal, depth + 1, walk)
  }
  walk.seen.delete(error)
  return safe
}

export function limitDiagnosticString(value: string) {
  if (value.length <= maxStringLength) return value

  return value.slice(0, maxStringLength)
}
