import { expect, test, vi } from 'vitest'
import { cacheShapedRuns } from '../src/virtualization/shapedRunCache'

test('reuses complete run widths, including zero-width runs', () => {
  const measure = vi.fn((text: string) => text.length)
  const cached = cacheShapedRuns(measure)
  for (const text of ['', 'AV ffi', 'AV ffi', '']) expect(cached(text)).toBe(text.length)
  expect(measure).toHaveBeenCalledTimes(2)
})

test('keeps each face independent', () => {
  const a = cacheShapedRuns(() => 2)
  const b = cacheShapedRuns(() => 3)
  expect(a('i')).toBe(2)
  expect(b('i')).toBe(3)
})

test('bounds retained run count', () => {
  const measure = vi.fn((text: string) => text.length)
  const cached = cacheShapedRuns(measure)
  cached('first')
  for (let index = 0; index < 512; index += 1) cached(String(index))
  cached('first')
  expect(measure).toHaveBeenCalledTimes(514)
})

test('bounds retained code units and bypasses oversized runs', () => {
  const measure = vi.fn((text: string) => text.length)
  const cached = cacheShapedRuns(measure)
  const first = 'a'.repeat(40_000)
  const second = 'b'.repeat(40_000)
  cached(first)
  cached(second)
  cached(first)
  const oversized = 'c'.repeat(70_000)
  cached(oversized)
  cached(oversized)
  cached(first)
  expect(measure).toHaveBeenCalledTimes(5)
})
