import { afterEach, expect, test, vi } from 'vitest'
import { elapsedMs, nowMs, roundMs } from '../timing'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('keeps a zero performance timestamp and binds the performance receiver', () => {
  const clock = {
    now() {
      expect(this).toBe(clock)
      return 0
    },
  }
  vi.stubGlobal('performance', clock)
  vi.spyOn(Date, 'now').mockReturnValue(9000)
  expect(nowMs()).toBe(0)
})

test('uses the wall clock only when the performance clock is unavailable', () => {
  vi.stubGlobal('performance', undefined)
  vi.spyOn(Date, 'now').mockReturnValue(12345)
  expect(nowMs()).toBe(12345)
})

test('preserves hundredth precision and negative elapsed durations', () => {
  vi.stubGlobal('performance', { now: () => 10.126 })
  expect(elapsedMs(10)).toBe(0.13)
  expect(elapsedMs(11)).toBe(-0.87)
  expect(roundMs(123.456)).toBe(123.46)
})
