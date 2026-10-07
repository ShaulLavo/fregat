import { afterEach, vi } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { expect, test } from '../../../test/fixtures'
import { createLogOutbox } from '@/lib/client-logging/outbox'

const destination = 'http://localhost:3001/_log/ingest'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

test('stores sanitized failures and a new instance recovers the original identity', () => {
  const outbox = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'old-tab',
    retention,
  })
  outbox.persist(
    failure('failure-one', {
      token: 'private-token',
      content: 'private-content',
      error: { stack: 'private-stack' },
    }),
  )
  expect(JSON.stringify(Object.values(localStorage))).not.toContain('private-')
  const recovered = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'new-tab',
    retention,
  })
  const [entry] = recovered.pending()
  expect(entry).toMatchObject({
    instanceId: 'old-tab',
    context: { event: { eventId: 'failure-one', token: '[redacted]', content: '[redacted]' } },
  })
  expect(entry?.context.event.error).toMatchObject({ stack: '[redacted]' })
  expect(entry).toBeDefined()
  if (entry) recovered.remove(entry)
  expect(recovered.pending()).toEqual([])
})

test('an old diagnostic acknowledgement preserves newer delivery counters', () => {
  const outbox = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'tab',
    retention,
  })
  outbox.recordLoss('delivery', 1, new TypeError('private-network-details'))
  const [old] = outbox.pending()
  outbox.recordLoss('delivery', 2, new TypeError('private-network-details'))
  if (old) outbox.remove(old)
  expect(outbox.pending()).toMatchObject([
    { context: { event: { losses: { delivery: 3 }, lastFailure: { name: 'TypeError' } } } },
  ])
  expect(JSON.stringify(Object.values(localStorage))).not.toContain('private-network-details')
})

test('bounded wide records preserve the identifiers required for replay', () => {
  const outbox = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'wide',
    retention,
  })
  const fields = Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => [`field${index}`, index]),
  )
  outbox.persist({ event: { ...fields, ...failure('wide-failure').event } })
  expect(outbox.pending()).toMatchObject([{ context: { event: { eventId: 'wide-failure' } } }])
  expect(Object.keys(outbox.pending()[0]?.context.event ?? {}).length).toBeLessThanOrEqual(56)
})

test('bounds storage, expires old entries, and leaves recoverable loss counts', () => {
  const outbox = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'tab',
    retention: () => ({ ...retention(), maxEvents: 2 }),
  })
  outbox.persist(
    failure('expired', { timestamp: new Date(Date.now() - 25 * 3_600_000).toISOString() }),
  )
  outbox.persist(failure('one'))
  outbox.persist(failure('two'))
  outbox.persist(failure('three'))
  outbox.pending()
  const pending = outbox.pending()
  expect(pending.length).toBeLessThanOrEqual(2)
  expect(pending.some((entry) => entry.context.event.eventId === 'expired')).toBe(false)
  expect(
    pending.find((entry) => entry.context.event.action === 'client.logs.delivery')?.context.event
      .losses,
  ).toMatchObject({ expired: 1, capacity: expect.any(Number) })
})

test('storage denial keeps bounded failures and delivery diagnostics in memory', () => {
  const outbox = createLogOutbox({ destination, storage: null, instanceId: 'tab', retention })
  outbox.persist(failure('one'))
  expect(outbox.pending()).toMatchObject([
    { context: { event: { eventId: 'one' } } },
    { context: { event: { losses: { storage: 1 } } } },
  ])
})

test('corrupt stored entries are discarded once', () => {
  const key = `platform.client-log.v1:${encodeURIComponent(destination)}:corrupt`
  localStorage.setItem(key, '{broken')
  const outbox = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'tab',
    retention,
  })
  outbox.pending()
  expect(localStorage.getItem(key)).toBeNull()
  expect(outbox.pending()).toMatchObject([{ context: { event: { losses: { invalid: 1 } } } }])
})

test('destinations and simultaneous app instances preserve separate queued events', () => {
  const first = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'one',
    retention,
  })
  const second = createLogOutbox({
    destination,
    storage: localStorage,
    instanceId: 'two',
    retention,
  })
  first.persist(failure('one'))
  second.persist(failure('two'))
  const otherServer = createLogOutbox({
    destination: `${destination}/other`,
    storage: localStorage,
    instanceId: 'other',
    retention,
  })
  expect(otherServer.pending()).toEqual([])
  expect(
    second
      .pending()
      .map((entry) => entry.instanceId)
      .sort(),
  ).toEqual(['one', 'two'])
  const entry = second.pending().find((entry) => entry.instanceId === 'one')
  if (entry) second.remove(entry)
  expect(second.pending().map((entry) => entry.instanceId)).toEqual(['two'])
  expect(first.pending().map((entry) => entry.instanceId)).toEqual(['two'])
})

function retention() {
  return DEFAULT_SETTING_VALUES['logs.clientFailureRetention']
}

function failure(eventId: string, fields: Record<string, unknown> = {}) {
  return {
    event: {
      timestamp: new Date().toISOString(),
      level: 'error' as const,
      service: 'platform-web',
      environment: 'test',
      eventId,
      ...fields,
    },
  }
}
