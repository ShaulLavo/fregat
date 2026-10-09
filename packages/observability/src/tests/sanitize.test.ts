import { expect, test } from 'vitest'
import { createError } from 'evlog'
import {
  createDiagnosticSanitizer,
  createRecordSanitizer,
  sanitizeRecord,
  sensitiveDiagnosticFields,
} from '../sanitize'

test('log sanitization truncates nested messages while retaining full error stacks', () => {
  const message = 'm'.repeat(2500)
  const failure = Object.assign(new Error(message), { code: 'NOT_LOGGED' })
  const safe = sanitizeRecord({ message, failures: [failure], context: { token: 'secret' } })

  expect(safe).toMatchObject({
    message: message.slice(0, 2000),
    failures: [{ message: message.slice(0, 2000), stack: failure.stack }],
    context: { token: '[redacted]' },
  })
  expect(safe.failures).toEqual([
    { cause: undefined, message: message.slice(0, 2000), name: 'Error', stack: failure.stack },
  ])
})

test('custom sanitization keeps its string and error policies throughout nested causes', () => {
  const message = 'm'.repeat(2500)
  const nested = new Error(message)
  const failure = new Error(message, { cause: nested })
  nested.cause = failure
  const sanitize = createDiagnosticSanitizer({
    formatString: (value) => value,
    errorFields: () => ({ code: 'REPORT_ONLY' }),
  })

  expect(sanitize({ message, failure, items: [{ password: 'private' }] })).toMatchObject({
    message,
    failure: {
      message,
      code: 'REPORT_ONLY',
      cause: { message, code: 'REPORT_ONLY', cause: '[circular]' },
    },
    items: [{ password: '[redacted]' }],
  })
})

test('every default sensitive key redacts with no policy options', () => {
  const record = Object.fromEntries(
    Array.from(sensitiveDiagnosticFields, (key) => [key, 'private']),
  )
  const redacted = Object.fromEntries(Object.keys(record).map((key) => [key, '[redacted]']))
  const sanitize = createDiagnosticSanitizer({ formatString: (value) => value })

  expect(sensitiveDiagnosticFields.size).toBe(17)
  expect(sanitizeRecord(record)).toEqual(redacted)
  expect(sanitize({ nested: record })).toEqual({ nested: redacted })
})

test('a capped record policy bounds depth, arrays and keys and drops the stack it redacts', () => {
  const sanitize = createRecordSanitizer({
    formatString: (value) => value,
    extraSensitiveFields: ['stack'],
    limits: { maxArrayItems: 2, maxDepth: 1, maxObjectKeys: 2 },
  })

  expect(
    sanitize({
      error: new Error('failed'),
      items: [1, 2, 3],
      nested: { a: { b: 1 }, c: 2, d: 3 },
    }),
  ).toEqual({
    error: { cause: undefined, message: 'failed', name: 'Error' },
    items: [1, 2],
  })
  expect(sanitize({ nested: { a: { b: 1 }, token: 'private' } })).toEqual({
    nested: { a: '[truncated]', token: '[redacted]' },
  })
})

test('an object two fields share is logged at both, and only a cycle is circular', () => {
  const shared = { kind: 'document', path: 'main/keep.txt' }
  const cycle: Record<string, unknown> = { name: 'loop' }
  cycle.self = cycle

  expect(sanitizeRecord({ requested: shared, selected: shared, cycle })).toEqual({
    requested: shared,
    selected: shared,
    cycle: { name: 'loop', self: '[circular]' },
  })
})

test('log sanitization retains non-enumerable internal context and sanitizes it recursively', () => {
  const nested = createError({ message: 'child failure', internal: { exitCode: 7 } })
  const internal = { observed: 'stopped', token: 'PRIVATE_TOKEN', failure: nested }
  const failure = createError({ message: 'failure', internal })
  internal.failure.cause = failure

  expect(Object.keys(failure)).not.toContain('internal')
  expect(sanitizeRecord({ error: failure })).toMatchObject({
    error: {
      internal: {
        observed: 'stopped',
        token: '[redacted]',
        failure: { internal: { exitCode: 7 }, cause: '[circular]' },
      },
    },
  })
  expect(failure.internal).toBe(internal)
  expect(JSON.stringify(failure)).not.toContain('internal')
})

test('internal context obeys the diagnostic policy limits and sensitive fields', () => {
  const failure = createError({
    message: 'Synthetic failure',
    internal: { state: { observed: 'stopped' }, token: 'PRIVATE_TOKEN' },
  })
  const bounded = createDiagnosticSanitizer({
    formatString: (value) => value,
    limits: { maxArrayItems: 2, maxDepth: 1, maxObjectKeys: 2 },
  })
  const privateContext = createDiagnosticSanitizer({
    formatString: (value) => value,
    extraSensitiveFields: ['internal'],
  })
  expect(bounded(failure)).toMatchObject({ internal: '[truncated]' })
  expect(privateContext(failure)).toMatchObject({ internal: '[redacted]' })
})

test('diagnostics omit throwing getters and read retained getters once', () => {
  let reads = 0
  const error = createError({ message: 'Synthetic failure' })
  Object.defineProperty(error, 'internal', {
    get: () => {
      throw error
    },
  })
  const context = Object.defineProperties(
    {},
    {
      observed: {
        enumerable: true,
        get: () => {
          reads++
          return 'stopped'
        },
      },
      unavailable: {
        enumerable: true,
        get: () => {
          throw error
        },
      },
      token: {
        enumerable: true,
        get: () => {
          throw error
        },
      },
    },
  )
  expect(sanitizeRecord({ error, context })).toMatchObject({
    error: { message: 'Synthetic failure' },
    context: { observed: 'stopped', token: '[redacted]' },
  })
  expect(reads).toBe(1)
})

test('cyclic arrays in internal context retain shared arrays', () => {
  const items: unknown[] = ['ready']
  items.push(items)
  const error = createError({ message: 'Synthetic failure', internal: { items, shared: items } })
  expect(sanitizeRecord({ error })).toMatchObject({
    error: { internal: { items: ['ready', '[circular]'], shared: ['ready', '[circular]'] } },
  })
})

test('array-element getters become diagnostic placeholders', () => {
  const items = ['ready']
  Object.defineProperty(items, 1, {
    get: () => {
      throw createError('Synthetic getter failure')
    },
  })
  const failure = createError({ message: 'Synthetic failure', internal: { items } })
  expect(sanitizeRecord({ failure })).toMatchObject({
    failure: { internal: { items: ['ready', '[unreadable: getter threw]'] } },
  })
})

test.each(['message', 'name', 'stack', 'cause'])(
  'nested error %s getters become diagnostic placeholders',
  (field) => {
    const nested = createError('Synthetic nested failure')
    void nested.stack
    Object.defineProperty(nested, field, {
      get: () => {
        throw createError('Synthetic getter failure')
      },
    })
    const failure = createError({ message: 'Synthetic failure', internal: { nested } })
    expect(sanitizeRecord({ failure })).toMatchObject({
      failure: { internal: { nested: { [field]: '[unreadable: getter threw]' } } },
    })
  },
)
