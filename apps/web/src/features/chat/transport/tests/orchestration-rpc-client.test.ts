import { OrchestrationRpcClient } from '@workspace/client-core/transport/orchestration-rpc-client'
import {
  environmentIdSchema,
  sessionIdSchema,
  type OrchestrationWsClientMessage,
} from '@workspace/contracts'
import { describe } from 'vitest'
import * as v from 'valibot'

import { isBlockedStreamError } from '@/features/chat/utils/stream-reconnect'
import { createOrchestrationRpcClient } from '@/features/chat/transport/orchestration-rpc-client'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'
import { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'
import { expect, test } from '../../../../../test/fixtures'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'

const ORIGIN = 'http://orchestration.test'
const HEARTBEAT_MS = 10
const HEARTBEAT_TIMEOUT_MS = 20
const SLOW_REQUEST_MS = 15
const SESSION_ID = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')

describe('orchestration rpc client liveness', () => {
  test('an unanswered heartbeat tears the socket down so subscriptions can reconnect', async () => {
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket)
    const failure = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())

    await tick()
    socket.open()
    await tick()

    expect(sentKinds(socket)).toEqual(['subscribe'])

    await sleep(HEARTBEAT_MS * 2)
    expect(sentKinds(socket)).toContain('ping')

    await sleep(HEARTBEAT_TIMEOUT_MS * 2)

    expect(await failure).toMatchObject({ status: 504 })
    expect(socket.closed).toBe(true)
  })

  test('answered heartbeats keep the socket alive', async () => {
    const socket = new FakeOrchestrationSocket()
    socket.autoPong = true
    const client = createClient(socket)
    const outcome = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())
    let settled = false
    void outcome.then(() => {
      settled = true
    })

    await tick()
    socket.open()
    await sleep(HEARTBEAT_MS * 6)

    expect(sentKinds(socket).filter((kind) => kind === 'ping').length).toBeGreaterThan(1)
    expect(settled).toBe(false)
    expect(socket.closed).toBe(false)
    client.close()
  })

  test('a silent clean close stays retryable', async () => {
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket)
    const failure = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())

    await tick()
    socket.open(false)
    await tick()
    socket.serverClose({ code: 1000, wasClean: true })

    expect(await failure).toMatchObject({ status: 499 })
  })
})

describe('orchestration rpc client transport boundary', () => {
  test('the socket offers no authoritative snapshot read', () => {
    const surface = Object.getOwnPropertyNames(OrchestrationRpcClient.prototype)

    // Frames are written in order, so a snapshot for a workspace with hundreds
    // of sessions would stall every ping, dispatch and subscription frame behind
    // it. Those two reads belong on `orchestration-http-snapshots.ts`; the
    // subscriptions still deliver `kind: 'snapshot'` frames, which is fine —
    // they are part of the ordered stream rather than a one-shot read.
    expect(surface).not.toContain('shellSnapshot')
    expect(surface).not.toContain('sessionDetailSnapshot')
  })
})

describe('orchestration rpc client connection identity', () => {
  test('the handshake tells the client which server process it reached', async () => {
    resetServerConnectionStore()
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket)
    void captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())

    await tick()
    socket.open()
    socket.deliver({ config: orchestrationServerConfig(), kind: 'connected' })

    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).serverInstanceId).toBe(
      'server-1',
    )
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).generation).toBe(1)

    // A restart under the same client is the case every server-derived cache
    // has to be told about; nothing else in the client can see it happen.
    socket.deliver({
      config: orchestrationServerConfig({ serverInstanceId: 'server-2' }),
      kind: 'connected',
    })

    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).generation).toBe(2)
    client.close()
  })

  test('a request that overruns says so, and stops saying so when it answers', async () => {
    resetServerConnectionStore()
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket, latencyOnly())
    const page = captureOutcome(client.sessionDetailPage({ sessionId: SESSION_ID }))

    await tick()
    socket.open()
    // The slow timer is armed as the request is written, so waiting on the
    // frame is what makes the timing assertion below deterministic under load.
    await waitForRequest(socket)
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(0)

    await sleep(SLOW_REQUEST_MS * 2)
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(1)

    const requestId = sentMessages(socket).find((message) => message.kind === 'request')?.requestId
    socket.deliver({ data: {}, kind: 'response', ok: true, requestId })
    await page

    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(0)
    client.close()
  })

  test('overdue requests from concurrent owners are counted and cleared independently', async () => {
    resetServerConnectionStore()
    const socketA = new FakeOrchestrationSocket()
    const socketB = new FakeOrchestrationSocket()
    const clientA = createClient(socketA, latencyOnly())
    const clientB = createClient(socketB, latencyOnly())
    const first = captureOutcome(clientA.sessionDetailPage({ sessionId: SESSION_ID }))
    const second = captureOutcome(clientB.sessionDetailPage({ sessionId: SESSION_ID }))
    await tick()
    socketA.open()
    socketB.open()
    await Promise.all([waitForRequest(socketA), waitForRequest(socketB)])
    await sleep(SLOW_REQUEST_MS * 2)
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(2)

    clientA.close()
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(1)
    clientB.close()
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(0)
    await Promise.all([first, second])
  })

  test('a dropped socket clears the overdue requests it stranded', async () => {
    resetServerConnectionStore()
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket, latencyOnly())
    const failure = captureOutcome(client.sessionDetailPage({ sessionId: SESSION_ID }))

    await tick()
    socket.open()
    await waitForRequest(socket)
    await sleep(SLOW_REQUEST_MS * 2)
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(1)

    socket.serverClose({ code: 1006, wasClean: false })
    await failure

    // Otherwise the panel keeps counting a request that can never answer.
    expect(selectServerConnection(useEnvironmentsStore.getState(), ORIGIN).slowRequestCount).toBe(0)
  })
})

/**
 * Liveness pushed out of the way so a latency test measures only latency. With
 * the default test heartbeat, an unanswered ping tears the socket down at 30ms
 * — the same moment a 15ms slow timer is being asserted on, and the teardown
 * clears exactly the state under test.
 */
function latencyOnly() {
  return {
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 10_000,
    slowRequestMs: SLOW_REQUEST_MS,
  }
}

function createClient(
  socket: FakeOrchestrationSocket,
  overrides: {
    heartbeatIntervalMs?: number
    heartbeatTimeoutMs?: number
    slowRequestMs?: number
  } = {},
) {
  return createOrchestrationRpcClient({
    createSocket: () => socket,
    heartbeatIntervalMs: HEARTBEAT_MS,
    heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    origin: ORIGIN,
    ...overrides,
  })
}

/** Sending goes through `await connect()`, so it lands some microtasks after `open()`. */
async function waitForRequest(socket: FakeOrchestrationSocket) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (sentKinds(socket).includes('request')) return

    await tick()
  }

  expect.unreachable('the client never sent the request')
}

function sentMessages(socket: FakeOrchestrationSocket) {
  return socket.sent.map((raw) => JSON.parse(raw) as OrchestrationWsClientMessage)
}

function sentKinds(socket: FakeOrchestrationSocket) {
  return sentMessages(socket).map((message) => message.kind)
}

/** Settles with the rejection reason so nothing sits unhandled while a test sleeps. */
function captureOutcome(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (error: unknown) => error,
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tick() {
  return sleep(0)
}

describe('orchestration rpc permanent close', () => {
  test('protocol 999 blocks subscriptions and commands before sending any frames', async () => {
    const origin = 'http://LOCALHOST:37779/'
    const socket = new FakeOrchestrationSocket()
    const urls: string[] = []
    const client = createOrchestrationRpcClient({
      origin,
      createSocket: (url) => {
        urls.push(url)
        return socket
      },
    })
    const stream = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())
    const command = captureOutcome(
      client.dispatchCommand(createWorkspaceProjectCommand({ rootPath: 'project' })),
    )
    await tick()
    socket.open(false)
    socket.deliver({
      kind: 'connected',
      config: orchestrationServerConfig({ protocolVersion: 999 }),
    })

    const commandFailure = await command
    expect(commandFailure).toMatchObject({ code: 'ENVIRONMENT_PROTOCOL_MISMATCH', status: 403 })
    expect(await stream).toMatchObject({ code: 'ENVIRONMENT_PROTOCOL_MISMATCH', status: 403 })
    expect(isBlockedStreamError(commandFailure)).toBe(true)
    expect(socket.sent).toEqual([])
    expect(socket.closed).toBe(true)
    expect(urls).toEqual(['ws://localhost:37779/orchestration/rpc'])
    expect(selectServerConnection(useEnvironmentsStore.getState(), origin)).toMatchObject({
      phase: 'protocol-mismatch',
      generation: 0,
      serverInstanceId: null,
    })
    expect(
      useEnvironmentsStore.getState().entries['http://localhost:37779']?.environmentId,
    ).toBeUndefined()
    client.close()
  })

  test.each([false, true])(
    'close settles streams and requests with socket open=%s',
    async (open) => {
      const socket = new FakeOrchestrationSocket()
      let socketCount = 0
      const client = createOrchestrationRpcClient({
        origin: ORIGIN,
        createSocket: () => {
          socketCount += 1
          return socket
        },
        heartbeatIntervalMs: 10_000,
      })
      const stream = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())
      const request = captureOutcome(client.sessionDetailPage({ sessionId: SESSION_ID }))
      await tick()
      if (open) socket.open()
      await tick()
      client.close()
      client.close()
      expect(await stream).toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
      expect(await request).toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
      const frameCount = socket.sent.length
      socket.open()
      await tick()
      expect(socket.sent).toHaveLength(frameCount)
      expect(client.closed).toBe(true)
      expect(
        await captureOutcome(client.sessionDetailPage({ sessionId: SESSION_ID })),
      ).toMatchObject({
        code: 'ORCHESTRATION_RPC_CLOSED',
      })
      expect(socketCount).toBe(1)
    },
  )

  test('1008 blocks retry even when the socket sent no frames', async () => {
    const socket = new FakeOrchestrationSocket()
    const client = createClient(socket)
    const result = captureOutcome(client.shellStream()[Symbol.asyncIterator]().next())
    await tick()
    socket.open(false)
    socket.serverClose({ code: 1008, wasClean: true })
    const failure = await result
    expect(failure).toMatchObject({ status: 401 })
    expect(isBlockedStreamError(failure)).toBe(true)
    client.close()
  })

  test('identity drift rejects before sending a command or accepting projection data', async () => {
    const origin = 'http://identity-drift.test'
    useEnvironmentsStore.getState().recordHandshake(origin, orchestrationServerConfig())
    const socket = new FakeOrchestrationSocket()
    const client = createOrchestrationRpcClient({
      origin,
      createSocket: () => socket,
    })
    const result = captureOutcome(client.sessionDetailPage({ sessionId: SESSION_ID }))
    await tick()
    socket.open(false)
    expect(socket.sent).toEqual([])
    socket.deliver({
      kind: 'connected',
      config: orchestrationServerConfig({
        environmentId: v.parse(environmentIdSchema, 'a4ed57c5-1f10-4f56-8f9b-893740aab7db'),
      }),
    })
    expect(await result).toMatchObject({ code: 'ENVIRONMENT_IDENTITY_DRIFT', status: 403 })
    expect(selectServerConnection(useEnvironmentsStore.getState(), origin).phase).toBe(
      'identity-drift',
    )
    expect(socket.sent).toEqual([])
    expect(socket.closed).toBe(true)
    client.close()
  })
})
