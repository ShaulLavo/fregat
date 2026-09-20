import { expect, test } from 'vitest'
import { createDiagnosticSanitizer, sanitizeRecord } from '../sanitize'

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
