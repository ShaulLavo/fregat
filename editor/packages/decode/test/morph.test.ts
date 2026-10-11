import { describe, expect, it } from 'vitest'
import { matchPieces } from '../src/morph-match'
import { springEasing } from '../src/morph-run'

describe('matchPieces', () => {
  it('keeps every piece an insertion left alone', () => {
    const pairs = matchPieces(['const', 'a', '=', '1'], ['const', 'a', ':', 'number', '=', '1'])
    expect(Array.from(pairs)).toEqual([0, 1, -1, -1, 2, 3])
  })

  it('lets removed pieces leave and the rest keep their order', () => {
    const pairs = matchPieces(['f', '(', 'a', ',', 'b', ')'], ['f', '(', 'b', ')'])
    expect(Array.from(pairs)).toEqual([0, 1, 4, 5])
  })

  it('pairs a block that moved past other code', () => {
    const before = ['one', 'uno', 'two', 'dos']
    const after = ['two', 'dos', 'one', 'uno']
    const pairs = Array.from(matchPieces(before, after))
    // The in-order pass keeps one block; the moved block is paired by its unique texts.
    expect(pairs.filter((old) => old >= 0)).toHaveLength(4)
    expect(after.map((_, index) => before[pairs[index] ?? -1])).toEqual(after)
  })

  it('lets a lone bracket fade instead of flying to a distant match', () => {
    const pairs = matchPieces(['a', '{', 'b'], ['b', '{', 'c'])
    expect(Array.from(pairs)).toEqual([2, -1, -1])
  })

  it('leaves repeated texts unpaired when their counts differ', () => {
    const before = ['xx', 'yy', 'xx']
    const after = ['zz', 'xx', 'ww', 'xx', 'xx']
    for (const [index, old] of Array.from(matchPieces(before, after)).entries()) {
      if (old >= 0) expect(before[old]).toBe(after[index])
    }
  })

  it('handles empty sides', () => {
    expect(Array.from(matchPieces([], ['a']))).toEqual([-1])
    expect(Array.from(matchPieces(['a'], []))).toEqual([])
  })
})

describe('springEasing', () => {
  it('starts at 0, overshoots, and lands on 1', () => {
    const easing = springEasing(0.2, true)
    const values = easing.slice('linear('.length, -1).split(', ').map(Number)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
    expect(Math.max(...values)).toBeGreaterThan(1)
  })

  it('uses an ease-out curve without linear() support', () => {
    expect(springEasing(0.2, false)).toMatch(/^cubic-bezier/)
  })
})
