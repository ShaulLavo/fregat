import {
  LSP_SERVER_EXITED,
  LspTransportClosedError,
  type LspManagedTransport,
  type LspServerExitedParams,
} from '@singapore-editor/lsp'
import type { LspTransportHandler } from '@singapore-editor/lsp/types'
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

test('a restart after an announced exit records what the exit said', async () => {
  const info = vi.spyOn(log, 'info')
  const transport = new AnnouncingTransport()
  const lease = languageServerConnectionProvider({
    origin: 'http://localhost:3001',
    rootPath: '/repo',
    serverId: 'typescript',
  }).acquire(
    {
      createTransport: () => transport,
      initializationOptions: undefined,
      reconnect: { delaysMs: [60_000] },
      rootUri: 'file:///repo',
      timeoutMs: 15_000,
    },
    {
      onConnected: () => undefined,
      onPublishDiagnostics: () => undefined,
      onUnavailable: () => undefined,
    },
  )
  await vi.waitFor(() => expect(transport.subscribed).toBe(true))

  transport.exitAndClose({
    outcome: 'process_exit',
    serverId: 'typescript',
    exitCode: null,
    exitSignal: 'SIGKILL',
    error: { code: 'lsp.SERVER_EXITED', message: 'The typescript language server stopped' },
  })

  expect(info).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'lsp.connection.reconnecting',
      exitCode: null,
      exitOutcome: 'process_exit',
      exitSignal: 'SIGKILL',
      serverFailed: true,
      serverId: 'typescript',
    }),
  )
  lease.release()
})

/** A socket whose server announces its exit and then closes, as the proxy does. */
class AnnouncingTransport implements LspManagedTransport {
  readonly #handlers = new Set<LspTransportHandler>()
  readonly #closeHandlers = new Set<(error?: unknown) => void>()

  get subscribed(): boolean {
    return this.#handlers.size > 0
  }

  send(): void {}

  subscribe(handler: LspTransportHandler): void {
    this.#handlers.add(handler)
  }

  unsubscribe(handler: LspTransportHandler): void {
    this.#handlers.delete(handler)
  }

  onDidClose(handler: (error?: unknown) => void): () => void {
    this.#closeHandlers.add(handler)
    return () => this.#closeHandlers.delete(handler)
  }

  close(): void {}

  exitAndClose(params: LspServerExitedParams): void {
    const notice = JSON.stringify({ jsonrpc: '2.0', method: LSP_SERVER_EXITED, params })
    for (const handler of this.#handlers) handler(notice)
    const closed = new LspTransportClosedError({
      code: 1000,
      reason: '',
      wasClean: true,
      sentCount: 1,
      receivedCount: 1,
    })
    for (const handler of this.#closeHandlers) handler(closed)
  }
}
