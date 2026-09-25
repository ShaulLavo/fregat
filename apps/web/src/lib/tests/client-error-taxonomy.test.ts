import { EdenFetchError } from '@elysia/eden'
import { vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import {
  clientErrorText,
  reportError,
  thrownErrorMessage,
  toClientError,
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

test('stored failure text keeps the catalog why and fix', () => {
  const error = createEnvironmentProtocolMismatchError('https://mac.example/platform', 7, 6)
  expect(clientErrorText(error, 'fallback')).toBe(
    'The server at https://mac.example/platform uses an incompatible protocol version. This client requires protocol 7, but the server reported 6. Run matching client and server versions before reconnecting.',
  )
  expect(clientErrorText(new Error('plain'), 'fallback')).toBe('plain')
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
