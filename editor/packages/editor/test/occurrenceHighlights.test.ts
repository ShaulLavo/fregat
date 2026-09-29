import { describe, expect, it } from 'vitest'

import { occurrenceHighlightRanges, occurrenceQueryAtCaret } from '../src/occurrenceHighlights'
import type { EditorVisibleRowSnapshot } from '../src/plugins'

/** Builds the mounted rows for `lines`, numbering offsets as the editor does (newline included). */
function rows(lines: readonly string[]): EditorVisibleRowSnapshot[] {
  let offset = 0
  return lines.map((text, index) => {
    const row: EditorVisibleRowSnapshot = {
      bufferRow: index,
      endOffset: offset + text.length,
      height: 20,
      index,
      kind: 'text',
      primaryText: true,
      firstWrapSegment: true,
      source: 'document',
      startOffset: offset,
      text,
      top: index * 20,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    }
    offset += text.length + 1
    return row
  })
}

describe('occurrenceQueryAtCaret', () => {
  it('reads the word under the caret from its row', () => {
    expect(occurrenceQueryAtCaret(rows(['const value = 1']), 8)).toBe('value')
  })

  // A caret sitting immediately after a word belongs to that word, matching the convention the
  // word-range helper already uses for word motion.
  it('claims the word the caret rests just after', () => {
    expect(occurrenceQueryAtCaret(rows(['const value = 1']), 5)).toBe('const')
  })

  it('returns null when neither side of the caret is a word character', () => {
    expect(occurrenceQueryAtCaret(rows(['a = b']), 2)).toBeNull()
  })

  it('returns null when the caret is outside every mounted row', () => {
    expect(occurrenceQueryAtCaret(rows(['const value = 1']), 900)).toBeNull()
  })
})

describe('occurrenceHighlightRanges', () => {
  it('finds the word across every visible row, in document offsets', () => {
    const lines = ['const value = 1', 'return value']
    // Caret inside "value" on the first row.
    const ranges = occurrenceHighlightRanges(rows(lines), 8)

    expect(ranges).toEqual([
      { end: 11, start: 6 },
      { end: 28, start: 23 },
    ])
  })

  it('ignores substring matches inside longer words', () => {
    const ranges = occurrenceHighlightRanges(rows(['value', 'valueOf', 'myvalue']), 1)

    expect(ranges).toEqual([{ end: 5, start: 0 }])
  })

  it('skips rows that are not primary document text', () => {
    const [first, second] = rows(['value', 'value'])
    if (!first || !second) throw new Error('fixture rows missing')

    const ranges = occurrenceHighlightRanges([first, { ...second, primaryText: false }], 1)

    expect(ranges).toEqual([{ end: 5, start: 0 }])
  })

  it('finds the caret query and matches on soft-wrap continuations', () => {
    const [first, second] = rows(['value', 'value'])
    if (!first || !second) throw new Error('fixture rows missing')

    const wrappedRows = [
      { ...first, firstWrapSegment: false },
      { ...second, firstWrapSegment: false },
    ]

    expect(occurrenceHighlightRanges(wrappedRows, 1)).toEqual([
      { end: 5, start: 0 },
      { end: 11, start: 6 },
    ])
  })

  it('returns nothing when the caret is not on a word', () => {
    expect(occurrenceHighlightRanges(rows(['a = b']), 2)).toEqual([])
  })

  it('returns nothing for an empty viewport', () => {
    expect(occurrenceHighlightRanges([], 0)).toEqual([])
  })
})
