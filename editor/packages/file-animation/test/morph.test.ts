import { describe, expect, it } from 'vitest'
import { matchPieces } from '../src/morph-match'
import { springEasing } from '../src/morph-run'

describe('matchPieces', () => {
  it('keeps every piece an insertion left alone', () => {
    const pairs = matchPieces(line(0, 'const a = 1'), line(0, 'const a : number = 1'))
    expect(Array.from(pairs)).toEqual([0, 1, -1, -1, 2, 3])
  })

  it('lets removed pieces leave and the rest keep their order', () => {
    const pairs = matchPieces(line(0, 'f ( a , b )'), line(0, 'f ( b )'))
    expect(Array.from(pairs)).toEqual([0, 1, 4, 5])
  })

  it('pairs a block that moved past other code', () => {
    const before = line(0, 'one uno').concat(line(1, 'two dos'))
    const after = line(0, 'two dos').concat(line(1, 'one uno'))
    const pairs = Array.from(matchPieces(before, after))
    expect(pairs.filter((old) => old >= 0)).toHaveLength(4)
    expect(after.map((_, index) => before[pairs[index] ?? -1]?.text)).toEqual(
      after.map((piece) => piece.text),
    )
  })

  it('moves swapped lines whole, punctuation and shared words included', () => {
    const first = 'const a = f ( 1 ) ;'
    const second = 'const b = g ( 2 ) ;'
    const before = line(0, first).concat(line(1, second))
    const after = line(0, second).concat(line(1, first))
    const pairs = Array.from(matchPieces(before, after))
    // Every piece continues the one on the same text's old line: nothing fades.
    expect(pairs).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('moves a line whole when highlighting split it differently', () => {
    const before = line(0, 'total ( items : number []|): {')
    const after = line(0, 'const x').concat(line(20, 'total ( items : number []): {'))
    const pairs = Array.from(matchPieces(before, after))
    // `[]):` moves from where `[]` started; `):` has no piece of its own any more and leaves.
    expect(pairs).toEqual([-1, -1, 0, 1, 2, 3, 4, 5, 7])
  })

  it('tells lines apart by their spaces', () => {
    const before = line(0, 'foo bar').concat(line(20, 'foobar'))
    const after = line(0, 'foobar').concat(line(20, 'foo bar'))
    // `foobar` and `foo bar` swap places whole, each from its own old line.
    expect(Array.from(matchPieces(before, after))).toEqual([2, 0, 1])
  })

  it('lets a lone bracket fade instead of flying to a distant match', () => {
    const pairs = matchPieces(line(0, 'a { b'), line(0, 'b { c'))
    expect(Array.from(pairs)).toEqual([2, -1, -1])
  })

  it('leaves repeated texts unpaired when their counts differ', () => {
    const before = line(0, 'xx yy xx')
    const after = line(0, 'zz xx ww xx xx')
    for (const [index, old] of Array.from(matchPieces(before, after)).entries()) {
      if (old >= 0) expect(before[old]?.text).toBe(after[index]?.text)
    }
  })

  it('handles empty sides', () => {
    expect(Array.from(matchPieces([], line(0, 'a')))).toEqual([-1])
    expect(Array.from(matchPieces(line(0, 'a'), []))).toEqual([])
  })
})

/** One line's pieces: spaces are gaps between pieces, `|` splits a piece where no gap is. */
function line(top: number, texts: string) {
  return texts
    .split(' ')
    .flatMap((word, index) =>
      word.split('|').map((text, part) => ({ text, top, gapBefore: index > 0 && part === 0 })),
    )
}

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
