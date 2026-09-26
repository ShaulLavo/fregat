import { TUI_CLIENT_ORIGIN } from '@workspace/contracts'

import { expect, test } from '../../../test/fixtures'

import { connectionFailure } from '@/connection/utils/failure'

const originFix = `Register ${TUI_CLIENT_ORIGIN} in SERVER_ALLOWED_ORIGINS and restart the server.`
const retryFix = 'Check the server address and connection, then press Ctrl+R to retry.'
const unreachable = 'Could not reach the Platform server.'

// Eden's EdenFetchError: an Error whose message is `String(value)`.
function edenError(status: number, value: unknown) {
  return Object.assign(new Error(String(value)), { status, value })
}

test.each([
  {
    name: 'a structured envelope',
    error: edenError(403, {
      error: { code: 'FORBIDDEN_ORIGIN', message: 'origin is not allowed' },
    }),
    expected: { code: 'FORBIDDEN_ORIGIN', fix: originFix, message: 'origin is not allowed' },
  },
  {
    name: 'an envelope carrying its own fix',
    error: edenError(404, { error: { code: 'NOT_FOUND', fix: 'Pick a file.', message: 'gone' } }),
    expected: { code: 'NOT_FOUND', fix: 'Pick a file.', message: 'gone' },
  },
  {
    name: 'a thrown Error',
    error: new Error('socket closed'),
    expected: { code: 'TUI_CONNECTION_FAILED', fix: retryFix, message: 'socket closed' },
  },
  {
    name: 'a string body',
    error: edenError(502, 'Bad Gateway'),
    expected: { code: 'TUI_CONNECTION_FAILED', fix: retryFix, message: unreachable },
  },
  {
    name: 'an array body',
    error: edenError(500, [{ error: { code: 'NOT_FOUND', message: 'gone' } }]),
    expected: { code: 'TUI_CONNECTION_FAILED', fix: retryFix, message: unreachable },
  },
])('reads $name through the shared RPC peel', ({ error, expected }) => {
  expect(connectionFailure(error)).toEqual(expected)
})
