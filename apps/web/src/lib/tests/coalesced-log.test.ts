import { afterEach, describe, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'

import { createCoalescedLogQueue } from '@/lib/coalesced-log'

describe('createCoalescedLogQueue', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('coalesces repeated events with an optional merge function', () => {
    vi.useFakeTimers()
    const emitted: Record<string, unknown>[] = []
    const queue = createCoalescedLogQueue({
      delayMs: 100,
      emit: (event) => emitted.push(event),
      merge: (current, next) => ({
        latestPath: next.path,
        paths: [...pathsFromEvent(current), String(next.path)],
      }),
    })

    queue.queue('fs.tree', { path: 'apps' })
    queue.queue('fs.tree', { path: 'docs' })

    expect(emitted).toEqual([])

    vi.advanceTimersByTime(100)

    expect(emitted).toEqual([
      {
        coalescedCount: 2,
        latestPath: 'docs',
        paths: ['apps', 'docs'],
      },
    ])
  })
})

function pathsFromEvent(event: Record<string, unknown>) {
  if (Array.isArray(event.paths)) {
    return event.paths.filter((value): value is string => typeof value === 'string')
  }

  const path = event.path
  return typeof path === 'string' ? [path] : []
}

test('continuous traffic cannot postpone the first flush', () => {
  vi.useFakeTimers()
  try {
    const emit = vi.fn()
    const queue = createCoalescedLogQueue({ delayMs: 100, emit })
    queue.queue('stream', { value: 1 })
    vi.advanceTimersByTime(60)
    queue.queue('stream', { value: 2 })
    vi.advanceTimersByTime(40)
    expect(emit).toHaveBeenCalledExactlyOnceWith({ value: 2, coalescedCount: 2 })
    queue.queue('stream', { value: 3 })
    queue.flushAll()
    vi.advanceTimersByTime(100)
    expect(emit).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
