import { commandIdSchema, orchestrationWsClientMessageSchema } from '@workspace/contracts'
import { expect, test, vi } from 'vitest'
import * as v from 'valibot'

import { selectServerConnection } from '../../environments/state/store'
import { orchestrationServerConfig } from '../../../test/orchestration-server-config'
import { rpcClientFixture } from '../../../test/rpc-client'
import { FakeOrchestrationSocket } from '../../../test/orchestration-socket'
import { isOrchestrationRpcServerError } from '../orchestration-rpc-client'

test('ready verifies a handshake without subscriptions or a global WebSocket', async () => {
  vi.stubGlobal('WebSocket', undefined)
  const fixture = rpcClientFixture()
  try {
    const ready = fixture.client.ready()
    fixture.socket.open()
    await ready
    expect(fixture.socket.sent).toEqual([])
    expect(selectServerConnection(fixture.environments.getState(), fixture.origin)).toMatchObject({
      phase: 'connected',
      generation: 1,
    })
  } finally {
    fixture.client.close()
    vi.unstubAllGlobals()
  }
})

test('disconnect is reported once, preserves generation, and isolates a throwing host callback', async () => {
  const disconnect = vi.fn(() => {
    throw 'host callback failed'
  })
  const fixture = rpcClientFixture({ onDisconnect: disconnect })
  const ready = fixture.client.ready()
  fixture.socket.open()
  await ready
  fixture.socket.serverClose({ code: 1006, wasClean: false })
  fixture.socket.serverClose({ code: 1006, wasClean: false })
  fixture.client.close()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(selectServerConnection(fixture.environments.getState(), fixture.origin)).toMatchObject({
    phase: 'disconnected',
    generation: 1,
    serverInstanceId: 'server-1',
  })
})

test('a transport error keeps the close code in the connection summary', async () => {
  const fixture = rpcClientFixture()
  const ready = fixture.client.ready()
  fixture.socket.open()
  await ready
  fixture.socket.transportFailure()

  expect(fixture.events).toContainEqual(
    expect.objectContaining({
      action: 'orchestration.ws.connection.summary',
      code: 1006,
      transportError: true,
      wasClean: false,
    }),
  )
  expect(selectServerConnection(fixture.environments.getState(), fixture.origin)).toMatchObject({
    phase: 'disconnected',
  })
})

test('owner closure rejects readiness without reporting an unexpected disconnect', async () => {
  const disconnect = vi.fn()
  const fixture = rpcClientFixture({ onDisconnect: disconnect })
  const ready = fixture.client.ready().catch((error: unknown) => error)
  fixture.client.close()
  expect(await ready).toMatchObject({ code: 'ORCHESTRATION_RPC_CLOSED' })
  fixture.socket.open()
  expect(fixture.socket.sent).toEqual([])
  expect(disconnect).not.toHaveBeenCalled()
})

test('a rejected protocol keeps its refusal state after teardown', async () => {
  const fixture = rpcClientFixture()
  const ready = fixture.client.ready().catch((error: unknown) => error)
  fixture.socket.open(false)
  fixture.socket.deliver({
    kind: 'connected',
    config: orchestrationServerConfig({ protocolVersion: 999 }),
  })
  expect(await ready).toMatchObject({ code: 'ENVIRONMENT_PROTOCOL_MISMATCH' })
  expect(selectServerConnection(fixture.environments.getState(), fixture.origin)).toMatchObject({
    phase: 'protocol-mismatch',
    generation: 0,
  })
  fixture.client.close()
})

test('synchronization follows consumed data and never enters the projection stream', async () => {
  const fixture = rpcClientFixture()
  const synchronized = vi.fn()
  const controller = new AbortController()
  const stream = fixture.client.shellStream({
    signal: controller.signal,
    onSynchronized: synchronized,
  })
  const iterator = stream[Symbol.asyncIterator]()
  const first = iterator.next()
  fixture.socket.open()
  const subscription = await subscriptionMessage(fixture.socket)
  const snapshot = {
    kind: 'snapshot',
    snapshot: {
      projects: [],
      worktrees: [],
      sessions: [],
      snapshotSequence: 7,
      updatedAt: '2026-09-05T00:00:00.000Z',
    },
  }
  fixture.socket.deliver({
    kind: 'subscription.next',
    deliveryId: 1,
    subscriptionId: subscription.subscriptionId,
    item: snapshot,
  })
  fixture.socket.deliver({
    kind: 'subscription.next',
    deliveryId: 2,
    subscriptionId: subscription.subscriptionId,
    item: { kind: 'synchronized', sequence: 7 },
  })
  expect((await first).value).toEqual(snapshot)
  expect(synchronized).not.toHaveBeenCalled()
  const next = iterator.next()
  await vi.waitFor(() => expect(synchronized).toHaveBeenCalledTimes(1))
  controller.abort()
  expect(await next).toMatchObject({ done: true })
  fixture.client.close()
})

test('zero-gap resume reports synchronization without yielding a data item', async () => {
  const fixture = rpcClientFixture()
  const synchronized = vi.fn()
  const controller = new AbortController()
  const next = fixture.client
    .shellStream({ afterSequence: 7, signal: controller.signal, onSynchronized: synchronized })
    [Symbol.asyncIterator]()
    .next()
  fixture.socket.open()
  const subscription = await subscriptionMessage(fixture.socket)
  expect(subscription.afterSequence).toBe(7)
  fixture.socket.deliver({
    kind: 'subscription.next',
    deliveryId: 3,
    subscriptionId: subscription.subscriptionId,
    item: { kind: 'synchronized', sequence: 7 },
  })
  await vi.waitFor(() => expect(synchronized).toHaveBeenCalledTimes(1))
  controller.abort()
  expect(await next).toMatchObject({ done: true })
  fixture.client.close()
})

test('a dropped command is rejected without opening another socket or resending', async () => {
  const socket = new FakeOrchestrationSocket()
  const createSocket = vi.fn(() => socket)
  const fixture = rpcClientFixture({ createSocket })
  const result = fixture.client
    .dispatchCommand({
      type: 'project.create',
      commandId: v.parse(commandIdSchema, 'core-no-command-retry'),
      defaultModelSelection: null,
      title: 'Project',
      workspaceRoot: '/project',
    })
    .catch((error: unknown) => error)
  socket.open()
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
  socket.serverClose({ code: 1006, wasClean: false })
  const failure = await result
  expect(failure).toMatchObject({ code: 'ORCHESTRATION_WS_CLOSED' })
  expect(isOrchestrationRpcServerError(failure)).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(createSocket).toHaveBeenCalledTimes(1)
  expect(socket.sent).toHaveLength(1)
  fixture.client.close()
})

test('dispatch errors identify an authoritative server response without relying on its code', async () => {
  const fixture = rpcClientFixture()
  const result = fixture.client
    .dispatchCommand({
      type: 'project.create',
      commandId: v.parse(commandIdSchema, 'core-rejected-command'),
      defaultModelSelection: null,
      title: 'Project',
      workspaceRoot: '/project',
    })
    .catch((error: unknown) => error)
  fixture.socket.open()
  await vi.waitFor(() => expect(fixture.socket.sent).toHaveLength(1))
  const request = v.parse(orchestrationWsClientMessageSchema, JSON.parse(fixture.socket.sent[0]!))
  if (request.kind !== 'request') return expect.unreachable('Expected an RPC request')
  fixture.socket.deliver({
    kind: 'response',
    requestId: request.requestId,
    ok: false,
    error: { message: 'Command rejected' },
  })
  const failure = await result
  expect(failure).toMatchObject({ message: 'Command rejected' })
  expect(isOrchestrationRpcServerError(failure)).toBe(true)
  expect(isOrchestrationRpcServerError({ message: 'Command rejected' })).toBe(false)
})

async function subscriptionMessage(socket: FakeOrchestrationSocket) {
  await vi.waitFor(() => expect(socket.sent).toHaveLength(1))
  const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(socket.sent[0]!))
  if (message.kind !== 'subscribe') return expect.unreachable('Expected the subscription frame')
  return message
}

test('ACK follows consumption and overflow resumes from the last consumed cursor', async () => {
  const fixture = rpcClientFixture()
  const controller = new AbortController()
  const iterator = fixture.client.shellStream({ signal: controller.signal })[Symbol.asyncIterator]()
  const first = iterator.next()
  fixture.socket.open()
  const subscription = await subscriptionMessage(fixture.socket)
  fixture.socket.deliver({
    kind: 'subscription.next',
    deliveryId: 11,
    subscriptionId: subscription.subscriptionId,
    item: {
      kind: 'snapshot',
      snapshot: {
        projects: [],
        worktrees: [],
        sessions: [],
        snapshotSequence: 7,
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
    },
  })
  await first
  expect(
    sentMessages(fixture.socket).filter((message) => message.kind === 'subscription.ack'),
  ).toEqual([])
  fixture.socket.deliver({
    kind: 'subscription.error',
    subscriptionId: subscription.subscriptionId,
    error: { code: 'orchestration.LIVE_STREAM_OVERFLOW', message: 'full', status: 409 },
  })
  const next = iterator.next()
  await vi.waitFor(() =>
    expect(
      sentMessages(fixture.socket).filter((message) => message.kind === 'subscribe'),
    ).toHaveLength(2),
  )
  const subscriptions = sentMessages(fixture.socket).filter(
    (message) => message.kind === 'subscribe',
  )
  expect(subscriptions[1]).toMatchObject({ afterSequence: 7 })
  expect(subscriptions[1]!.subscriptionId).not.toBe(subscription.subscriptionId)
  expect(sentMessages(fixture.socket)).toContainEqual({
    kind: 'subscription.ack',
    subscriptionId: subscription.subscriptionId,
    deliveryId: 11,
  })
  controller.abort()
  await next
})

test('abort unsubscribes immediately even while the consumer holds a yielded frame', async () => {
  const fixture = rpcClientFixture()
  const controller = new AbortController()
  const iterator = fixture.client.shellStream({ signal: controller.signal })[Symbol.asyncIterator]()
  const first = iterator.next()
  fixture.socket.open()
  const subscription = await subscriptionMessage(fixture.socket)
  fixture.socket.deliver({
    kind: 'subscription.next',
    deliveryId: 12,
    subscriptionId: subscription.subscriptionId,
    item: {
      kind: 'snapshot',
      snapshot: {
        projects: [],
        worktrees: [],
        sessions: [],
        snapshotSequence: 7,
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
    },
  })
  await first
  controller.abort()
  expect(sentMessages(fixture.socket)).toContainEqual({
    kind: 'unsubscribe',
    subscriptionId: subscription.subscriptionId,
  })
  await iterator.return(undefined)
})

function sentMessages(socket: FakeOrchestrationSocket) {
  return socket.sent.map((raw) => v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw)))
}

test('reports window presence after the handshake and on each change until closed', async () => {
  let focused = true
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const fixture = rpcClientFixture({
    presence: {
      focused: () => focused,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  })
  notify()
  const ready = fixture.client.ready()
  fixture.socket.open()
  await ready
  focused = false
  notify()
  notify()
  fixture.client.close()
  focused = true
  notify()

  expect(fixture.socket.sent.map((message) => JSON.parse(message))).toEqual([
    { kind: 'presence', focused: true },
    { kind: 'presence', focused: false },
  ])
  expect(listeners.size).toBe(0)
})

test('refreshes unchanged focused presence with the heartbeat', async () => {
  vi.useFakeTimers()
  const fixture = rpcClientFixture({ presence: { focused: () => true, subscribe: () => () => {} } })
  try {
    const ready = fixture.client.ready()
    fixture.socket.open()
    await ready
    vi.advanceTimersByTime(30_000)
    expect(sentMessages(fixture.socket).filter((message) => message.kind === 'presence')).toEqual([
      { kind: 'presence', focused: true },
      { kind: 'presence', focused: true },
    ])
  } finally {
    fixture.client.close()
    vi.useRealTimers()
  }
})
