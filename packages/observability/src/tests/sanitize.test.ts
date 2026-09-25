import { expect, test } from 'vitest'
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
  const record = Object.fromEntries([...sensitiveDiagnosticFields].map((key) => [key, 'private']))
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
