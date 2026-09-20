import { expect, test } from 'vitest'
import { BoundedTtlCache } from '../provider-runtime-buffers'

test('refreshes expiry and write order only when a runtime value is written', () => {
  let now = 0
  const cache = new BoundedTtlCache<string, number>({ capacity: 2, ttlMs: 10, now: () => now })
  cache.set('first', 1)
  cache.set('second', 2)
  expect(cache.get('first')).toBe(1)
  cache.set('third', 3)
  expect(cache.get('first')).toBeUndefined()

  now = 5
  cache.set('second', 20)
  now = 10
  expect(cache.keys()).toEqual(['second'])
  expect(cache.get('second')).toBe(20)
  now = 15
  expect(cache.has('second')).toBe(false)
})

test('runtime reads expire only the requested key without scanning other entries', () => {
  let clockReads = 0
  const cache = new BoundedTtlCache<string, number>({
    capacity: 100,
    ttlMs: 10,
    now: () => {
      clockReads += 1
      return 0
    },
  })
  for (let index = 0; index < 100; index += 1) cache.set(String(index), index)
  clockReads = 0

  expect(cache.get('42')).toBe(42)
  expect(clockReads).toBe(1)
})
