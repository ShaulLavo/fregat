import { afterEach, vi } from 'vitest'

import {
  COARSE_CLOCK_INTERVAL_MS,
  retainCoarseClock,
  setCoarseClockNow,
  coarseClockStore,
} from '@/state/coarse-clock'
import { expect, test } from '../../../test/fixtures'

const releases: Array<() => void> = []

afterEach(() => {
  for (const release of releases.splice(0)) release()
  vi.useRealTimers()
})

function retain() {
  const release = retainCoarseClock()
  releases.push(release)
  return release
}

test('the clock stamps on retain and advances once a full minute elapses', () => {
  vi.useFakeTimers()
  vi.setSystemTime(120_000)
  setCoarseClockNow(0)
  retain()
  expect(coarseClockStore.getState().nowMs).toBe(120_000)
  vi.advanceTimersByTime(COARSE_CLOCK_INTERVAL_MS - 1)
  expect(coarseClockStore.getState().nowMs).toBe(120_000)
  vi.advanceTimersByTime(1)
  expect(coarseClockStore.getState().nowMs).toBe(180_000)
})

test('one interval serves every watcher and stops after the final release', () => {
  vi.useFakeTimers()
  vi.setSystemTime(120_000)
  const first = retain()
  const second = retain()
  expect(vi.getTimerCount()).toBe(1)
  first()
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(COARSE_CLOCK_INTERVAL_MS)
  expect(coarseClockStore.getState().nowMs).toBe(180_000)
  second()
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(COARSE_CLOCK_INTERVAL_MS)
  expect(coarseClockStore.getState().nowMs).toBe(180_000)
  retain()
  expect(coarseClockStore.getState().nowMs).toBe(240_000)
})

test('releasing twice preserves the remaining watcher interval', () => {
  vi.useFakeTimers()
  const first = retain()
  const second = retain()
  first()
  first()
  expect(vi.getTimerCount()).toBe(1)
  second()
  expect(vi.getTimerCount()).toBe(0)
})

test('the resolution matches minute-granularity labels', () => {
  expect(COARSE_CLOCK_INTERVAL_MS).toBe(60_000)
})
