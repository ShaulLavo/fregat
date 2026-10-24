import { describe, expect, it } from 'vitest'

import { IncrementalShikiTokenizer } from '../../src/shiki/tokenizer'
import type { StatesEqualFn, TokenizeLineFn } from '../../src/shiki'
import type { ThemedToken } from 'shiki'

// ── Mock tokenizer ─────────────────────────────────────────────
//
// Simulates block-comment grammar state propagation:
//   - `/*` anywhere on a line opens a block  (state → inBlock: true)
//   - `*/` anywhere on a line closes it      (state → inBlock: false)
//
// Tokens get a `color` tag so `tokenLinesEqual` can detect state changes.

interface MockState {
  inBlock: boolean
}

function createMockTokenizer(): {
  tokenizeLine: TokenizeLineFn
  statesEqual: StatesEqualFn
  callCount: () => number
  resetCount: () => void
} {
  let calls = 0

  const tokenizeLine: TokenizeLineFn = (line, previousState) => {
    calls++
    const prev = (previousState as MockState | undefined) ?? { inBlock: false }
    let inBlock = prev.inBlock

    if (line.includes('/*')) inBlock = true
    if (line.includes('*/')) inBlock = false

    return {
      tokens: [{ content: line, color: inBlock ? '#comment' : '#code' }] as ThemedToken[],
      state: { inBlock } satisfies MockState,
    }
  }

  const statesEqual: StatesEqualFn = (left, right) => {
    if (left === right) return true
    if (!left || !right) return false
    return (left as MockState).inBlock === (right as MockState).inBlock
  }

  return {
    tokenizeLine,
    statesEqual,
    callCount: () => calls,
    resetCount: () => {
      calls = 0
    },
  }
}

function lines(t: { getSnapshot: () => { lines: readonly { text: string }[] } }): string[] {
  return t.getSnapshot().lines.map((l) => l.text)
}

// ── Tests ──────────────────────────────────────────────────────

describe('incremental algorithm (mock tokenizer)', () => {
  it('tokenizes all lines on initial construction', () => {
    const { tokenizeLine, statesEqual, callCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'a\nb\nc')

    expect(lines(t)).toEqual(['a', 'b', 'c'])
    expect(callCount()).toBe(3)
  })

  it('returns empty patch when code is unchanged', () => {
    const { tokenizeLine, statesEqual, resetCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'a\nb')

    resetCount()
    const patch = t.update('a\nb')

    expect(patch).toEqual({
      fromLine: 0,
      toLine: 0,
      lines: [],
      fromOffset: 0,
      oldEndOffset: 0,
      newEndOffset: 0,
    })
  })

  it('update retokenizes only the changed line when state is stable', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'aaa\nbbb\nccc')

    resetCount()
    const patch = t.update('aaa\nBBB\nccc')

    // Only line 1 changed; line 2 text matches + state matches → reused
    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBe(2)
    expect(patch.lines).toHaveLength(1)
    expect(patch.lines[0]?.text).toBe('BBB')
    // Tokenized the changed line + one suffix probe that matched
    expect(callCount()).toBe(2)
    expect(lines(t)).toEqual(['aaa', 'BBB', 'ccc'])
  })

  it('update retokenizes all subsequent lines when block opens', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'code A\ncode B\ncode C')

    resetCount()
    const patch = t.update('code A\n/* open\ncode C')

    // Line 1 changed to `/* open` → state flips to inBlock
    // Line 2 must be retokenized because the state changed
    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBe(3)
    expect(callCount()).toBe(2) // line 1 + line 2
    expect(lines(t)).toEqual(['code A', '/* open', 'code C'])
  })

  it('update stops retokenizing after block closes', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const code = 'before\n/* open\nstill in\n*/\nafter A\nafter B'
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, code)

    resetCount()
    // Edit inside the block — change "still in" to "CHANGED"
    const patch = t.update('before\n/* open\nCHANGED\n*/\nafter A\nafter B')

    expect(patch.fromLine).toBe(2)
    // Should stabilize at `*/` — lines after it are unaffected
    expect(patch.toLine).toBeLessThanOrEqual(4)
    expect(lines(t)).toEqual(['before', '/* open', 'CHANGED', '*/', 'after A', 'after B'])
    // Only retokenized the changed line + one probe into suffix
    expect(callCount()).toBeLessThanOrEqual(2)
  })

  it('applyEdit replaces text and retokenizes minimally', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    //                0123456 7890123 4567890
    const code = 'line A\nline B\nline C'
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, code)

    resetCount()
    // Replace "B" with "X" at offset 12 (len 1)
    const patch = t.applyEdit({ from: 12, to: 13, text: 'X' })

    expect(t.getCode()).toBe('line A\nline X\nline C')
    expect(patch.fromLine).toBe(1)
    expect(lines(t)).toEqual(['line A', 'line X', 'line C'])
    // Tokenized the edited line; suffix state matched → no further calls
    expect(callCount()).toBe(1)
  })

  it('applyEdit propagates state change through suffix', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const code = 'code\nnormal\nafter'
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, code)

    resetCount()
    // Replace "normal" with "/* open" → opens a block that bleeds into "after"
    // "code\n" = 5 chars, "normal" at offset 5, len 6
    const patch = t.applyEdit({ from: 5, to: 11, text: '/* open' })

    expect(t.getCode()).toBe('code\n/* open\nafter')
    expect(patch.fromLine).toBe(1)
    expect(patch.toLine).toBe(3) // "after" must be retokenized
    expect(callCount()).toBe(2)
  })

  it('append fast-path extends document', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'line A')

    resetCount()
    const patch = t.update('line A\nline B\nline C')

    expect(patch.fromLine).toBe(0) // retokenizes from the last existing line
    expect(lines(t)).toEqual(['line A', 'line B', 'line C'])
    expect(callCount()).toBe(3) // last existing line + 2 new lines
  })

  it('reset retokenizes everything', () => {
    const { tokenizeLine, statesEqual, resetCount, callCount } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'old A\nold B')

    resetCount()
    const patch = t.reset('new X\nnew Y\nnew Z')

    expect(patch).toMatchObject({
      fromLine: 0,
      toLine: 2,
      lines: expect.any(Array),
    })
    expect(lines(t)).toEqual(['new X', 'new Y', 'new Z'])
    expect(callCount()).toBe(3)
  })

  it('getTokens returns tokens for all lines', () => {
    const { tokenizeLine, statesEqual } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'a\nb')

    const tokens = t.getTokens()
    expect(tokens).toHaveLength(2)
    expect(tokens[0]?.[0]?.content).toBe('a')
    expect(tokens[1]?.[0]?.content).toBe('b')
  })

  it('multiple edits accumulate correctly', () => {
    const { tokenizeLine, statesEqual } = createMockTokenizer()
    const t = new IncrementalShikiTokenizer(tokenizeLine, statesEqual, 'aaa\nbbb\nccc')

    t.update('aaa\nXXX\nccc')
    t.update('aaa\nXXX\nYYY')
    t.applyEdit({ from: 0, to: 3, text: 'ZZZ' })

    expect(lines(t)).toEqual(['ZZZ', 'XXX', 'YYY'])
    expect(t.getCode()).toBe('ZZZ\nXXX\nYYY')
  })
})
