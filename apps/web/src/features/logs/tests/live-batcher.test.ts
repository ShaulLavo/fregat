import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import type { LogEventSummary } from '@workspace/contracts'

import { createLiveEventBatcher } from '@/features/logs/state/live-batcher'

describe('createLiveEventBatcher', () => {
  it('flushes multiple pushed events as one batch', () => {
    let scheduledFlush: (() => void) | null = null
    const batches: string[][] = []
    const batcher = createLiveEventBatcher<LogEventSummary>(
      (events) => batches.push(events.map((event) => event.id)),
      (flush) => {
        scheduledFlush = flush

        return () => {
          scheduledFlush = null
        }
      },
    )

    batcher.push(event('a'))
    batcher.push(event('b'))

    expect(batches).toEqual([])
    ;(scheduledFlush as (() => void) | null)?.()
    expect(batches).toEqual([['a', 'b']])
  })

  it('drops pending events when canceled', () => {
    let scheduledFlush: (() => void) | null = null
    const batches: string[][] = []
    const batcher = createLiveEventBatcher<LogEventSummary>(
      (events) => batches.push(events.map((event) => event.id)),
      (flush) => {
        scheduledFlush = flush

        return () => {
          scheduledFlush = null
        }
      },
    )

    batcher.push(event('a'))
    batcher.cancel()
    ;(scheduledFlush as (() => void) | null)?.()

    expect(batches).toEqual([])
  })
})

function event(id: string): LogEventSummary {
  return {
    action: null,
    area: null,
    durationMs: null,
    environment: null,
    errorCode: null,
    errorMessage: null,
    errorName: null,
    id,
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
  }
}

it('flushes at the count bound when the browser delays its timer', () => {
  const batches: number[] = []
  const batcher = createLiveEventBatcher<number>(
    (events) => batches.push(events.length),
    () => () => {},
  )
  for (let index = 0; index < 1500; index++) batcher.push(index)
  expect(batches).toEqual([500, 500, 500])
  batcher.cancel()
})
