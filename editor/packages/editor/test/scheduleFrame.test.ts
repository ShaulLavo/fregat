import { afterEach, expect, test, vi } from 'vitest'
import { scheduleFrame } from '../src/editor/scheduleFrame'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test.each(['frame', 'timer'])('defers and cancels with %s scheduling', (kind) => {
  vi.useFakeTimers()
  const callbacks = new Map<number, FrameRequestCallback>()
  vi.stubGlobal(
    'requestAnimationFrame',
    kind === 'frame'
      ? (callback: FrameRequestCallback) => {
          const id = callbacks.size + 1
          callbacks.set(id, callback)
          return id
        }
      : undefined,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const called = vi.fn()
  const cancelled = vi.fn()
  scheduleFrame(called)
  const frame = scheduleFrame(cancelled)
  expect(called).not.toHaveBeenCalled()
  // Cancellation retains the mechanism used at scheduling time.
  vi.stubGlobal('requestAnimationFrame', undefined)
  frame.cancel()
  for (const callback of callbacks.values()) callback(10)
  vi.runAllTimers()
  expect(called).toHaveBeenCalledOnce()
  expect(called).toHaveBeenCalledWith(expect.any(Number))
  expect(cancelled).not.toHaveBeenCalled()
})
