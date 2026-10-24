import type { TextContent } from './textContent'
import type { EditorVisibleRowSnapshot } from './plugins'
import { isWholeWordRange, wordRangeAtOffset } from './textRanges'

export type OccurrenceHighlightRange = {
  readonly start: number
  readonly end: number
}

/**
 * Longest query worth painting. A caret inside a very long token would otherwise scan every visible
 * row for a string that can match almost nothing.
 */
const MAX_QUERY_LENGTH = 200

/**
 * The word under `caretOffset`, taken from the visible row that contains it.
 *
 * Rows carry their own text, so this never materializes the document — the reason the whole feature
 * is viewport-scoped rather than a full-buffer search on every caret move.
 */
export function occurrenceQueryAtCaret(
  rows: readonly EditorVisibleRowSnapshot[],
  caretOffset: number,
): string | null {
  const row = rowContainingOffset(rows, caretOffset)
  if (!row) return null

  const local = caretOffset - row.startOffset
  const start = Math.max(0, local - MAX_QUERY_LENGTH - 1)
  const window = row.text.slice(start, Math.min(row.text.length, local + MAX_QUERY_LENGTH + 1))
  const range = wordRangeAtOffset(window, local - start)
  if (range.start === range.end || range.end - range.start > MAX_QUERY_LENGTH) return null

  const query = window.slice(range.start, range.end)
  return query.length > MAX_QUERY_LENGTH ? null : query
}

/**
 * Whole-word occurrences of the caret's word across the mounted rows, in document offsets.
 *
 * Only the visible rows are searched: anything off-screen cannot be painted, and scanning the whole
 * buffer on every selection change is the cost this feature exists to avoid. Matches never span a
 * row because a word never contains a line break.
 */
export function occurrenceHighlightRanges(
  rows: readonly EditorVisibleRowSnapshot[],
  caretOffset: number,
): readonly OccurrenceHighlightRange[] {
  const query = occurrenceQueryAtCaret(rows, caretOffset)
  if (!query) return []

  const ranges: OccurrenceHighlightRange[] = []
  for (const row of rows) {
    if (!row.primaryText) continue

    appendRowOccurrences(ranges, row, query)
  }

  return ranges
}

function appendRowOccurrences(
  ranges: OccurrenceHighlightRange[],
  row: EditorVisibleRowSnapshot,
  query: string,
): void {
  if (typeof row.text === 'string') {
    appendWindowOccurrences(ranges, row, query, 0, row.text.length)
    return
  }
  for (const chunk of row.chunks) {
    appendWindowOccurrences(ranges, row, query, chunk.rowLocalStart, chunk.rowLocalEnd)
  }
}

function appendWindowOccurrences(
  ranges: OccurrenceHighlightRange[],
  row: EditorVisibleRowSnapshot,
  query: string,
  start: number,
  end: number,
): void {
  const from = Math.max(0, start - query.length + 1)
  const text = row.text.slice(from, Math.min(row.text.length, end + query.length - 1))
  let index = text.indexOf(query)
  while (index !== -1) {
    const local = from + index
    if (
      local + query.length > start &&
      local < end &&
      isWholeWordAt(row.text, local, query.length)
    ) {
      appendOccurrence(ranges, row.startOffset + local, query.length)
    }
    index = text.indexOf(query, index + query.length)
  }
}

function appendOccurrence(ranges: OccurrenceHighlightRange[], start: number, length: number): void {
  if (ranges.at(-1)?.start === start) return
  ranges.push({ start, end: start + length })
}

/**
 * A match counts only when it is the entire word at that position. Reusing the word-range helper
 * keeps one definition of a word boundary instead of a second character-class table that could
 * drift from it.
 */
function isWholeWordAt(text: TextContent, index: number, length: number): boolean {
  return isWholeWordRange(text, { start: index, end: index + length })
}

function rowContainingOffset(
  rows: readonly EditorVisibleRowSnapshot[],
  offset: number,
): EditorVisibleRowSnapshot | null {
  for (const row of rows) {
    if (!row.primaryText) continue
    if (offset < row.startOffset) continue
    if (offset > row.endOffset) continue

    return row
  }

  return null
}
