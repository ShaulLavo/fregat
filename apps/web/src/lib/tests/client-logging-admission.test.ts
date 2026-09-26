import { afterEach, beforeEach, vi } from 'vitest'
import { createError, initLogger } from 'evlog'
import { expect, test } from '../../../test/fixtures'
import { log, observeClientOperation } from '@/lib/client-logging'
import { createWideEventScope } from '@/lib/wide-event-scope'

const events: Record<string, unknown>[] = []
beforeEach(() => {
  events.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  initLogger({
    enabled: true,
    silent: true,
    minLevel: 'info',
    redact: true,
    drain: ({ event }) => {
      events.push(event)
    },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

test('rejects debug before payload evaluation, traversal, and identity allocation', () => {
  const payload = vi.fn(() => ({ action: 'test.detail', area: 'test' }))
  const identity = vi.spyOn(crypto, 'randomUUID')
  const read = vi.fn(() => 'private')
  log.debug(payload)
  log.debug({
    get token() {
      return read()
    },
  })
  expect(payload).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  expect(identity).not.toHaveBeenCalled()
  expect(events).toEqual([])
  log.warn({ action: 'test.failure', area: 'test', level: 'debug', token: 'private' })
  expect(identity).toHaveBeenCalledTimes(1)
  expect(events[0]).toMatchObject({ level: 'warn', token: '[redacted]' })
})

test('master off skips summaries while preserving operation results and errors', async () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'false')
  const summarize = vi.fn(() => ({ count: 1 }))
  expect(
    await observeClientOperation({ action: 'read', area: 'test' }, async () => 42, summarize),
  ).toBe(42)
  expect(summarize).not.toHaveBeenCalled()
  const failure = createError({ message: 'read failed', status: 500 })
  await expect(
    observeClientOperation({ action: 'read', area: 'test' }, async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(events).toEqual([])
})

test('level filtering applies before success summary construction', async () => {
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'warn')
  const summarize = vi.fn(() => ({ count: 1 }))
  await observeClientOperation({ action: 'read', area: 'test' }, async () => 42, summarize)
  expect(summarize).not.toHaveBeenCalled()
  expect(events).toEqual([])
})

test('a late scope failure survives zero success sampling in real evlog', () => {
  initLogger({
    enabled: true,
    silent: true,
    sampling: { rates: { info: 0, debug: 0, warn: 100, error: 100 } },
    drain: ({ event }) => {
      events.push(event)
    },
  })
  const scope = createWideEventScope({ action: 'stream', area: 'test' })
  scope.increment('items', 100)
  scope.error(createError({ message: 'connection lost', status: 502 }), { token: 'private' })
  scope.end()
  expect(events).toHaveLength(1)
  expect(events[0]).not.toHaveProperty('checkpoint')
  expect(events[0]).toMatchObject({
    level: 'error',
    items: 100,
    token: '[redacted]',
    error: { message: 'connection lost', status: 502 },
  })
})

test('signal cancellation rejects without emitting a failure', async () => {
  const controller = new AbortController()
  controller.abort()
  const failure = new TypeError('Error in input stream')
  await expect(
    observeClientOperation(
      { action: 'stream', area: 'test', signal: controller.signal },
      async () => {
        throw failure
      },
    ),
  ).rejects.toBe(failure)
  expect(events).toEqual([])
})
