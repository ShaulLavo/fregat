import { EdenFetchError } from '@elysia/eden'
import { afterEach, vi } from 'vitest'

import {
  languageServerConnectionProvider,
  resetLanguageServerConnectionPool,
} from '@/features/editor/state/language-server-connection-pool'
import { log } from '@/lib/client-logging'
import { expect, test } from '../../../../../test/fixtures'

afterEach(() => {
  resetLanguageServerConnectionPool()
  vi.restoreAllMocks()
})

test('a connection error thrown by Eden logs the server message', () => {
  const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
  const rejection = new EdenFetchError(502, {
    error: { code: 'lsp.SESSION_FAILED', message: 'Language server did not start' },
  })
  const lease = languageServerConnectionProvider({
    origin: 'http://localhost:3001',
    rootPath: '/repo',
    serverId: 'typescript',
  }).acquire(
    {
      createTransport: () => {
        throw rejection
      },
      initializationOptions: undefined,
      rootUri: 'file:///repo',
      timeoutMs: 15_000,
    },
    {
      onConnected: () => undefined,
      onPublishDiagnostics: () => undefined,
      onUnavailable: () => undefined,
    },
  )

  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'lsp.connection.error',
      error: 'Language server did not start',
    }),
  )
  lease.release()
})
