import { describe, expect, it } from 'vitest'

import { parseRgMatchLine, type RgMatchEvent } from '../search-rg-parser'

describe('ripgrep match parser', () => {
  it.each([
    { lines: { text: 'plain needle\n' }, submatches: [{ start: 6, end: 12 }] },
    { lines: { bytes: 'cHJlZml4IP8gbmVlZGxlCg==' }, submatches: [{ start: 9, end: 15 }] },
  ])(
    'preserves the content representation and original byte ranges: %j',
    ({ lines, submatches }) => {
      const event: RgMatchEvent = {
        type: 'match',
        data: {
          path: { text: 'content.txt' },
          lines,
          line_number: 1,
          submatches,
        },
      }

      expect(parseRgMatchLine(JSON.stringify(event))).toEqual(event)
    },
  )

  it('ignores non-match events', () => {
    expect(parseRgMatchLine('{"type":"end","data":{"path":{"text":"content.txt"}}}')).toBeNull()
  })

  it('ignores invalid JSON', () => {
    expect(parseRgMatchLine('not JSON')).toBeNull()
  })
})
