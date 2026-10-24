import { describe, expect, it } from 'vitest'
import type * as lsp from 'vscode-languageserver-protocol'

import { decodeSemanticTokens, type SemanticTokenDecodeDocument } from '../src/semanticTokenDecoder'

const TEXT = ['const value = 1', 'const other = 2', 'const third = 3'].join('\n')

const DOCUMENT: SemanticTokenDecodeDocument = {
  lineStarts: lineStartsOf(TEXT),
  textLength: TEXT.length,
}

const LEGEND: lsp.SemanticTokensLegend = {
  tokenTypes: ['variable', 'function', 'keyword'],
  tokenModifiers: ['declaration', 'readonly'],
}

const NO_DROPS = {
  malformedTuple: 0,
  outOfLegendType: 0,
  pastEndOfDocument: 0,
  unknownModifierBits: 0,
  zeroLength: 0,
}

function lineStartsOf(text: string): readonly number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

describe('decodeSemanticTokens', () => {
  it('walks the relative cursor into absolute offsets', () => {
    const result = decodeSemanticTokens(
      [
        // line 0, char 6, length 5, `variable`, declared
        0, 6, 5, 0, 1,
        // same line, +8 from the previous START, length 1, `keyword`
        0, 8, 1, 2, 0,
        // next line, char 0, length 5, `keyword`
        1, 0, 5, 2, 0,
      ],
      LEGEND,
      DOCUMENT,
    )

    expect(result.spans).toEqual([
      { start: 6, end: 11, tokenType: 'variable', tokenModifiers: ['declaration'] },
      { start: 14, end: 15, tokenType: 'keyword' },
      { start: 16, end: 21, tokenType: 'keyword' },
    ])
    expect(result.drops).toEqual(NO_DROPS)
  })

  /**
   * One fixture, not three. The rejection rules share a stateful cursor, so proving each of them
   * separately proves only that none of them throws — what has to be shown is that the four valid
   * tuples still land at the right offsets *with* the rejected ones interleaved among them, which is
   * exactly what a rule that drops without advancing would break.
   */
  it('advances the cursor across every tuple it rejects', () => {
    const result = decodeSemanticTokens(
      [
        0,
        0,
        5,
        2,
        0, // valid: `const` on line 0
        0,
        6,
        5,
        0,
        0, // valid: `value` on line 0
        0,
        8,
        1,
        9,
        0, // rejected: token type index 9 is outside a 3-entry legend
        1,
        0,
        0,
        2,
        0, // rejected: zero length
        0,
        6,
        5,
        0,
        4, // valid: `other`, with a modifier bit the 2-entry legend does not name
        1,
        6,
        5,
        0,
        0, // valid: `third`
      ],
      LEGEND,
      DOCUMENT,
    )

    expect(result.spans).toEqual([
      { start: 0, end: 5, tokenType: 'keyword' },
      { start: 6, end: 11, tokenType: 'variable' },
      { start: 22, end: 27, tokenType: 'variable' },
      { start: 38, end: 43, tokenType: 'variable' },
    ])
    expect(TEXT.slice(22, 27)).toBe('other')
    expect(TEXT.slice(38, 43)).toBe('third')
    expect(result.drops).toEqual({
      malformedTuple: 0,
      outOfLegendType: 1,
      pastEndOfDocument: 0,
      unknownModifierBits: 1,
      zeroLength: 1,
    })
  })

  it('reports every drop as zero for a clean response', () => {
    expect(decodeSemanticTokens([0, 0, 5, 2, 0], LEGEND, DOCUMENT).drops).toEqual(NO_DROPS)
  })

  /**
   * Rule 1. Real legends carry the same name at several indices — one server ships `variable` at
   * three distinct indices — so a decoder that inverted the legend into a name-to-index map would
   * silently mis-decode every duplicate. Decoding by index cannot.
   */
  it('decodes a duplicated legend name at both of its indices', () => {
    const legend: lsp.SemanticTokensLegend = {
      tokenTypes: ['variable', 'a', 'b', 'c', 'd', 'e', 'f', 'variable'],
      tokenModifiers: [],
    }
    const result = decodeSemanticTokens([0, 0, 5, 0, 0, 0, 6, 5, 7, 0], legend, DOCUMENT)

    expect(result.spans).toHaveLength(2)
    expect(result.spans.map((span) => span.tokenType)).toEqual(['variable', 'variable'])
  })

  it('keeps the span when a modifier bit is outside the legend, losing only the bit', () => {
    const result = decodeSemanticTokens([0, 0, 5, 0, 0b101], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([
      { start: 0, end: 5, tokenType: 'variable', tokenModifiers: ['declaration'] },
    ])
    expect(result.drops.unknownModifierBits).toBe(1)
  })

  it('decodes a span that crosses a newline', () => {
    const result = decodeSemanticTokens([0, 6, 12, 0, 0], LEGEND, DOCUMENT)
    const span = result.spans[0]

    expect(span).toBeDefined()
    expect(TEXT.slice(0, span?.start).includes('\n')).toBe(false)
    expect(TEXT.slice(span?.start, span?.end)).toContain('\n')
  })

  it('drops a tuple past the last line and keeps the ones before it', () => {
    const result = decodeSemanticTokens([0, 0, 5, 2, 0, 40, 0, 3, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([{ start: 0, end: 5, tokenType: 'keyword' }])
    expect(result.drops.pastEndOfDocument).toBe(1)
  })

  /**
   * The character axis of "past the end of the document". A response describing a longer document
   * than the one it is decoded against — the ordinary stale-snapshot case — sends tuples with a real
   * length whose start clamps away to nothing. Counting those as zero-length would tell the host its
   * server emits empty tokens, when what actually happened is on the host's own side.
   */
  it('counts a tuple that clamps away as past the end, not as zero-length', () => {
    const result = decodeSemanticTokens([2, 40, 5, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([])
    expect(result.drops.pastEndOfDocument).toBe(1)
    expect(result.drops.zeroLength).toBe(0)
  })

  /**
   * The half of the character axis that `textLength` alone cannot see, and the reason the check is
   * against `lineStarts[line + 1]`.
   *
   * Line 0 is fifteen characters long and the document is forty-seven, so a tuple placed at line 0
   * character 40 — what a host holding a snapshot from before that line was shortened sends —
   * has a start that clamps to nothing at all. It is a perfectly valid offset: it lands on line 3.
   * Decoded that way it painted `ird =` in the middle of an unrelated line and reported a clean
   * decode, which is worse than dropping it, because the host has no way to notice.
   */
  it('drops a tuple beginning past the end of its own line, not of the document', () => {
    const result = decodeSemanticTokens([0, 40, 5, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([])
    expect(result.drops.pastEndOfDocument).toBe(1)
    expect(result.drops.zeroLength).toBe(0)
  })

  /** The same tuple one character earlier still fits, so the bound is the line end and not a guess. */
  it('keeps a tuple that ends exactly at the end of its line', () => {
    const result = decodeSemanticTokens([0, 14, 1, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([{ start: 14, end: 15, tokenType: 'variable' }])
    expect(result.drops).toEqual(NO_DROPS)
  })

  it('keeps the two axes of that failure in one counter', () => {
    // Three real-length tuples against a three-character document: all of them start past its end.
    const stale = decodeSemanticTokens([0, 10, 5, 0, 0, 0, 6, 5, 0, 0, 0, 6, 5, 0, 0], LEGEND, {
      lineStarts: [0],
      textLength: 3,
    })

    expect(stale.spans).toEqual([])
    expect(stale.drops.pastEndOfDocument).toBe(3)
    expect(stale.drops.zeroLength).toBe(0)
  })

  it('clamps an over-long span to the document rather than past its end', () => {
    const lastLine = DOCUMENT.lineStarts.at(-1) as number
    const result = decodeSemanticTokens([2, 0, 9999, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([{ start: lastLine, end: TEXT.length, tokenType: 'variable' }])
    expect(result.drops).toEqual(NO_DROPS)
  })

  it('counts a trailing partial tuple rather than swallowing it', () => {
    const result = decodeSemanticTokens([0, 0, 5, 2, 0, 0, 6], LEGEND, DOCUMENT)

    expect(result.spans).toHaveLength(1)
    expect(result.drops.malformedTuple).toBe(1)
  })

  it('stops at a value that is not a non-negative integer', () => {
    const result = decodeSemanticTokens([0, 0, 5, 2, 0, 0, -6, 5, 0, 0], LEGEND, DOCUMENT)

    expect(result.spans).toHaveLength(1)
    expect(result.drops.malformedTuple).toBe(1)
  })

  it('accepts a typed array, which is what a host with its own buffer will hold', () => {
    const result = decodeSemanticTokens(Uint32Array.from([0, 0, 5, 2, 0]), LEGEND, DOCUMENT)

    expect(result.spans).toEqual([{ start: 0, end: 5, tokenType: 'keyword' }])
  })

  /**
   * The modifier bitset is 32 bits wide, and `1 << 31` is negative in JavaScript. The mask works
   * anyway because `&` coerces both sides to int32 — but it works by accident unless it is pinned,
   * and a legend with the full thirty-two modifiers is exactly where it would stop.
   */
  it('decodes the top modifier bit, named or not', () => {
    const wide: lsp.SemanticTokensLegend = {
      tokenTypes: ['variable'],
      tokenModifiers: Array.from({ length: 32 }, (_, index) => `mod${index}`),
    }

    const named = decodeSemanticTokens([0, 0, 5, 0, 2 ** 31], wide, DOCUMENT)
    expect(named.spans[0]?.tokenModifiers).toEqual(['mod31'])
    expect(named.drops.unknownModifierBits).toBe(0)

    const everything = decodeSemanticTokens([0, 0, 5, 0, 2 ** 32 - 1], wide, DOCUMENT)
    expect(everything.spans[0]?.tokenModifiers).toHaveLength(32)

    // The same bit against a legend that names six: unknown, counted, and the span survives it.
    const unknown = decodeSemanticTokens([0, 0, 5, 0, 2 ** 31], LEGEND, DOCUMENT)
    expect(unknown.spans[0]?.tokenModifiers).toBeUndefined()
    expect(unknown.drops.unknownModifierBits).toBe(1)
  })

  it('returns nothing for an empty response', () => {
    const result = decodeSemanticTokens([], LEGEND, DOCUMENT)

    expect(result.spans).toEqual([])
    expect(result.drops).toEqual(NO_DROPS)
  })
})
