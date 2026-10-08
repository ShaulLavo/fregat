import { expect, test } from 'vitest'
import { stressSeeds } from './stress-seeds'

test.each([100, 200, 10_000, 13])('eight shards cover all %i seeds exactly once', (count) => {
  const shards = Array.from({ length: 8 }, (_, index) => stressSeeds(count, `${index + 1}/8`))
  expect(shards.flat()).toEqual(Array.from({ length: count }, (_, seed) => seed))
  expect(new Set(shards.flat()).size).toBe(count)
  const sizes = shards.map((seeds) => seeds.length)
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
})

test('unsharded execution preserves every seed', () => {
  expect(stressSeeds(5, '')).toEqual([0, 1, 2, 3, 4])
})

test.each(['0/8', '9/8', '1/0', '1', '1/8junk', '9007199254740992/9007199254740992'])(
  'invalid shard %s fails instead of silently losing coverage',
  (shard) => {
    expect(() => stressSeeds(10_000, shard)).toThrow(TypeError)
  },
)
