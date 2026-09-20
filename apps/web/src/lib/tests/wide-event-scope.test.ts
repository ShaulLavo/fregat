import { createError, initLogger } from 'evlog'
import { afterEach, beforeEach, describe, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { createWideEventScope } from '@/lib/wide-event-scope'

const emittedEvents: Record<string, unknown>[] = []

beforeEach(() => {
  emittedEvents.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  initLogger({
    enabled: true,
    silent: true,
    drain: ({ event }) => {
      emittedEvents.push(event)
    },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

describe('createWideEventScope', () => {
  test('accumulates context and emits once with browser runtime', () => {
    const scope = createWideEventScope({ action: 'workspace.events.summary', area: 'workspace' })

    scope.set({ workspace: { path: '/repo' } })
    scope.increment('events.batchCount')
    scope.increment('events.eventCount', 3)
    scope.increment('events.eventCount', 2)
    expect(scope.count('events.eventCount')).toBe(5)
    scope.end({ outcome: 'ok' })
    scope.end({ outcome: 'duplicate' })

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0]).toMatchObject({
      action: 'workspace.events.summary',
      area: 'workspace',
      events: { batchCount: 1, eventCount: 5 },
      outcome: 'ok',
      runtime: 'browser',
      workspace: { path: '/repo' },
    })
  })

  test('folds warnings and errors into the same real event', () => {
    const scope = createWideEventScope({ action: 'chat.stream.summary', area: 'chat' })

    scope.warn('slow stream', { slow: true })
    scope.error(createError({ message: 'closed', status: 502 }), { code: 'CLOSED' })
    expect(emittedEvents).toHaveLength(2)
    expect(emittedEvents[0]?.scopeId).toBe(emittedEvents[1]?.scopeId)
    scope.end()

    expect(emittedEvents).toHaveLength(3)
    expect(emittedEvents[1]).toMatchObject({ checkpoint: 'failure', level: 'error' })
    expect(emittedEvents[2]).toMatchObject({
      code: 'CLOSED',
      slow: true,
      level: 'error',
      error: { message: 'closed', status: 502 },
      requestLogs: [expect.objectContaining({ level: 'warn', message: 'slow stream' })],
    })
  })

  test('respects the browser logging switch', () => {
    vi.stubEnv('OBSERVABILITY_ENABLED', 'false')
    const scope = createWideEventScope({ action: 'disabled', area: 'test' })

    scope.increment('events.count')
    scope.end()

    expect(scope.count('events.count')).toBe(0)
    expect(emittedEvents).toEqual([])
  })
})
