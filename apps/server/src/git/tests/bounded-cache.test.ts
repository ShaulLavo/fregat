import { describe, expect, it } from 'vitest'
import { BoundedTtlCache } from '../utils/bounded-cache'

describe('bounded ttl cache', () => {
  it('serves an entry until its ttl elapses and reloads after', async () => {
    const clock = manualClock()
    const cache = new BoundedTtlCache<string>({ capacity: 4, now: clock.now, ttlMs: 1_000 })
    const loads: number[] = []
    const load = () => cache.load('key', async () => `value-${loads.push(0)}`)

    expect(await load()).toBe('value-1')
    clock.advance(999)
    expect(await load()).toBe('value-1')

    clock.advance(1)
    expect(await load()).toBe('value-2')
    expect(loads).toHaveLength(2)
  })

  it('evicts the oldest entry once capacity is exceeded', async () => {
    const clock = manualClock()
    const cache = new BoundedTtlCache<string>({ capacity: 2, now: clock.now, ttlMs: 10_000 })

    await cache.load('a', async () => 'a')
    await cache.load('b', async () => 'b')
    await cache.load('c', async () => 'c')

    expect(cache.size).toBe(2)
    expect(cache.read('a')).toBeUndefined()
    expect(await cache.read('c')).toBe('c')
  })

  it('gives a resolved value its own ttl so a negative answer can expire sooner', async () => {
    const clock = manualClock()
    const cache = new BoundedTtlCache<string | null>({
      capacity: 4,
      now: clock.now,
      ttlMs: (value) => (value === null ? 100 : 10_000),
    })

    await cache.load('miss', async () => null)
    await cache.load('hit', async () => 'found')
    clock.advance(101)

    expect(cache.read('miss')).toBeUndefined()
    expect(await cache.read('hit')).toBe('found')
  })

  it('collapses concurrent loads for one key into a single in-flight call', async () => {
    const cache = new BoundedTtlCache<string>({ capacity: 4, ttlMs: 1_000 })
    let calls = 0
    const loader = async () => {
      calls += 1
      await Promise.resolve()
      return 'value'
    }

    const [first, second] = await Promise.all([
      cache.load('key', loader),
      cache.load('key', loader),
    ])

    expect([first, second]).toEqual(['value', 'value'])
    expect(calls).toBe(1)
  })

  it('never caches a failed load', async () => {
    const cache = new BoundedTtlCache<string>({ capacity: 4, ttlMs: 10_000 })

    await expect(cache.load('key', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')

    expect(cache.read('key')).toBeUndefined()
    expect(await cache.load('key', async () => 'recovered')).toBe('recovered')
  })

  it('invalidates every key under a prefix', async () => {
    const cache = new BoundedTtlCache<string>({ capacity: 8, ttlMs: 10_000 })

    await cache.load('/repo#', async () => 'root')
    await cache.load('/repo#src', async () => 'src')
    await cache.load('/other#', async () => 'other')

    cache.invalidatePrefix('/repo#')

    expect(cache.read('/repo#')).toBeUndefined()
    expect(cache.read('/repo#src')).toBeUndefined()
    expect(await cache.read('/other#')).toBe('other')
  })
})

function manualClock() {
  let current = 1_000

  return {
    advance: (ms: number) => {
      current += ms
    },
    now: () => current,
  }
}

it('starts the git TTL after loading and leaves an in-flight value available', async () => {
  const clock = manualClock()
  const cache = new BoundedTtlCache<string>({ capacity: 2, ttlMs: 10, now: clock.now })
  const pending = Promise.withResolvers<string>()
  const loaded = cache.load('pending', () => pending.promise)

  clock.advance(100)
  expect(cache.size).toBe(1)
  expect(cache.read('pending')).toBe(pending.promise)
  pending.resolve('ready')
  await loaded

  clock.advance(9)
  expect(await cache.read('pending')).toBe('ready')
  clock.advance(1)
  expect(cache.read('pending')).toBeUndefined()
})
