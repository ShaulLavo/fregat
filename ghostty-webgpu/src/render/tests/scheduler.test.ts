import { describe, expect, it, vi } from 'vitest'
import { browserRenderClock } from '../config.js'
import { RenderScheduler, type RenderFrameState, type RenderSchedulerClock } from '../scheduler.js'
import { SharedRenderClock } from '../shared-clock.js'

class FakeClock implements RenderSchedulerClock {
  private nextHandle = 1
  readonly frames = new Map<number, () => void>()
  readonly timers = new Map<number, () => void>()

  cancelFrame(handle: number): void {
    this.frames.delete(handle)
  }

  clearTimer(handle: number): void {
    this.timers.delete(handle)
  }

  requestFrame(callback: () => void): number {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.frames.set(handle, callback)
    return handle
  }

  setTimer(callback: () => void): number {
    const handle = this.nextHandle
    this.nextHandle += 1
    this.timers.set(handle, callback)
    return handle
  }

  takeFrame(): () => void {
    return this.take(this.frames, 'frame')
  }

  takeTimer(): () => void {
    return this.take(this.timers, 'timer')
  }

  private take(callbacks: Map<number, () => void>, kind: string): () => void {
    const entry = callbacks.entries().next().value
    if (!entry) throw new Error(`No pending ${kind}`)
    const [handle, callback] = entry
    callbacks.delete(handle)
    return callback
  }
}

function createScheduler(clock: RenderSchedulerClock, frames: RenderFrameState[]): RenderScheduler {
  return new RenderScheduler({
    blinkIntervalMs: 500,
    clock,
    onFrame: (state) => frames.push(state),
  })
}

describe('RenderScheduler', () => {
  it('coalesces write storms and clears pending state before the callback', () => {
    const clock = new FakeClock()
    let scheduler: RenderScheduler
    let pendingInsideFrame = true
    scheduler = new RenderScheduler({
      clock,
      onFrame: () => {
        pendingInsideFrame = scheduler.hasPendingFrame
        scheduler.schedule()
      },
    })

    for (let write = 0; write < 1_000; write += 1) scheduler.schedule()

    expect(clock.frames).toHaveLength(1)
    clock.takeFrame()()
    expect(pendingInsideFrame).toBe(false)
    expect(clock.frames).toHaveLength(1)
  })

  it('keeps unfocused, blink-disabled, and hidden idle free of pending work', () => {
    const clock = new FakeClock()
    const scheduler = createScheduler(clock, [])

    expect(scheduler.hasPendingFrame).toBe(false)
    expect(scheduler.hasPendingTimer).toBe(false)
    scheduler.setCursorBlinkEnabled(true)
    expect(scheduler.hasPendingTimer).toBe(false)
    scheduler.setDocumentVisible(false)
    scheduler.setFocused(true)

    expect(scheduler.hasPendingFrame).toBe(false)
    expect(scheduler.hasPendingTimer).toBe(false)
    expect(clock.frames).toHaveLength(0)
    expect(clock.timers).toHaveLength(0)
  })

  it('schedules exactly one frame for each eligible blink transition', () => {
    const clock = new FakeClock()
    const frames: RenderFrameState[] = []
    const scheduler = createScheduler(clock, frames)
    scheduler.setCursorBlinkEnabled(true)
    scheduler.setFocused(true)
    clock.takeFrame()()

    expect(clock.timers).toHaveLength(1)
    expect(clock.frames).toHaveLength(0)
    clock.takeTimer()()
    expect(clock.frames).toHaveLength(1)
    expect(clock.timers).toHaveLength(1)
    clock.takeFrame()()
    expect(frames.at(-1)?.cursorVisible).toBe(false)

    clock.takeTimer()()
    expect(clock.frames).toHaveLength(1)
    clock.takeFrame()()
    expect(frames.at(-1)?.cursorVisible).toBe(true)
  })

  it('clears blink work and restores the cursor when eligibility ends', () => {
    const clock = new FakeClock()
    const frames: RenderFrameState[] = []
    const scheduler = createScheduler(clock, frames)
    scheduler.setCursorBlinkEnabled(true)
    scheduler.setFocused(true)
    clock.takeFrame()()
    clock.takeTimer()()
    clock.takeFrame()()

    expect(scheduler.cursorVisible).toBe(false)
    scheduler.setFocused(false)
    expect(scheduler.cursorVisible).toBe(true)
    expect(scheduler.hasPendingTimer).toBe(false)
    expect(clock.timers).toHaveLength(0)
    expect(clock.frames).toHaveLength(1)
    clock.takeFrame()()
    expect(frames.at(-1)?.cursorVisible).toBe(true)
  })

  it('flushes a frame synchronously and defers only while hidden', () => {
    const clock = new FakeClock()
    const frames: RenderFrameState[] = []
    const scheduler = createScheduler(clock, frames)
    scheduler.schedule()
    const staleFrame = clock.takeFrame()

    scheduler.flush()
    expect(frames).toHaveLength(1)
    expect(scheduler.hasPendingFrame).toBe(false)
    staleFrame()
    expect(frames).toHaveLength(1)

    scheduler.setDocumentVisible(false)
    scheduler.flush()
    expect(frames).toHaveLength(1)
    scheduler.setDocumentVisible(true)
    clock.takeFrame()()
    expect(frames).toHaveLength(2)
  })

  it('makes callbacks captured before disposal inert', () => {
    const clock = new FakeClock()
    const frames: RenderFrameState[] = []
    const scheduler = createScheduler(clock, frames)
    scheduler.setCursorBlinkEnabled(true)
    scheduler.setFocused(true)
    const staleFrame = clock.takeFrame()
    const staleTimer = clock.takeTimer()

    scheduler.dispose()
    staleFrame()
    staleTimer()

    expect(frames).toHaveLength(0)
    expect(clock.frames).toHaveLength(0)
    expect(clock.timers).toHaveLength(0)
    expect(scheduler.hasPendingFrame).toBe(false)
    expect(scheduler.hasPendingTimer).toBe(false)
  })
})

describe('SharedRenderClock', () => {
  it('delivers seventeen pending terminals through one frame and stays idle afterward', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: RenderFrameState[] = []
    const schedulers = Array.from({ length: 17 }, () => createScheduler(clock, frames))
    for (const scheduler of schedulers) {
      scheduler.schedule()
      scheduler.schedule()
    }

    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames).toHaveLength(17)
    expect(schedulers.every((scheduler) => !scheduler.hasPendingFrame)).toBe(true)
    expect(source.frames).toHaveLength(0)
  })

  it('keeps synchronous flush and disposal independent of the remaining terminals', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: RenderFrameState[] = []
    const first = createScheduler(clock, frames)
    const second = createScheduler(clock, frames)
    first.schedule()
    second.schedule()
    first.flush()
    first.dispose()

    expect(frames).toHaveLength(1)
    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames).toHaveLength(2)
    second.schedule()
    second.dispose()
    expect(source.frames).toHaveLength(0)
  })

  it('removes a peer disposed during delivery and defers newly scheduled work', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: string[] = []
    const removed = new RenderScheduler({ clock, onFrame: () => frames.push('removed') })
    const next = new RenderScheduler({ clock, onFrame: () => frames.push('next') })
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        frames.push('first')
        removed.dispose()
        next.schedule()
      },
    })
    first.schedule()
    removed.schedule()
    source.takeFrame()()
    expect(frames).toEqual(['first'])
    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames).toEqual(['first', 'next'])
    expect(source.frames).toHaveLength(0)
  })

  it('flushes a peer mid-frame without delivering its queued callback again', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: string[] = []
    const peer = new RenderScheduler({ clock, onFrame: () => frames.push('peer') })
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        frames.push('first')
        peer.flush()
        peer.schedule()
      },
    })
    first.schedule()
    peer.schedule()
    source.takeFrame()()
    expect(frames).toEqual(['first', 'peer'])
    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames).toEqual(['first', 'peer', 'peer'])
  })

  it('moves self-scheduled work to the next frame and coalesces an already pending peer', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: string[] = []
    const peer = new RenderScheduler({ clock, onFrame: () => frames.push('peer') })
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        frames.push('first')
        first.schedule()
        peer.schedule()
      },
    })
    first.schedule()
    peer.schedule()
    source.takeFrame()()
    expect(frames).toEqual(['first', 'peer'])
    expect(source.frames).toHaveLength(1)
    first.dispose()
    expect(source.frames).toHaveLength(0)
  })

  it('ignores a canceled native callback after new work has joined the clock', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: RenderFrameState[] = []
    const scheduler = createScheduler(clock, frames)
    scheduler.schedule()
    const stale = source.takeFrame()
    scheduler.setDocumentVisible(false)
    scheduler.setDocumentVisible(true)
    stale()
    expect(frames).toHaveLength(0)
    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames).toHaveLength(1)
  })

  it('cancels hidden-document frames and blink timers, then resumes one shared frame', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: RenderFrameState[] = []
    const schedulers = Array.from({ length: 3 }, () => createScheduler(clock, frames))
    for (const scheduler of schedulers) {
      scheduler.setFocused(true)
      scheduler.setCursorBlinkEnabled(true)
    }
    expect(source.timers).toHaveLength(3)
    source.takeFrame()()
    source.takeTimer()()
    expect(schedulers[0]!.cursorVisible).toBe(false)
    for (const scheduler of schedulers) scheduler.setDocumentVisible(false)
    expect(source.frames).toHaveLength(0)
    expect(source.timers).toHaveLength(0)
    for (const scheduler of schedulers) {
      scheduler.schedule()
      scheduler.flush()
    }
    expect(frames).toHaveLength(3)
    for (const scheduler of schedulers) scheduler.setDocumentVisible(true)
    expect(source.frames).toHaveLength(1)
    source.takeFrame()()
    expect(frames.slice(3)).toEqual(Array.from({ length: 3 }, () => ({ cursorVisible: true })))
    for (const scheduler of schedulers) scheduler.dispose()
    expect(source.timers).toHaveLength(0)
  })

  it('removes hidden peers from the running frame', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: string[] = []
    const peer = new RenderScheduler({ clock, onFrame: () => frames.push('peer') })
    const first = new RenderScheduler({
      clock,
      onFrame: () => {
        frames.push('first')
        peer.setDocumentVisible(false)
      },
    })
    first.schedule()
    peer.schedule()
    source.takeFrame()()
    expect(frames).toEqual(['first'])
    expect(peer.hasPendingFrame).toBe(false)
    expect(source.frames).toHaveLength(0)
  })

  it('reports a callback failure without stranding its peers or the next frame', () => {
    const source = new FakeClock()
    const clock = new SharedRenderClock(source)
    const frames: RenderFrameState[] = []
    const error = new Error('callback failure')
    const reported: VoidFunction[] = []
    const report = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((fn) => reported.push(fn))
    try {
      const failed = new RenderScheduler({
        clock,
        onFrame: () => {
          throw error
        },
      })
      const peer = createScheduler(clock, frames)
      failed.schedule()
      peer.schedule()
      source.takeFrame()()
      expect(frames).toHaveLength(1)
      expect(reported).toHaveLength(1)
      expect(reported[0]).toThrow(error)
      peer.schedule()
      source.takeFrame()()
      expect(frames).toHaveLength(2)
    } finally {
      report.mockRestore()
    }
  })

  it('uses the same default clock for a Window and isolates other Windows', () => {
    const firstWindow = {
      cancelAnimationFrame: vi.fn(),
      clearTimeout: vi.fn(),
      requestAnimationFrame: vi.fn(() => 1),
      setTimeout: vi.fn(() => 1),
    }
    const secondWindow = { ...firstWindow }
    vi.stubGlobal('window', firstWindow)
    try {
      const first = browserRenderClock()
      expect(browserRenderClock()).toBe(first)
      vi.stubGlobal('window', secondWindow)
      expect(browserRenderClock()).not.toBe(first)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
