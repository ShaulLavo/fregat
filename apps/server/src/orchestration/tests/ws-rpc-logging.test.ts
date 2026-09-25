import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readFsLogs } from 'evlog/fs'
import type { WideEvent } from 'evlog'
import { afterEach, expect, it, vi } from 'vitest'
import { closeApp } from '../../app'
import { closeTestApps, createTestApp } from '../../../test/server'
import { createInProcessOrchestrationSocket } from '../../../test/orchestration-socket'
import {
  flushObservability,
  initializeObservability,
  resetObservabilityForTests,
} from '../../observability/runtime'
import { testSettingsOptions } from '../../settings/testing'

const origin = 'http://localhost:5173'
const subscriptionId = 'osub-subscribeShell-1'
const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await closeTestApps()
  await resetObservabilityForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

it('closes a peer that leaves a delivery unacknowledged and logs the timeout at info', async () => {
  const root = await fixtureRoot()
  const logDir = await fixtureRoot()
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const silent = createInProcessOrchestrationSocket(app, origin, { instance: 'tab-silent' })
  const reading = createInProcessOrchestrationSocket(app, origin, { instance: 'tab-reading' })
  // Both clients number their first shell subscription the same way.
  for (const socket of [silent, reading]) {
    socket.receive({
      kind: 'subscribe',
      method: 'subscribeShell',
      subscriptionId,
      afterSequence: 0,
    })
  }
  await expect.poll(() => deliveries(silent).length).toBe(1)
  await expect.poll(() => deliveries(reading).length).toBe(1)

  // The reading client acknowledges each delivery well inside the timeout.
  for (let step = 0; step < 3; step++) {
    acknowledgeDeliveries(reading)
    await vi.advanceTimersByTimeAsync(10_000)
  }

  await expect
    .poll(() => silent.closes)
    .toEqual([{ code: 4408, reason: 'live-stream-ack-timeout' }])
  expect(silent.messages.find((message) => message.kind === 'subscription.error')).toMatchObject({
    subscriptionId,
    error: { code: 'orchestration.LIVE_STREAM_ACK_TIMEOUT', status: 408 },
  })
  // The close hook ran inside close() and took the subscription with it.
  expect(silent.messages.some((message) => message.kind === 'subscription.complete')).toBe(false)
  expect(reading.closes).toEqual([])
  expect(reading.messages.some((message) => message.kind === 'subscription.error')).toBe(false)
  reading.receive({ kind: 'unsubscribe', subscriptionId })

  const events = await flushedEvents(logDir)
  const errors = eventsFor(events, 'chat.pipeline.ws.subscription.error')
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    level: 'info',
    client: { instanceId: 'tab-silent' },
    subscriptionId,
    error: {
      code: 'orchestration.LIVE_STREAM_ACK_TIMEOUT',
      internal: {
        deliveryId: deliveries(silent)[0]!.deliveryId,
        timeoutMs: 30_000,
        items: expect.any(Number),
        bytes: expect.any(Number),
      },
    },
  })
  const silentCloses = eventsFor(events, 'chat.pipeline.ws.close').filter(
    (event) => instanceIdOf(event) === 'tab-silent',
  )
  expect(silentCloses).toEqual([
    expect.objectContaining({
      level: 'info',
      code: 4408,
      reason: 'live-stream-ack-timeout',
      serverCloseReason: 'live-stream-ack-timeout',
    }),
  ])
  expect(
    eventsFor(events, 'chat.pipeline.ws.subscription.unsubscribe').map(instanceIdOf).sort(),
  ).toEqual(['tab-reading', 'tab-silent'])
  const silentLines = events.filter((event) => instanceIdOf(event) === 'tab-silent')
  expect(silentLines.filter((event) => event.level !== 'info')).toEqual([])

  const starts = eventsFor(events, 'chat.pipeline.ws.subscription.start')
  expect(starts.map((event) => [event.subscriptionId, instanceIdOf(event)])).toEqual(
    expect.arrayContaining([
      [subscriptionId, 'tab-silent'],
      [subscriptionId, 'tab-reading'],
    ]),
  )
  expect(eventsFor(events, 'chat.pipeline.ws.open').map(instanceIdOf).sort()).toEqual([
    'tab-reading',
    'tab-silent',
  ])
})

it('closes every socket with 1012 when the app shuts down, and logs it at info', async () => {
  const root = await fixtureRoot()
  const logDir = await fixtureRoot()
  initializeObservability({
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  })
  const app = createTestApp({
    workspaceRoot: root,
    settings: testSettingsOptions(root),
    watch: false,
  })
  const tab = createInProcessOrchestrationSocket(app, origin, { instance: 'tab-open' })
  tab.receive({ kind: 'subscribe', method: 'subscribeShell', subscriptionId, afterSequence: 0 })
  await expect.poll(() => deliveries(tab).length).toBe(1)

  await closeApp(app)

  expect(tab.closes).toEqual([{ code: 1012, reason: 'service restart' }])
  const closes = eventsFor(await flushedEvents(logDir), 'chat.pipeline.ws.close')
  expect(closes).toEqual([
    expect.objectContaining({
      level: 'info',
      code: 1012,
      serverCloseReason: 'service restart',
      subscriptionCount: 1,
    }),
  ])
})

function acknowledgeDeliveries(socket: ReturnType<typeof createInProcessOrchestrationSocket>) {
  for (const delivery of deliveries(socket)) {
    socket.receive({
      kind: 'subscription.ack',
      subscriptionId: delivery.subscriptionId,
      deliveryId: delivery.deliveryId,
    })
  }
}

function deliveries(socket: ReturnType<typeof createInProcessOrchestrationSocket>) {
  return socket.messages.filter((message) => message.kind === 'subscription.next')
}

function instanceIdOf(event: WideEvent) {
  const client = event.client as { instanceId?: string } | undefined
  return client?.instanceId
}

function eventsFor(events: readonly WideEvent[], action: string) {
  return events.filter((event) => event.action === action)
}

async function flushedEvents(logDir: string) {
  await flushObservability()
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir: logDir })) events.push(event)
  return events
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-ws-logging-'))
  roots.push(root)
  return root
}
