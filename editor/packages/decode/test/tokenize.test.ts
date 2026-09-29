import { describe, expect, it } from 'vitest'
import { tokenizeLengths } from '../src/tokenize'

describe('tokenizeLengths', () => {
  it('partitions the line — lengths sum to the text length', () => {
    const text = '  const x = foo(bar)'
    expect(tokenizeLengths(text).reduce((a, b) => a + b, 0)).toBe(text.length)
  })

  it('chunks words with leading space and mid-line punctuation singly', () => {
    // "a" | " =" | " b" | " +" | " c" — punctuation with a word after it stays its own token
    expect(tokenizeLengths('a = b + c')).toEqual([1, 2, 2, 2, 2])
  })

  it('folds a trailing punctuation run into the token before it', () => {
    // "function" | " f() {" — the closing brackets never reveal as a lone last beat
    expect(tokenizeLengths('function f() {')).toEqual([8, 6])
    // "foo" | "(" | "bar)" — the trailing ")" joins "bar"; the opening "(" stays mid-line
    expect(tokenizeLengths('foo(bar)')).toEqual([3, 1, 4])
  })

  it('collapses a punctuation-only line into one token', () => {
    expect(tokenizeLengths('  });')).toEqual([5])
  })

  it('treats indentation as a single token', () => {
    // "    " | "return" | " x"
    expect(tokenizeLengths('    return x')).toEqual([4, 6, 2])
  })

  it('returns nothing for an empty line', () => {
    expect(tokenizeLengths('')).toEqual([])
  })
})
