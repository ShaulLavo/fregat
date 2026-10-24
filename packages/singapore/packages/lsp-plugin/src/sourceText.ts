import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import type { OffsetRange } from '@singapore-editor/plugin-ui/offset-range'

const INITIAL_RADIUS = 256

type RowBounds = {
  readonly start: number
  /** The row's break, or the document end for the last row. */
  readonly end: number
  /** The next row's start, or the document end: the row with its break. */
  readonly next: number
}

export function rowBounds(document: LspTextDocumentSnapshot, offset: number): RowBounds {
  const length = document.textSnapshot.length
  const row = document.lineStarts.indexForOffset(Math.max(0, Math.min(offset, length)))
  const start = document.lineStarts.at(row) ?? 0
  const nextStart = document.lineStarts.at(row + 1)
  if (nextStart === undefined) return { start, end: length, next: length }
  return { start, end: Math.max(start, nextStart - 1), next: nextStart }
}

/** One code unit, or '' outside the document. */
export function characterAt(document: LspTextDocumentSnapshot, offset: number): string {
  if (offset < 0 || offset >= document.textSnapshot.length) return ''
  return document.textSnapshot.readRange(offset, offset + 1)
}

/**
 * Runs a line-local finder over a window of the row around `offset`, break included, widening it
 * while the answer reaches a clipped edge. Finding a word never copies a long row whole.
 */
export function rangeAroundOffset<Found extends OffsetRange | null>(
  document: LspTextDocumentSnapshot,
  offset: number,
  find: (text: string, offset: number) => Found,
): Found {
  const row = rowBounds(document, offset)
  for (let radius = INITIAL_RADIUS; ; radius *= 2) {
    const from = Math.max(row.start, offset - radius)
    const to = Math.min(row.next, offset + radius)
    const found = find(document.textSnapshot.readRange(from, to), offset - from)
    // Shifting keeps the finder's own null-or-range shape, so a finder that always answers stays so.
    const range = (found ? { start: from + found.start, end: from + found.end } : found) as Found
    if (!reachesClippedEdge(range, from, to, row)) return range
  }
}

function reachesClippedEdge(
  range: OffsetRange | null,
  from: number,
  to: number,
  row: RowBounds,
): boolean {
  if (!range) return false
  if (range.start <= from && from > row.start) return true
  return range.end >= to && to < row.next
}

/** Line queries over an LSP document, for a core helper that takes a read source. */
export function textReadSnapshotOf(document: LspTextDocumentSnapshot): TextReadSnapshot {
  const { lineStarts, textSnapshot } = document
  const lineStart = (lineIndex: number): number =>
    lineStarts.at(Math.max(0, lineIndex)) ?? textSnapshot.length
  return {
    length: textSnapshot.length,
    lineCount: Math.max(1, lineStarts.length),
    lineStart,
    lineRange: (lineIndex) => {
      const row = Math.max(0, lineIndex)
      const next = lineStarts.at(row + 1)
      return { start: lineStart(row), end: next === undefined ? textSnapshot.length : next - 1 }
    },
    lineAt: (offset) =>
      lineStarts.indexForOffset(Math.max(0, Math.min(offset, textSnapshot.length))),
    readRange: (start, end) => textSnapshot.readRange(start, end),
    forEachTextChunk: (visit) => textSnapshot.forEachTextChunk(visit),
  }
}
