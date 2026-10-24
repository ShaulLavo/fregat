import { describe, expect, it } from 'vitest'

import {
  bracketJumpTargetOffset,
  collectBracketLevels,
  findBracketMatchAtCaret,
} from '../src/editor/bracketMatching'
import type { BracketInfo } from '../src/syntax/session'

/**
 * Builds the bracket list the syntax worker would ship for `text`, mirroring its rules: sorted by
 * index, depth counted with the opener included, and a closer keeping the depth it saw before
 * popping. Only bracket characters are recorded, so anything the worker would treat as string or
 * comment content simply must not appear in these fixtures.
 */
function bracketsFor(text: string): BracketInfo[] {
  const pairs: Record<string, string | undefined> = { '(': ')', '[': ']', '{': '}' }
  const closers = new Set(Object.values(pairs))
  const stack: string[] = []
  const brackets: BracketInfo[] = []

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === undefined) continue

    if (pairs[char] !== undefined) {
      stack.push(char)
      brackets.push({ char, depth: stack.length, index })
      continue
    }
    if (!closers.has(char)) continue

    const depth = stack.length > 0 ? stack.length : 1
    const top = stack[stack.length - 1]
    if (top !== undefined && pairs[top] === char) stack.pop()
    brackets.push({ char, depth, index })
  }

  return brackets
}

describe('findBracketMatchAtCaret', () => {
  it('pairs a caret sitting just after an opening bracket', () => {
    const text = 'fn(a)'
    const match = findBracketMatchAtCaret(bracketsFor(text), text.indexOf('(') + 1)

    expect(match).toEqual({ closeOffset: 4, openOffset: 2 })
  })

  it('pairs a caret sitting just after a closing bracket', () => {
    const text = 'fn(a)'
    const match = findBracketMatchAtCaret(bracketsFor(text), text.length)

    expect(match).toEqual({ closeOffset: 4, openOffset: 2 })
  })

  it('pairs a caret sitting directly on a bracket', () => {
    const text = 'fn(a)'
    const match = findBracketMatchAtCaret(bracketsFor(text), text.indexOf('('))

    expect(match).toEqual({ closeOffset: 4, openOffset: 2 })
  })

  it('skips nested pairs to find the partner at its own level', () => {
    const text = '{ a([1, 2]) }'
    const match = findBracketMatchAtCaret(bracketsFor(text), 1)

    expect(match).toEqual({ closeOffset: text.length - 1, openOffset: 0 })
  })

  it('matches the inner pair when the caret is inside a nest', () => {
    const text = '{ a([1, 2]) }'
    const match = findBracketMatchAtCaret(bracketsFor(text), text.indexOf('[') + 1)

    expect(match).toEqual({ closeOffset: text.indexOf(']'), openOffset: text.indexOf('[') })
  })

  it('returns null when the caret touches no bracket', () => {
    const text = 'fn(a)'
    expect(findBracketMatchAtCaret(bracketsFor(text), 1)).toBeNull()
  })

  it('returns null for an unclosed bracket', () => {
    const text = 'fn(a'
    expect(findBracketMatchAtCaret(bracketsFor(text), 3)).toBeNull()
  })

  it('returns null for an unopened closing bracket', () => {
    const text = 'a)'
    expect(findBracketMatchAtCaret(bracketsFor(text), 2)).toBeNull()
  })

  // The worker gives `{` and `]` the same depth here, so a depth-only matcher would pair them.
  it('refuses to pair mismatched characters at the same depth', () => {
    const text = '{ a ]'
    expect(findBracketMatchAtCaret(bracketsFor(text), 1)).toBeNull()
  })

  it('returns null on an empty bracket list', () => {
    expect(findBracketMatchAtCaret([], 0)).toBeNull()
  })

  it('gives up once the scan budget is exhausted', () => {
    const text = `(${'[]'.repeat(50)})`
    const brackets = bracketsFor(text)

    expect(findBracketMatchAtCaret(brackets, 1, 4)).toBeNull()
    expect(findBracketMatchAtCaret(brackets, 1)).toEqual({
      closeOffset: text.length - 1,
      openOffset: 0,
    })
  })
})

describe('bracketJumpTargetOffset', () => {
  it('jumps forward to just past the closing bracket', () => {
    const text = 'fn(a)'
    expect(bracketJumpTargetOffset(bracketsFor(text), 3)).toBe(5)
  })

  it('jumps back to just past the opening bracket', () => {
    const text = 'fn(a)'
    expect(bracketJumpTargetOffset(bracketsFor(text), 5)).toBe(3)
  })

  it('round-trips: jumping twice returns to the starting caret', () => {
    const text = '{ a([1, 2]) }'
    const brackets = bracketsFor(text)
    const first = bracketJumpTargetOffset(brackets, 1)

    expect(first).not.toBeNull()
    expect(bracketJumpTargetOffset(brackets, first ?? 0)).toBe(1)
  })

  it('returns null when there is nothing to jump to', () => {
    expect(bracketJumpTargetOffset(bracketsFor('fn(a'), 3)).toBeNull()
  })
})

describe('collectBracketLevels', () => {
  it('numbers nesting from zero at the outermost pair', () => {
    const text = '{ a([1, 2]) }'

    expect(collectBracketLevels(bracketsFor(text))).toEqual([
      { char: '{', level: 0, offset: 0, unexpected: false },
      { char: '(', level: 1, offset: 3, unexpected: false },
      { char: '[', level: 2, offset: 4, unexpected: false },
      { char: ']', level: 2, offset: 9, unexpected: false },
      { char: ')', level: 1, offset: 10, unexpected: false },
      { char: '}', level: 0, offset: 12, unexpected: false },
    ])
  })

  // The worker's depth field never pops the unclosed `{`, so it reports the closer of the outer pair
  // one level deeper than its opener and shifts the following pair down by two.
  it('re-syncs levels after an unclosed bracket instead of carrying the drift forward', () => {
    const text = '[ { ] [ ]'
    const brackets = bracketsFor(text)

    expect(brackets.map((bracket) => bracket.depth - 1)).toEqual([0, 1, 1, 2, 2])
    expect(collectBracketLevels(brackets).map((bracket) => bracket.level)).toEqual([0, 1, 0, 0, 0])
  })

  it('keeps an unclosed opener at the level it was written at', () => {
    const levels = collectBracketLevels(bracketsFor('fn(a'))

    expect(levels).toEqual([{ char: '(', level: 0, offset: 2, unexpected: false }])
  })

  it('flags a closer with nothing to close', () => {
    const levels = collectBracketLevels(bracketsFor('a) fn(b)'))

    expect(levels).toEqual([
      { char: ')', level: 0, offset: 1, unexpected: true },
      { char: '(', level: 0, offset: 5, unexpected: false },
      { char: ')', level: 0, offset: 7, unexpected: false },
    ])
  })

  it('reports nothing below the level cap', () => {
    const text = '{ [ ( ) ] }'
    const levels = collectBracketLevels(bracketsFor(text), { maxLevel: 2 })

    expect(levels.map((bracket) => bracket.offset)).toEqual([0, 2, 8, 10])
  })

  it('pairs across a bracket type the cap dropped', () => {
    const text = '{ [ ( ) ] }'
    const levels = collectBracketLevels(bracketsFor(text), { maxLevel: 1 })

    expect(levels).toEqual([
      { char: '{', level: 0, offset: 0, unexpected: false },
      { char: '}', level: 0, offset: 10, unexpected: false },
    ])
  })

  it('returns nothing for an empty bracket list', () => {
    expect(collectBracketLevels([])).toEqual([])
  })
})
