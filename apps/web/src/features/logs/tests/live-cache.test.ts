import { describe, expect, it } from 'vitest'
import type { LogEventDetail, LogEventSummary, LogEventsResult } from '@workspace/contracts'

import { mergeLiveLogEvent, mergeLiveLogEvents } from '@workspace/client-core/logs/live-cache'

describe('mergeLiveLogEvent', () => {
  it('prepends unique live events and increments the visible total', () => {
    const current = result([event({ id: 'old', timestamp: '2026-05-25T09:59:00.000Z' })])
    const next = mergeLiveLogEvent(
      current,
      event({ id: 'new', timestamp: '2026-05-25T10:00:00.000Z' }),
    )

    expect(next?.events.map((candidate) => candidate.id)).toEqual(['new', 'old'])
    expect(next?.total).toBe(2)
  })

  it('keeps the existing cache object when the live event is already present', () => {
    const current = result([event({ id: 'same' })])

    expect(mergeLiveLogEvent(current, event({ id: 'same' }))).toBe(current)
  })

  it('caps the retained live event window', () => {
    const current = result([event({ id: 'a' }), event({ id: 'b' })])
    const next = mergeLiveLogEvent(current, event({ id: 'c' }), { maxEvents: 2 })

    expect(next?.events.map((candidate) => candidate.id)).toEqual(['c', 'a'])
    expect(next?.nextCursor).toBe('cursor-1')
    expect(next?.total).toBe(3)
  })

  it('leaves an absent history cache untouched', () => {
    expect(mergeLiveLogEvent(undefined, event({ id: 'new' }))).toBeUndefined()
  })
})

describe('mergeLiveLogEvents', () => {
  it('places late frames by timestamp and counts only new ids even without cached details', () => {
    const current = result([event({ id: 'newest', timestamp: '2026-05-25T10:02:00.000Z' })])
    const next = mergeLiveLogEvents(current, [
      event({ id: 'late', timestamp: '2026-05-25T10:01:00.000Z' }),
      event({ id: 'newest', timestamp: '2026-05-25T10:02:00.000Z' }),
    ])

    expect(next?.events.map((candidate) => candidate.id)).toEqual(['newest', 'late'])
    expect(next?.total).toBe(2)
  })

  it('prepends a live batch in newest-first arrival order', () => {
    const current = result([event({ id: 'old' })])
    const next = mergeLiveLogEvents(current, [event({ id: 'a' }), event({ id: 'b' })])

    expect(next?.events.map((candidate) => candidate.id)).toEqual(['b', 'a', 'old'])
    expect(next?.total).toBe(3)
  })

  it('deduplicates events across the existing cache and current batch', () => {
    const current = result([event({ id: 'old' })])
    const next = mergeLiveLogEvents(current, [
      event({ id: 'old' }),
      event({ id: 'new' }),
      event({ id: 'new' }),
    ])

    expect(next?.events.map((candidate) => candidate.id)).toEqual(['new', 'old'])
    expect(next?.total).toBe(2)
  })

  it('keeps raw details aligned with retained rows', () => {
    const current = result([event({ id: 'a' }), event({ id: 'b' })], {
      a: detail(event({ id: 'a' }), { retained: 'a' }),
      b: detail(event({ id: 'b' }), { retained: 'b' }),
    })
    const liveEvent = event({ id: 'c' })
    const next = mergeLiveLogEvent(current, liveEvent, {
      detail: detail(liveEvent, { live: true }),
      maxEvents: 2,
    })

    expect(Object.keys(next?.detailsById ?? {}).sort()).toEqual(['a', 'c'])
    expect(next?.detailsById.c?.rawJson).toEqual({ live: true })
    expect(next?.detailsById.b).toBeUndefined()
  })
})

function result(
  events: LogEventSummary[],
  detailsById: Record<string, LogEventDetail> = {},
): LogEventsResult {
  return {
    detailsById,
    events,
    nextCursor: 'cursor-1',
    total: events.length,
  }
}

function event(overrides: Partial<LogEventSummary>): LogEventSummary {
  return {
    action: null,
    area: null,
    durationMs: null,
    environment: null,
    errorCode: null,
    errorMessage: null,
    errorName: null,
    id: 'event',
    level: 'info',
    message: null,
    method: null,
    operation: null,
    outcome: null,
    path: null,
    requestId: null,
    service: null,
    source: null,
    status: null,
    sessionId: null,
    timestamp: '2026-05-25T10:00:00.000Z',
    ...overrides,
  }
}

function detail(event: LogEventSummary, rawJson: Record<string, unknown>): LogEventDetail {
  return { event, rawJson }
}
