import { orchestrationWsClientMessageSchema } from '@workspace/contracts'
import { expect, test, vi } from 'vitest'
import * as v from 'valibot'

import { orchestrationServerConfig } from '../../../test/orchestration-server-config'
import { FakeOrchestrationSocket } from '../../../test/orchestration-socket'
import { rpcClientFixture } from '../../../test/rpc-client'

const CONNECTION = 'orchestration.ws.connection.summary'
const SERIES = 'orchestration.ws.failure_series.summary'
const SUBSCRIPTION = 'orchestration.ws.subscription.summary'

test('a paused host opens one socket for every waiting caller once it resumes', async () => {
  const { sockets, createSocket } = socketFactory()
  let resume = () => {}
  let paused = true
  const fixture = rpcClientFixture({
    createSocket,
    beforeConnect() {
      if (!paused) return undefined
      return new Promise<void>((resolve) => {
        resume = () => {
          paused = false
          resolve()
        }
      })
    },
  })
  const first = fixture.client.ready()
  const second = fixture.client.ready()
  await sleep(10)
  expect(sockets).toHaveLength(0)

  resume()
  await vi.waitFor(() => expect(sockets).toHaveLength(1))
  sockets[0]!.open()
  await Promise.all([first, second])
  expect(sockets).toHaveLength(1)
  sockets[0]!.transportFailure()
  const connection = fixture.events.find((event) => event.action === CONNECTION)
  expect(connection?.pausedMs).toBeGreaterThan(0)
})

test('closing the client releases a caller held by the pause', async () => {
  const { sockets, createSocket } = socketFactory()
  const fixture = rpcClientFixture({
    createSocket,
    beforeConnect: (signal) =>
      new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  })
  const ready = fixture.client.ready().catch((error: unknown) => error)
  fixture.client.close()

  expect(await ready).toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
  expect(sockets).toHaveLength(0)
})

test('a failure series warns once and summarizes when a socket answers a heartbeat', async () => {
  const { sockets, createSocket } = socketFactory()
  const fixture = rpcClientFixture({ createSocket, heartbeatIntervalMs: 5 })
  const first = fixture.client.ready()
  sockets[0]!.open()
  await first
  sockets[0]!.transportFailure()
  const second = fixture.client.ready().catch((error: unknown) => error)
  sockets[1]!.serverClose({ code: 1006, wasClean: false })
  expect(await second).toMatchObject({ code: 'ORCHESTRATION_WS_CLOSED' })
  expect(eventsOf(fixture.events, SERIES)).toEqual([])

  const third = fixture.client.ready()
  sockets[2]!.open(false)
  sockets[2]!.deliver({
    kind: 'connected',
    config: orchestrationServerConfig({ serverInstanceId: 'server-2' }),
  })
  await third
  await vi.waitFor(() => expect(eventsOf(fixture.events, SERIES)).toHaveLength(1))

  expect(eventsOf(fixture.events, CONNECTION)).toEqual([
    expect.objectContaining({
      level: 'warn',
      warning: 'Orchestration WebSocket transport error.',
      failureSeries: { count: 1 },
    }),
    expect.objectContaining({ level: 'info', code: 1006, failureSeries: { count: 2 } }),
  ])
  expect(eventsOf(fixture.events, SERIES)).toEqual([
    expect.objectContaining({
      level: 'info',
      failureCount: 2,
      recovered: true,
      serverRestarted: true,
    }),
  ])
})

test.each([1000, 1001, 1012])('a socket closed with %i logs at info', async (code) => {
  const { sockets, createSocket } = socketFactory()
  const fixture = rpcClientFixture({ createSocket })
  const controller = new AbortController()
  const next = fixture.client
    .shellStream({ signal: controller.signal })
    [Symbol.asyncIterator]()
    .next()
    .catch((error: unknown) => error)
  sockets[0]!.open()
  await vi.waitFor(() => expect(sockets[0]!.sent).toHaveLength(1))
  sockets[0]!.serverClose({ code, wasClean: true })

  expect(await next).toMatchObject({ code: 'ORCHESTRATION_WS_CLOSED' })
  expect(eventsOf(fixture.events, CONNECTION)).toEqual([
    expect.objectContaining({ code, level: 'info' }),
  ])
  expect(eventsOf(fixture.events, SUBSCRIPTION)).toEqual([
    expect.objectContaining({
      failure: expect.objectContaining({ code: 'ORCHESTRATION_WS_CLOSED' }),
    }),
  ])
  expect(eventsOf(fixture.events, SUBSCRIPTION)[0]).toMatchObject({ level: 'info' })
})

test('reconnect failures during an announced restart stay at info', async () => {
  const { sockets, createSocket } = socketFactory()
  const fixture = rpcClientFixture({ createSocket, heartbeatIntervalMs: 5 })
  const first = fixture.client.ready()
  sockets[0]!.open()
  await first
  sockets[0]!.serverClose({ code: 1012, wasClean: true })
  const retry = fixture.client.ready().catch((error: unknown) => error)
  sockets[1]!.transportFailure()
  await retry
  const recovered = fixture.client.ready()
  sockets[2]!.open()
  await recovered
  await vi.waitFor(() => expect(eventsOf(fixture.events, SERIES)).toHaveLength(1))

  expect(eventsOf(fixture.events, CONNECTION).map((event) => event.level)).toEqual(['info', 'info'])
  expect(eventsOf(fixture.events, SERIES)[0]).toMatchObject({
    announcedRestart: true,
    failureCount: 2,
    level: 'info',
    recovered: true,
  })
})

test('an ACK-timeout close resumes on a new socket from the consumed cursor', async () => {
  const { sockets, createSocket } = socketFactory()
  const fixture = rpcClientFixture({ createSocket })
  const controller = new AbortController()
  const iterator = fixture.client.shellStream({ signal: controller.signal })[Symbol.asyncIterator]()
  const first = iterator.next()
  sockets[0]!.open()
  const { subscriptionId } = await nthSubscribe(sockets[0]!, 1)
  sockets[0]!.deliver({
    kind: 'subscription.next',
    deliveryId: 1,
    subscriptionId,
    item: snapshot(7),
  })
  await first

  // The server reports the drop, then closes the silent peer's socket.
  sockets[0]!.deliver({
    kind: 'subscription.error',
    subscriptionId,
    error: { code: 'orchestration.LIVE_STREAM_ACK_TIMEOUT', message: 'dropped', status: 408 },
  })
  sockets[0]!.serverClose({ code: 4408, wasClean: true })
  const next = iterator.next()
  await vi.waitFor(() => expect(sockets).toHaveLength(2))
  sockets[1]!.open()
  const resumed = await nthSubscribe(sockets[1]!, 1)

  expect(resumed).toMatchObject({ afterSequence: 7, method: 'subscribeShell' })
  expect(resumed.subscriptionId).not.toBe(subscriptionId)
  expect(eventsOf(fixture.events, CONNECTION)).toEqual([
    expect.objectContaining({ code: 4408, level: 'warn' }),
  ])
  expect(eventsOf(fixture.events, SUBSCRIPTION)).toEqual([
    expect.objectContaining({
      failure: { code: 'orchestration.LIVE_STREAM_ACK_TIMEOUT', status: 408 },
      level: 'info',
    }),
  ])
  controller.abort()
  await next
})

test('an overflow of the client buffer warns once for its resume series', async () => {
  const fixture = rpcClientFixture()
  const controller = new AbortController()
  const next = fixture.client
    .shellStream({ signal: controller.signal })
    [Symbol.asyncIterator]()
    .next()
  fixture.socket.open()
  for (const attempt of [1, 2]) {
    const { subscriptionId } = await nthSubscribe(fixture.socket, attempt)
    overflowClientBuffer(fixture.socket, subscriptionId)
    await vi.waitFor(() => expect(eventsOf(fixture.events, SUBSCRIPTION)).toHaveLength(attempt))
  }
  controller.abort()
  await next

  const failure = { code: 'orchestration.LIVE_STREAM_OVERFLOW', status: 409 }
  expect(eventsOf(fixture.events, SUBSCRIPTION)).toEqual([
    expect.objectContaining({
      failure,
      level: 'warn',
      warning: 'Live updates overflowed the client subscription buffer.',
    }),
    expect.objectContaining({ failure, level: 'info', retryAttempt: 1 }),
  ])
})

function socketFactory() {
  const sockets: FakeOrchestrationSocket[] = []
  return {
    sockets,
    createSocket() {
      const socket = new FakeOrchestrationSocket()
      socket.autoPong = true
      sockets.push(socket)
      return socket
    },
  }
}

async function nthSubscribe(socket: FakeOrchestrationSocket, count: number) {
  await vi.waitFor(() => expect(subscribeFrames(socket)).toHaveLength(count))
  return subscribeFrames(socket)[count - 1]!
}

function subscribeFrames(socket: FakeOrchestrationSocket) {
  return socket.sent.flatMap((raw) => {
    const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw))
    return message.kind === 'subscribe' ? [message] : []
  })
}

// Delivered in one task, so nothing drains between frames; the client holds at most 1,000.
function overflowClientBuffer(socket: FakeOrchestrationSocket, subscriptionId: string) {
  for (let deliveryId = 1; deliveryId <= 1_001; deliveryId += 1) {
    socket.deliver({
      kind: 'subscription.next',
      deliveryId,
      subscriptionId,
      item: { kind: 'synchronized', sequence: 0 },
    })
  }
}

function snapshot(snapshotSequence: number) {
  return {
    kind: 'snapshot',
    snapshot: {
      projects: [],
      worktrees: [],
      sessions: [],
      snapshotSequence,
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  }
}

function eventsOf(events: ReadonlyArray<Record<string, unknown>>, action: string) {
  return events.filter((event) => event.action === action)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
