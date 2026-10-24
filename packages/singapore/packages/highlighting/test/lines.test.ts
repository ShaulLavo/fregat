import { describe, expect, test } from 'vitest'

import { highlightLines } from '../src/index'

describe('highlightLines', () => {
  test('splits tokens at newlines and fills uncovered gaps with plain runs', () => {
    const red = { color: '#f00' }
    const lines = highlightLines('ab\ncd\n\nef', [
      { start: 1, end: 4, style: red },
      { start: 8, end: 9, style: red },
    ])
    expect(lines).toEqual([
      [
        { start: 0, text: 'a', style: null },
        { start: 1, text: 'b', style: red },
      ],
      [
        { start: 3, text: 'c', style: red },
        { start: 4, text: 'd', style: null },
      ],
      [],
      [
        { start: 7, text: 'e', style: null },
        { start: 8, text: 'f', style: red },
      ],
    ])
  })

  test('empty text is one empty line, and astral characters stay whole', () => {
    expect(highlightLines('', [])).toEqual([[]])
    expect(highlightLines('🎉x', [{ start: 0, end: 2, style: {} }])).toEqual([
      [
        { start: 0, text: '🎉', style: {} },
        { start: 2, text: 'x', style: null },
      ],
    ])
  })
})
