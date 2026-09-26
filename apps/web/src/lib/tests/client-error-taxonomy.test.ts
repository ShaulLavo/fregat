import { EdenFetchError } from '@elysia/eden'
import { vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import {
  reportError,
  thrownErrorMessage,
  toClientError,
  toConnectionError,
} from '@/lib/client-error-taxonomy'
import { createEnvironmentProtocolMismatchError } from '@workspace/client-core/environments/utils/structured-errors'
import { log, observeClientOperation } from '@/lib/client-logging'
import { sanitizeRecord } from '@workspace/observability/sanitize'

test('classifies fetch failures and carries request context into the client error', async () => {
  const error = new TypeError('network error')
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})

  try {
    await expect(
      observeClientOperation(
        {
          action: 'fs.read',
          area: 'fs',
          method: 'GET',
          path: 'src/app.ts',
          route: '/fs/read',
        },
        async () => Promise.reject(error),
      ),
    ).rejects.toBe(error)
  } finally {
    warn.mockRestore()
  }

  expect(toClientError(error)).toMatchObject({
    category: 'connectivity',
    context: {
      method: 'GET',
      path: 'src/app.ts',
      route: '/fs/read',
    },
    message: 'Could not reach the server.',
    operation: 'fs.read',
  })
})

test('reports connectivity below error and retains path and stack diagnostics', () => {
  const error = new TypeError('network error')
  const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {})
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})

  try {
    reportError({
      category: 'connectivity',
      cause: error,
      context: {
        authorization: 'Bearer secret',
        method: 'GET',
        path: 'src/app.ts',
        route: '/fs/read',
      },
      message: 'Could not reach the server.',
      operation: 'fs.read',
    })

    expect(errorLog).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: expect.objectContaining({ stack: error.stack }),
        context: {
          authorization: '[redacted]',
          method: 'GET',
          path: 'src/app.ts',
          route: '/fs/read',
        },
      }),
    )
  } finally {
    errorLog.mockRestore()
    warn.mockRestore()
  }

  expect(
    sanitizeRecord({
      authorization: 'Bearer secret',
      path: 'src/app.ts',
      stack: error.stack,
      token: 'secret',
    }),
  ).toEqual({
    authorization: '[redacted]',
    path: 'src/app.ts',
    stack: error.stack,
    token: '[redacted]',
  })
})

test('does not report aborted operations', () => {
  const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {})
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})

  try {
    reportError(toClientError(new DOMException('Aborted', 'AbortError')))

    expect(errorLog).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  } finally {
    errorLog.mockRestore()
    warn.mockRestore()
  }
})

test('a connection failure keeps the catalog code, why and fix', () => {
  const error = createEnvironmentProtocolMismatchError('https://mac.example/platform', 7, 6)
  expect(toConnectionError(error, 'fallback')).toEqual({
    code: 'ENVIRONMENT_PROTOCOL_MISMATCH',
    message:
      'The server at https://mac.example/platform speaks protocol 6, and this client needs protocol 7.',
    why: 'That server runs an older Platform version than this client.',
    fix: 'Update the Platform server at https://mac.example/platform to this client’s version, then Retry.',
  })
  expect(toConnectionError(new Error('plain'), 'fallback')).toEqual({
    code: 'CONNECTION_FAILED',
    message: 'plain',
  })
})

test('a thrown message keeps the words of an Error and never stringifies an Eden rejection', () => {
  const structured = new EdenFetchError(502, {
    error: { code: 'lsp.SESSION_FAILED', message: 'Language server did not start' },
  })
  const fsCoded = new EdenFetchError(404, { error: { code: 'NOT_FOUND' } })

  expect(structured.message).toBe('[object Object]')
  expect(thrownErrorMessage(structured)).toBe('Language server did not start')
  expect(thrownErrorMessage(fsCoded)).toBe('The requested file or folder could not be found.')
  expect(thrownErrorMessage(new EdenFetchError(500, { detail: 'x' }))).toBe(
    'Something unexpected went wrong.',
  )
  expect(thrownErrorMessage(new EdenFetchError(500, 'Upstream timed out'))).toBe(
    'Upstream timed out',
  )
  expect(thrownErrorMessage(new Error('socket closed'))).toBe('socket closed')
  expect(thrownErrorMessage(new Error(''))).toBe('Something unexpected went wrong.')
})

test('fs codes read through the shared peel, then off a bare top-level code', () => {
  expect(toClientError(new EdenFetchError(404, { error: { code: 'NOT_FOUND' } })).category).toBe(
    'not_found',
  )
  expect(toClientError({ code: 'FILE_TOO_LARGE', value: 'Payload Too Large' }).category).toBe(
    'too_large',
  )
  expect(toClientError({ error: { code: 7, message: 'numeric code' } }).category).toBe('unknown')
})
