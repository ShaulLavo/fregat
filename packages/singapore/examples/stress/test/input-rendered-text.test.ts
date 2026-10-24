import { describe, expect, it } from 'vitest'
import { verifyRenderedText, type RenderedRowText } from '../src/inputRenderedText.ts'

describe('input rendering proof', () => {
  it('accepts complete direct rows and a complete horizontal window', () => {
    expect(verifyRenderedText({ kind: 'direct', text: 'abc' }, 'abc')).toBe(1)
    expect(verifyRenderedText({ kind: 'direct', text: '' }, '')).toBe(1)
    expect(
      verifyRenderedText(
        {
          kind: 'chunked',
          start: 2,
          end: 7,
          chunks: [
            { start: 2, end: 5, text: 'cde' },
            { start: 5, end: 7, text: 'fg' },
          ],
        },
        'abcdefghij',
      ),
    ).toBe(2)
  })

  const incomplete: readonly [string, RenderedRowText][] = [
    [
      'truncated chunk',
      { kind: 'chunked', start: 0, end: 6, chunks: [{ start: 0, end: 6, text: 'a' }] },
    ],
    [
      'missing final chunk',
      { kind: 'chunked', start: 0, end: 6, chunks: [{ start: 0, end: 3, text: 'abc' }] },
    ],
    [
      'missing first chunk',
      { kind: 'chunked', start: 0, end: 6, chunks: [{ start: 3, end: 6, text: 'def' }] },
    ],
    ['missing all chunks', { kind: 'chunked', start: 0, end: 6, chunks: [] }],
    [
      'overlapping chunks',
      {
        kind: 'chunked',
        start: 0,
        end: 6,
        chunks: [
          { start: 0, end: 4, text: 'abcd' },
          { start: 3, end: 6, text: 'def' },
        ],
      },
    ],
    [
      'gap between chunks',
      {
        kind: 'chunked',
        start: 0,
        end: 6,
        chunks: [
          { start: 0, end: 2, text: 'ab' },
          { start: 3, end: 6, text: 'def' },
        ],
      },
    ],
    [
      'invalid end',
      { kind: 'chunked', start: 0, end: 6, chunks: [{ start: 0, end: NaN, text: 'abcdef' }] },
    ],
    [
      'window outside source',
      { kind: 'chunked', start: 0, end: 7, chunks: [{ start: 0, end: 6, text: 'abcdef' }] },
    ],
    [
      'fractional boundary',
      { kind: 'chunked', start: 0, end: 6, chunks: [{ start: 0.5, end: 6, text: 'abcdef' }] },
    ],
  ]
  it.each(incomplete)('rejects %s', (_label, row) => {
    expect(() => verifyRenderedText(row, 'abcdef')).toThrow()
  })

  it('rejects wrong text in an otherwise complete range', () => {
    expect(() => verifyRenderedText({ kind: 'direct', text: 'abd' }, 'abc')).toThrow()
    expect(() =>
      verifyRenderedText(
        { kind: 'chunked', start: 0, end: 3, chunks: [{ start: 0, end: 3, text: 'abd' }] },
        'abc',
      ),
    ).toThrow()
  })
})
