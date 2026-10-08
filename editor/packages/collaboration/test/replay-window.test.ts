import { strictEqual } from 'node:assert'
import { expect, test } from 'vitest'
import { ReplayWindow } from '../src/replay-window'

function* permutations(values: readonly number[]): Generator<readonly number[]> {
  if (!values.length) {
    yield []
    return
  }
  for (const value of values)
    for (const rest of permutations(values.filter((other) => other !== value)))
      yield [value, ...rest]
}

test('every ordering inside the window accepts each ID once', () => {
  const size = process.env.COLLABORATION_LONG_RUN === '1' ? 8 : 6
  let orderings = 0
  for (const ids of permutations(Array.from({ length: size }, (_, index) => index + 1))) {
    const window = new ReplayWindow(size)
    for (const id of ids) {
      strictEqual(window.accept(id), true)
      strictEqual(window.accept(id), false)
    }
    for (const id of ids) strictEqual(window.accept(id), false)
    orderings++
  }
  expect(orderings).toBe(size === 8 ? 40_320 : 720)
  console.log(`Replay permutations: ${size} IDs; ${orderings} orderings passed`)
})

test.each([1, 8, 31, 32, 33, 1024])('ring rollover keeps the exact %i-ID window', (size) => {
  const window = new ReplayWindow(size)
  for (let id = 1; id <= size * 3; id++) expect(window.accept(id)).toBe(true)
  for (let id = 1; id <= size * 3; id++) expect(window.accept(id)).toBe(false)
  const highest = size * 5
  expect(window.accept(highest)).toBe(true)
  expect(window.accept(highest - size)).toBe(false)
  for (let id = highest - size + 1; id < highest; id++) {
    expect(window.accept(id)).toBe(true)
    expect(window.accept(id)).toBe(false)
  }
})

test('sparse global sender IDs and large jumps keep old duplicates fenced', () => {
  const window = new ReplayWindow(8)
  expect(window.accept(3)).toBe(true)
  expect(window.accept(9)).toBe(true)
  expect(window.accept(3)).toBe(false)
  expect(window.accept(2)).toBe(true)
  expect(window.accept(10)).toBe(true)
  expect(window.accept(2)).toBe(false)
  expect(window.accept(100_000)).toBe(true)
  expect(window.accept(9)).toBe(false)
  expect(window.accept(99_993)).toBe(true)
  expect(window.accept(99_992)).toBe(false)
  expect(window.accept(Number.MAX_SAFE_INTEGER)).toBe(true)
  expect(window.accept(Number.MAX_SAFE_INTEGER)).toBe(false)
  expect(window.accept(Number.MAX_SAFE_INTEGER - 7)).toBe(true)
  expect(window.accept(Number.MAX_SAFE_INTEGER - 8)).toBe(false)
})
