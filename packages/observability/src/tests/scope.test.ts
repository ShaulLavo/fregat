import { createError, initLogger } from 'evlog'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { createWideEventScope } from '../scope'
import { sanitizeRecord } from '../sanitize'

const emittedEvents: Record<string, unknown>[] = []

beforeEach(() => {
  emittedEvents.length = 0
  initLogger({
    enabled: true,
    silent: true,
    redact: true,
    drain: ({ event }) => {
      emittedEvents.push(event)
    },
  })
})

afterEach(() => {
  initLogger({ enabled: false })
})

test('shares accumulated diagnostics and redaction with a terminal host', () => {
  const scope = createWideEventScope({
    enabled: true,
    base: { action: 'orchestration.ws.connection.summary', area: 'orchestration', runtime: 'tui' },
  })

  scope.set({ request: { body: 'private prompt', method: 'dispatchCommand' } })
  scope.increment('response.count')
  scope.increment('response.count', 2)
  scope.warn('late response', { durationMs: 4000 })
  scope.error(createError({ message: 'Transport closed', status: 502 }), { code: 'WS_CLOSED' })
  expect(scope.count('response.count')).toBe(3)
  scope.end({ outcome: 'disconnected' })
  scope.set({ outcome: 'late write' })
  scope.end()

  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({
    runtime: 'tui',
    request: { body: '[redacted]', method: 'dispatchCommand' },
    response: { count: 3 },
    code: 'WS_CLOSED',
    outcome: 'disconnected',
    error: { message: 'Transport closed', status: 502 },
  })
})

test('disabled scopes collect and emit nothing', () => {
  const scope = createWideEventScope({
    enabled: false,
    base: { action: 'disabled', area: 'test' },
  })

  scope.set({ token: 'secret' })
  scope.increment('count')
  scope.warn('ignored')
  scope.error('ignored')
  scope.end()

  expect(scope.count('count')).toBe(0)
  expect(scope.getContext()).toEqual({})
  expect(emittedEvents).toEqual([])
})

test('sanitizes nested payloads while retaining path and stack diagnostics', () => {
  const circular: Record<string, unknown> = { token: 'private' }
  circular.self = circular
  const error = createError({ message: 'closed', status: 502 })
  const safe = sanitizeRecord({
    authorization: 'Bearer private',
    events: [{ content: 'private', path: 'src/app.ts' }],
    circular,
    error,
    message: 'x'.repeat(2100),
  })

  expect(safe).toMatchObject({
    authorization: '[redacted]',
    events: [{ content: '[redacted]', path: 'src/app.ts' }],
    circular: { token: '[redacted]', self: '[circular]' },
    error: { message: 'closed', stack: error.stack },
    message: 'x'.repeat(2000),
  })
})

test('long-lived scopes retain the latest bounded collections and all warning counts', () => {
  const scope = createWideEventScope({ enabled: true, base: { action: 'stream', area: 'test' } })
  for (let index = 0; index < 1000; index++) {
    scope.set({ stream: { samples: [index] } })
    scope.warn(`warning ${index}`)
    scope.increment('items')
  }
  expect(scope.getContext()).toMatchObject({
    items: 1000,
    warningCount: 1000,
    stream: { samples: Array.from({ length: 25 }, (_, index) => 975 + index) },
  })
  expect(scope.getContext().requestLogs).toHaveLength(25)
  scope.error(createError({ message: 'late failure', status: 502 }))
  scope.end()
  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0]).toMatchObject({ level: 'error', warningCount: 1000, items: 1000 })
})

test('bounding diagnostics never mutates application-owned error causes', () => {
  const values = Array.from({ length: 50 }, (_, index) => index)
  const failure = createError({ message: 'failed' })
  failure.cause = { values }
  const scope = createWideEventScope({ enabled: true, base: { action: 'stream', area: 'test' } })
  scope.error(failure)
  scope.set({ samples: values })
  expect(values).toHaveLength(50)
  expect(scope.getContext().samples).toHaveLength(25)
  scope.end()
  expect(values).toHaveLength(50)
})
