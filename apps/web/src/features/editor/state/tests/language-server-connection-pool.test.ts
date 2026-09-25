import { createWebSocketLspTransport } from '@singapore-editor/lsp'
import type { LspConnectionOptions } from '@singapore-editor/lsp-plugin'
import { afterEach, onTestFinished, vi } from 'vitest'

import {
  languageServerConnectionProvider,
  resetLanguageServerConnectionPool,
} from '@/features/editor/state/language-server-connection-pool'
import {
  environmentActivitySignal,
  resumeEnvironmentActivity,
  suspendEnvironmentActivity,
} from '@/lib/environments/state/activity'
import { languageServerWebSocketConstructor } from '@/lib/server-sockets'
import { recordClientLog } from '../../../../../test/factories/client-log'
import { expect, test } from '../../../../../test/fixtures'

afterEach(resetLanguageServerConnectionPool)

const ROUTE = 'ws://localhost/lsp?root=/repo&path=src/index.ts&server=typescript'
/** The pool's own idle grace, after which it closes a connection nobody borrows. */
const IDLE_GRACE_MS = 30_000

test('a clean close recovers at debug, and giving up after clean closes warns', async () => {
  const log = recordLevels()
  const { sockets } = connectThroughSockets('/repo/clean-closes', { delaysMs: [0] })

  await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThan(0))
  sockets[0]?.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }))
  expect(log.debug.events('lsp.connection.reconnecting')).toEqual([
    expect.objectContaining({ code: 1000, wasClean: true }),
  ])

  await vi.waitFor(() => expect(sockets[1]?.sent.length).toBeGreaterThan(0))
  sockets[1]?.dispatchEvent(new CloseEvent('close', { code: 1000, wasClean: true }))

  expect(log.warn.events('lsp.connection.error')).toEqual([
    expect.objectContaining({ code: 1000, error: 'LSP transport closed (1000)', wasClean: true }),
  ])
  expect(log.info.events('lsp.connection.error')).toEqual([])
})

test('an abnormal close keeps the connection error at warn', async () => {
  const log = recordLevels()
  const { sockets } = connectThroughSockets('/repo/abnormal-close')

  await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThan(0))
  sockets[0]?.dispatchEvent(new CloseEvent('close', { code: 1006, wasClean: false }))

  expect(log.warn.events('lsp.connection.error')).toEqual([
    expect.objectContaining({ code: 1006, wasClean: false }),
  ])
  expect(log.info.events('lsp.connection.error')).toEqual([])
})

test('an idle connection the pool closed reports closed and no error', async () => {
  const log = recordLevels()
  const { sockets, lease } = connectThroughSockets('/repo/idle-close')

  await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThan(0))
  vi.useFakeTimers()
  onTestFinished(() => {
    vi.useRealTimers()
  })
  lease.release()
  vi.advanceTimersByTime(IDLE_GRACE_MS)
  sockets[0]?.dispatchEvent(new CloseEvent('close', { code: 1006, wasClean: false }))

  expect(log.info.events('lsp.connection.closed')).toHaveLength(1)
  expect(log.info.events('lsp.connection.error')).toEqual([])
  expect(log.warn.events('lsp.connection.error')).toEqual([])
})

test('a pool reset closes its connections without an error', async () => {
  const log = recordLevels()
  const { sockets } = connectThroughSockets('/repo/reset')

  await vi.waitFor(() => expect(sockets[0]?.sent.length).toBeGreaterThan(0))
  resetLanguageServerConnectionPool()
  sockets[0]?.dispatchEvent(new CloseEvent('close', { code: 1006, wasClean: false }))

  expect(log.info.events('lsp.connection.error')).toEqual([])
  expect(log.warn.events('lsp.connection.error')).toEqual([])
})

test('a socket this side refused for a suspended environment logs at info', async ({ client }) => {
  const log = recordLevels()
  const origin = 'http://localhost:3999'
  suspendEnvironmentActivity(origin)
  onTestFinished(() => resumeEnvironmentActivity(origin))
  const WebSocketCtor = languageServerWebSocketConstructor(
    client,
    environmentActivitySignal(origin),
  )

  acquire({ origin, rootPath: '/repo/suspended' }, () =>
    createWebSocketLspTransport(ROUTE, { WebSocketCtor }),
  )

  expect(log.info.events('lsp.connection.error')).toHaveLength(1)
  expect(log.warn.events('lsp.connection.error')).toEqual([])
})

function recordLevels() {
  return {
    debug: recordClientLog('debug'),
    info: recordClientLog('info'),
    warn: recordClientLog('warn'),
  }
}

/** The socket is the boundary: the transport, connection and pool above it are the real ones. */
function connectThroughSockets(rootPath: string, reconnect?: LspConnectionOptions['reconnect']) {
  const sockets: TestSocket[] = []
  class TestSocket extends EventTarget {
    readonly readyState = 1
    readonly sent: string[] = []

    constructor() {
      super()
      sockets.push(this)
    }

    send(message: string) {
      this.sent.push(message)
    }

    close() {}
  }

  const lease = acquire(
    { origin: 'http://localhost:3001', rootPath },
    () => createWebSocketLspTransport(ROUTE, { WebSocketCtor: TestSocket }),
    reconnect,
  )
  return { lease, sockets }
}

function acquire(
  key: { readonly origin: string; readonly rootPath: string },
  createTransport: LspConnectionOptions['createTransport'],
  reconnect?: LspConnectionOptions['reconnect'],
) {
  return languageServerConnectionProvider({ ...key, serverId: 'typescript' }).acquire(
    {
      createTransport,
      initializationOptions: undefined,
      reconnect,
      rootUri: 'file:///repo',
      timeoutMs: 15_000,
    },
    {
      onConnected: () => undefined,
      onPublishDiagnostics: () => undefined,
      onUnavailable: () => undefined,
    },
  )
}
