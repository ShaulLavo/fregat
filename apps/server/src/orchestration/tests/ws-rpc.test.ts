import { rpcClientFixture } from '../../../../../packages/client-core/test/rpc-client'
import { inProcessOrchestrationSocketFactory } from '../../../../../packages/client-core/test/in-process-orchestration-socket'
import {
  orchestrationWsClientMessageSchema,
  type OrchestrationWsClientMessage,
} from '@workspace/contracts'
import { orchestrationForApp } from '../../app'
import { createShellWorkspace } from './factories/shell-workspace'
import { domainCommand } from './factories/engine'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { healthDescriptorSchema, sessionIdSchema } from '@workspace/contracts'
import { afterEach, expect, it } from 'vitest'
import * as v from 'valibot'
import { closeTestApps, createTestApp } from '../../../test/server'
import { createInProcessOrchestrationSocket } from '../../../test/orchestration-socket'
import { testSettingsOptions } from '../../settings/testing'

const origin = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

it('carries the same durable identity in health, the handshake, and serverConfig requests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-identity-'))
  roots.push(root)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })
  const response = await app.handle(new Request('http://local/health', { headers: { origin } }))
  const descriptor = v.parse(healthDescriptorSchema, await response.json())
  const socket = createInProcessOrchestrationSocket(app, origin)

  expect(socket.closes).toEqual([])
  expect(socket.messages[0]).toMatchObject({
    kind: 'connected',
    config: { environmentId: descriptor.environmentId, protocolVersion: 8 },
  })

  socket.receive({ kind: 'request', method: 'serverConfig', requestId: 'config-request' })
  await expect.poll(() => socket.messages.length).toBe(2)
  expect(socket.messages[1]).toMatchObject({
    kind: 'response',
    ok: true,
    requestId: 'config-request',
    data: { environmentId: descriptor.environmentId, protocolVersion: 8 },
  })
})

it('closes rejected upgrades with 1008 and forwards the unauthorized reason', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-auth-'))
  roots.push(root)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })

  for (const untrustedOrigin of [undefined, 'http://evil.localhost']) {
    const socket = createInProcessOrchestrationSocket(app, untrustedOrigin)
    expect(socket.messages).toEqual([])
    expect(socket.closes).toEqual([{ code: 1008, reason: 'unauthorized' }])
    socket.receive({ kind: 'request', method: 'serverConfig', requestId: 'unauthorized-request' })
    expect(socket.messages).toEqual([])
  }
})

it('lets WS upgrades reach socket authentication while the descriptor keeps HTTP auth', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-upgrade-'))
  roots.push(root)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })

  for (const requestOrigin of [origin, 'http://evil.localhost']) {
    const upgrade = await app.handle(
      new Request('http://local/orchestration/rpc', {
        headers: { origin: requestOrigin, upgrade: 'websocket', connection: 'Upgrade' },
      }),
    )
    // In-process requests have no Bun socket to upgrade; this response proves the WS handler ran.
    expect(upgrade.status).toBe(400)
    expect(await upgrade.text()).toBe('Expected a websocket connection')
  }

  const descriptor = await app.handle(
    new Request('http://local/health', {
      headers: { origin: 'http://evil.localhost' },
    }),
  )
  expect(descriptor.status).toBe(403)
})

it('waits for an exact delivery ACK and ignores stale ACKs after replacement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-ack-'))
  roots.push(root)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })
  const socket = createInProcessOrchestrationSocket(app, origin)
  socket.receive({
    kind: 'subscribe',
    method: 'subscribeShell',
    subscriptionId: 'shell',
    afterSequence: 0,
  })
  await expect
    .poll(() => socket.messages.filter((message) => message.kind === 'subscription.next').length)
    .toBe(1)
  const first = socket.messages.find((message) => message.kind === 'subscription.next')!
  socket.receive({
    kind: 'subscription.ack',
    subscriptionId: 'shell',
    deliveryId: first.deliveryId + 1,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(socket.messages.filter((message) => message.kind === 'subscription.next')).toHaveLength(1)
  socket.receive({
    kind: 'subscription.ack',
    subscriptionId: 'shell',
    deliveryId: first.deliveryId,
  })
  await expect
    .poll(() => socket.messages.filter((message) => message.kind === 'subscription.next').length)
    .toBe(2)
  socket.receive({
    kind: 'subscribe',
    method: 'subscribeShell',
    subscriptionId: 'shell',
    afterSequence: 0,
  })
  await expect
    .poll(() => socket.messages.filter((message) => message.kind === 'subscription.next').length)
    .toBe(3)
  socket.receive({
    kind: 'subscription.ack',
    subscriptionId: 'shell',
    deliveryId: first.deliveryId,
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(socket.messages.filter((message) => message.kind === 'subscription.next')).toHaveLength(3)
  socket.receive({ kind: 'unsubscribe', subscriptionId: 'shell' })
})

it('detaches overflowed live delivery while ACK is stalled and resumes canonical text', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-overflow-'))
  roots.push(root)
  const workspace = createShellWorkspace(1)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
    orchestration: { database: workspace.database },
  })
  const engine = orchestrationForApp(app)
  const socket = createInProcessOrchestrationSocket(app, origin)
  const sessionId = workspace.sessionIds[0]!
  try {
    socket.receive({
      kind: 'subscribe',
      method: 'subscribeSession',
      subscriptionId: 'detail',
      sessionId: v.parse(sessionIdSchema, sessionId),
      afterSequence: 0,
    })
    await expect
      .poll(() => socket.messages.filter((message) => message.kind === 'subscription.next').length)
      .toBe(1)
    const initial = socket.messages.find((message) => message.kind === 'subscription.next')!
    if (initial.item.kind !== 'snapshot') return expect.unreachable('expected initial snapshot')
    const cursor = initial.item.snapshot.snapshotSequence
    const text = 'x'.repeat(8 * 1024 * 1024)
    await engine.dispatch(
      domainCommand({
        type: 'session.message.assistant.delta',
        commandId: 'oversized-delta',
        sessionId,
        messageId: 'oversized-message',
        delta: text,
        createdAt: new Date().toISOString(),
      }),
    )
    await expect
      .poll(() => socket.messages.some((message) => message.kind === 'subscription.error'))
      .toBe(true)
    expect(socket.messages.find((message) => message.kind === 'subscription.error')).toMatchObject({
      error: { code: 'orchestration.LIVE_STREAM_OVERFLOW' },
    })
    expect(socket.messages.filter((message) => message.kind === 'subscription.next')).toHaveLength(
      1,
    )
    socket.receive({
      kind: 'subscribe',
      method: 'subscribeSession',
      subscriptionId: 'resumed',
      sessionId: v.parse(sessionIdSchema, sessionId),
      afterSequence: cursor,
    })
    await expect
      .poll(() => socket.messages.filter((message) => message.kind === 'subscription.next').length)
      .toBe(2)
    const resumed = socket.messages.filter((message) => message.kind === 'subscription.next')[1]!
    expect(resumed.item).toMatchObject({ kind: 'event', event: { payload: { text } } })
    socket.receive({ kind: 'unsubscribe', subscriptionId: 'resumed' })
  } finally {
    await closeTestApps()
    workspace.close()
  }
})

it('recovers an oversized durable replay through a snapshot after no cursor progress', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-large-recovery-'))
  roots.push(root)
  const workspace = createShellWorkspace(1)
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
    orchestration: { database: workspace.database },
  })
  const engine = orchestrationForApp(app)
  const createSocket = inProcessOrchestrationSocketFactory({ app, clientOrigin: origin })
  const messages: OrchestrationWsClientMessage[] = []
  const fixture = rpcClientFixture({
    createSocket: (url) => {
      const socket = createSocket(url)
      const send = socket.send.bind(socket)
      socket.send = (raw) => {
        messages.push(v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw)))
        send(raw)
      }
      return socket
    },
  })
  const controller = new AbortController()
  const sessionId = v.parse(sessionIdSchema, workspace.sessionIds[0]!)
  const stream = fixture.client.sessionDetailStream(sessionId, { signal: controller.signal })
  try {
    const initial = (await stream.next()).value
    if (!initial || initial.kind !== 'snapshot') return expect.unreachable('expected snapshot')
    const cursor = initial.snapshot.snapshotSequence
    const text = 'x'.repeat(8 * 1024 * 1024)
    // Keep the initial snapshot unacknowledged while durable live data overflows.
    await engine.dispatch(
      domainCommand({
        type: 'session.message.assistant.delta',
        commandId: 'large-recovery',
        sessionId,
        messageId: 'large-recovery',
        delta: text,
        createdAt: new Date().toISOString(),
      }),
    )
    const recovered = (await stream.next()).value
    expect(recovered).toMatchObject({
      kind: 'snapshot',
      snapshot: { session: { messages: [{ text }] } },
    })
    expect(
      messages
        .filter((message) => message.kind === 'subscribe')
        .map((message) => message.afterSequence),
    ).toEqual([0, cursor, 0])
  } finally {
    controller.abort()
    await stream.return(undefined)
    fixture.client.close()
    await closeTestApps()
    workspace.close()
  }
})
