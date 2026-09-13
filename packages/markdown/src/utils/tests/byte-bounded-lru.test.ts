import { expect, test } from 'vitest'

import { ByteBoundedLru } from '../byte-bounded-lru'

test('entries are evicted once the byte budget is exceeded', () => {
  const cache = new ByteBoundedLru<string>(100, 1_000)

  cache.set('a', 'first', 600)
  cache.set('b', 'second', 300)
  expect(cache.size).toBe(2)

  cache.set('c', 'third', 400)

  expect(cache.get('a')).toBeNull()
  expect(cache.get('b')).toBe('second')
  expect(cache.get('c')).toBe('third')
  expect(cache.totalBytes).toBe(700)
})

test('reading an entry makes it the last one evicted', () => {
  const cache = new ByteBoundedLru<string>(100, 1_000)

  cache.set('a', 'first', 400)
  cache.set('b', 'second', 400)
  cache.get('a')
  cache.set('c', 'third', 400)

  expect(cache.get('a')).toBe('first')
  expect(cache.get('b')).toBeNull()
})

test('a value larger than the whole budget is not stored', () => {
  const cache = new ByteBoundedLru<string>(100, 1_000)

  cache.set('a', 'first', 400)
  cache.set('huge', 'value', 2_000)

  expect(cache.get('huge')).toBeNull()
  expect(cache.get('a')).toBe('first')
  expect(cache.totalBytes).toBe(400)
})

test('the entry ceiling bounds the cache even when every value is tiny', () => {
  const cache = new ByteBoundedLru<number>(3, 1_000_000)

  for (let index = 0; index < 10; index += 1) {
    cache.set(`key-${index}`, index, 1)
  }

  expect(cache.size).toBe(3)
  expect(cache.get('key-9')).toBe(9)
  expect(cache.get('key-6')).toBeNull()
})

test('re-setting a key replaces its byte cost instead of double counting', () => {
  const cache = new ByteBoundedLru<string>(100, 1_000)

  cache.set('a', 'first', 300)
  cache.set('a', 'second', 100)

  expect(cache.size).toBe(1)
  expect(cache.totalBytes).toBe(100)
  expect(cache.get('a')).toBe('second')
})
