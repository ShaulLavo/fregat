import { afterEach, describe, vi } from 'vitest'
import { createWideEventScope } from '@workspace/observability/scope'

import { expect, test } from '../../../test/fixtures'

import {
  beginPressPaint,
  endPressPaint,
  notePressPaint,
  notePressPrefetch,
} from '@/lib/intent-prefetch/state/press-paint'

function recordingScope() {
  const ended: Record<string, unknown>[] = []
  const scope = createWideEventScope({ enabled: false, base: { action: 'test', area: 'test' } })
  const context: Record<string, unknown> = {}
  return {
    ended,
    context,
    scope: {
      ...scope,
      set: (next: Record<string, unknown>) => Object.assign(context, next),
      end: (overrides?: Record<string, unknown>) => ended.push({ ...context, ...overrides }),
    },
  }
}

describe('press paint', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('ends the open event at the first colour paint with both timings', () => {
    vi.useFakeTimers()
    const press = recordingScope()
    beginPressPaint('files', '/repo/a.ts', press.scope)
    notePressPrefetch('files', '/repo/a.ts', 'hit')
    notePressPaint('files', '/repo/b.ts', 'text')
    vi.advanceTimersByTime(40)
    notePressPaint('files', '/repo/a.ts', 'text')
    vi.advanceTimersByTime(30)
    notePressPaint('files', '/repo/a.ts', 'colour', { highlight: 'ready' })
    notePressPaint('files', '/repo/a.ts', 'colour')

    expect(press.ended).toEqual([
      {
        prefetch: 'hit',
        firstPaint: { textMs: 40, colourMs: 70, highlight: 'ready' },
      },
    ])
  })

  test('a newer press, a timeout and an explicit end each log the older press once', () => {
    vi.useFakeTimers()
    const first = recordingScope()
    const second = recordingScope()
    const third = recordingScope()
    beginPressPaint('diffs', '/repo/a.ts', first.scope)
    beginPressPaint('diffs', '/repo/b.ts', second.scope)
    vi.advanceTimersByTime(10_000)
    beginPressPaint('diffs', '/repo/c.ts', third.scope)
    endPressPaint('diffs', '/repo/c.ts', 'failed')

    expect(first.ended).toEqual([{ firstPaint: { textMs: null, superseded: true } }])
    expect(second.ended).toEqual([{ firstPaint: { textMs: null, timedOut: true } }])
    expect(third.ended).toEqual([{ firstPaint: { textMs: null, endedBy: 'failed' } }])
  })
})
