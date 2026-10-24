import { describe, expect, it } from 'vitest'
import {
  isWholeWordRange,
  lineRangeAtOffset,
  nextWordOffset,
  nextWordStartOffset,
  normalizeTextOffsetRanges,
  previousWordEndOffset,
  previousWordOffset,
  wordRangeAtOffset,
  wordSeparatorsForLanguage,
} from '../src/textRanges'

describe('text range helpers', () => {
  it('finds line ranges at clamped offsets', () => {
    const text = 'one two\nthree'

    expect(lineRangeAtOffset(text, 5)).toEqual({ start: 0, end: 7 })
    expect(lineRangeAtOffset(text, 99)).toEqual({ start: 8, end: 13 })
  })

  it('gives the empty first line its own range when the text opens with a line break', () => {
    expect(lineRangeAtOffset('\nabc', 0)).toEqual({ start: 0, end: 0 })
    expect(lineRangeAtOffset('\nabc', 1)).toEqual({ start: 1, end: 4 })
  })

  it('moves by word boundaries without splitting surrogate pairs', () => {
    const text = 'alpha 😀 beta'

    expect(nextWordOffset(text, 0)).toBe(6)
    expect(nextWordOffset(text, 6)).toBe(9)
    expect(previousWordOffset(text, text.length)).toBe(9)
  })

  it('does not carry word motion across a line break', () => {
    const text = 'alpha beta\ngamma'

    expect(nextWordOffset(text, 10)).toBe(10)
    expect(previousWordOffset(text, 11)).toBe(11)
  })

  it('reads a character the separator set does not name as part of the word', () => {
    expect(nextWordOffset('50€ next', 0)).toBe(4)
  })

  it('breaks words on the separator set the caller supplies', () => {
    const text = '--brand-color: red'

    expect(nextWordOffset(text, 0)).toBe(2)
    expect(nextWordOffset(text, 0, wordSeparatorsForLanguage('css'))).toBe(13)
  })

  it('reports the neighbouring word edge without the whitespace beside it', () => {
    const text = 'foo bar'

    expect(nextWordStartOffset(text, 0)).toBe(4)
    expect(nextWordStartOffset(text, 3)).toBe(4)
    expect(nextWordOffset(text, 3)).toBe(7)
    expect(previousWordEndOffset(text, 4)).toBe(3)
    expect(previousWordOffset(text, 4)).toBe(0)
  })

  it('expands word ranges around unicode letters and word-end offsets', () => {
    const text = 'café 😀 beta_2'

    expect(wordRangeAtOffset(text, 4)).toEqual({ start: 0, end: 4 })
    expect(wordRangeAtOffset(text, 6)).toEqual({ start: 6, end: 6 })
    expect(wordRangeAtOffset(text, text.length)).toEqual({ start: 8, end: 14 })
  })

  it('checks whole-word ranges with shared word classification', () => {
    expect(isWholeWordRange('foo food', { start: 0, end: 3 })).toBe(true)
    expect(isWholeWordRange('foo food', { start: 4, end: 7 })).toBe(false)
    expect(isWholeWordRange('café!', { start: 0, end: 4 })).toBe(true)
  })

  it('clamps and orders text ranges', () => {
    expect(
      normalizeTextOffsetRanges('abcd', [
        { start: 3, end: 9 },
        { start: -2, end: 1 },
        { start: 3, end: 2 },
      ]),
    ).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 4 },
    ])
  })
})
