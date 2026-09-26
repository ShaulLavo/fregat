import { createError, initLogger } from 'evlog'
import { afterEach, beforeEach, describe, onTestFinished, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { createWideEventScope, FAILURE_CHECKPOINT_GRACE_MS } from '@/lib/wide-event-scope'

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

  test('a failed scope writes one line, when it ends', () => {
    const scope = createWideEventScope({ action: 'chat.stream.summary', area: 'chat' })

    scope.warn('slow stream', { slow: true })
    scope.error(createError({ message: 'closed', status: 502 }), { code: 'CLOSED' })
    expect(emittedEvents).toEqual([])
    scope.end()

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0]).not.toHaveProperty('checkpoint')
    expect(emittedEvents[0]).toMatchObject({
      code: 'CLOSED',
      slow: true,
      level: 'error',
      error: { message: 'closed', status: 502 },
      requestLogs: [expect.objectContaining({ level: 'warn', message: 'slow stream' })],
    })
  })

  test('a failed scope still open after the grace is checkpointed once, then ends', () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const scope = createWideEventScope({ action: 'workspace.events.summary', area: 'workspace' })

    scope.warn('ready events failed')
    scope.error(createError({ message: 'stream lost', status: 502 }))
    vi.advanceTimersByTime(FAILURE_CHECKPOINT_GRACE_MS - 1)
    expect(emittedEvents).toEqual([])
    vi.advanceTimersByTime(1)
    expect(emittedEvents).toEqual([
      expect.objectContaining({ checkpoint: 'failure', level: 'error' }),
    ])

    vi.advanceTimersByTime(FAILURE_CHECKPOINT_GRACE_MS)
    scope.end()
    expect(emittedEvents).toHaveLength(2)
    expect(emittedEvents[1]).not.toHaveProperty('checkpoint')
    expect(emittedEvents[1]).toMatchObject({ level: 'error', scopeId: emittedEvents[0]?.scopeId })
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
