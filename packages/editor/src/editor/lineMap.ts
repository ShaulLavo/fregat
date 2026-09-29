import type { TextReadSnapshot } from '../documentTextSnapshot'
import type { ResolvedSelection } from '../selections'
import { clamp } from '../style-utils'
import type { TextEdit } from '../tokens'

/** Row positions without text, which is all a command needs of the document its edits produce. */
export type LineGeometry = {
  readonly length: number
  readonly lastRow: number
  lineStart(row: number): number
  lineEnd(row: number): number
  lineFullEnd(row: number): number
  rowAtOffset(offset: number): number
}

/** A run of whole rows read once: from `startRow`'s start through its last row's full end. */
type LineSpan = {
  readonly startRow: number
  readonly start: number
  readonly text: string
  /** Each row's start relative to `start`, then `text.length` for the row after the span. */
  readonly starts: readonly number[]
  /** How far rows and offsets after this span sit from the snapshot the map reads through. */
  readonly rowShift: number
  readonly offsetShift: number
}

export type RowRange = {
  readonly startRow: number
  readonly endRow: number
}

const NO_SHIFT = { rowShift: 0, offsetShift: 0 }

/**
 * The rows a line command touches, read as one string per run of them, with every other row and
 * offset answered by the snapshot. Each selection's rows are read with one row either side, since
 * moves, joins and deletes reach that far.
 */
export class LineMap implements LineGeometry {
  constructor(
    private readonly source: TextReadSnapshot,
    private readonly spans: readonly LineSpan[],
    readonly length: number,
    readonly lastRow: number,
  ) {}

  lineStart(row: number): number {
    const target = clamp(row, 0, this.lastRow)
    const span = this.spanAtRow(target)
    if (span && target - span.startRow < span.starts.length) {
      return span.start + span.starts[target - span.startRow]!
    }

    const shift = span ?? NO_SHIFT
    return this.source.lineStart(target - shift.rowShift) + shift.offsetShift
  }

  lineEnd(row: number): number {
    if (row < this.lastRow) return this.lineStart(row + 1) - 1
    return this.length
  }

  lineFullEnd(row: number): number {
    if (row < this.lastRow) return this.lineStart(row + 1)
    return this.length
  }

  rowAtOffset(offset: number): number {
    const target = clamp(offset, 0, this.length)
    const span = this.spanAtOffset(target)
    if (span && this.spanHolds(span, target)) {
      return span.startRow + lastRowStartAtOrBefore(span, target - span.start)
    }

    const shift = span ?? NO_SHIFT
    return this.source.lineAt(target - shift.offsetShift) + shift.rowShift
  }

  slice(start: number, end: number): string {
    const from = clamp(start, 0, this.length)
    const to = clamp(end, from, this.length)
    const span = this.spanAtOffset(from)
    if (span && to <= span.start + span.text.length) {
      return span.text.slice(from - span.start, to - span.start)
    }

    return this.source.readRange(from, to)
  }

  charAt(offset: number): string {
    return this.slice(offset, offset + 1)
  }

  startsWith(token: string, offset: number): boolean {
    return this.slice(offset, offset + token.length) === token
  }

  /**
   * The rows after the edits, each span rewritten by the edits inside it.
   *
   * Every edit a line command makes lies inside the rows it read, so rows between spans only move.
   */
  afterEdits(edits: readonly TextEdit[]): LineGeometry {
    const spans: LineSpan[] = []
    let shift = NO_SHIFT

    for (const span of this.spans) {
      const next = editedSpan(span, edits, shift)
      spans.push(next)
      shift = next
    }

    return new LineMap(
      this.source,
      spans,
      this.length + shift.offsetShift,
      this.lastRow + shift.rowShift,
    )
  }

  private spanAtRow(row: number): LineSpan | null {
    return lastSpanAtOrBefore(this.spans, (span) => span.startRow <= row)
  }

  private spanAtOffset(offset: number): LineSpan | null {
    return lastSpanAtOrBefore(this.spans, (span) => span.start <= offset)
  }

  private spanHolds(span: LineSpan, offset: number): boolean {
    const end = span.start + span.text.length
    return offset < end || (offset === end && this.reachesEnd(span))
  }

  private reachesEnd(span: LineSpan): boolean {
    return span.start + span.text.length === this.length
  }
}

export function createLineMap(
  source: TextReadSnapshot,
  selections: readonly Pick<ResolvedSelection, 'startOffset' | 'endOffset'>[],
): LineMap {
  const lastRow = source.lineCount - 1
  const ranges = selections.map((selection) => ({
    startRow: Math.max(0, source.lineAt(selection.startOffset) - 1),
    endRow: Math.min(lastRow, source.lineAt(selection.endOffset) + 1),
  }))
  const spans = mergeRowRanges(ranges).map((range) => readSpan(source, range, lastRow))

  return new LineMap(source, spans, source.length, lastRow)
}

function readSpan(source: TextReadSnapshot, range: RowRange, lastRow: number): LineSpan {
  const start = source.lineStart(range.startRow)
  const end = range.endRow < lastRow ? source.lineStart(range.endRow + 1) : source.length
  const text = source.readRange(start, end)
  const rows = range.endRow - range.startRow + 1

  return { ...NO_SHIFT, startRow: range.startRow, start, text, starts: spanStarts(text, rows) }
}

function spanStarts(text: string, rows: number): readonly number[] {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  // A span ending the document has no break after its last row to supply the closing entry.
  if (starts.length === rows) starts.push(text.length)
  return starts
}

function editedSpan(
  span: LineSpan,
  edits: readonly TextEdit[],
  shift: Pick<LineSpan, 'rowShift' | 'offsetShift'>,
): LineSpan {
  const end = span.start + span.text.length
  const inside = edits.filter((edit) => edit.from >= span.start && edit.to <= end)
  const text = applyEdits(span.text, inside, span.start)
  const addedRows = lineBreaks(text) - lineBreaks(span.text)

  return {
    startRow: span.startRow + shift.rowShift,
    start: span.start + shift.offsetShift,
    text,
    starts: spanStarts(text, span.starts.length - 1 + addedRows),
    rowShift: shift.rowShift + addedRows,
    offsetShift: shift.offsetShift + text.length - span.text.length,
  }
}

function applyEdits(text: string, edits: readonly TextEdit[], base: number): string {
  let next = text
  const sorted = edits.toSorted((left, right) => right.from - left.from || right.to - left.to)

  for (const edit of sorted) {
    next = `${next.slice(0, edit.from - base)}${edit.text}${next.slice(edit.to - base)}`
  }

  return next
}

function lineBreaks(text: string): number {
  let count = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    count += 1
  }
  return count
}

/** Ranges in row order, with overlapping and adjacent ones joined. */
export function mergeRowRanges(ranges: readonly RowRange[]): readonly RowRange[] {
  const merged: RowRange[] = []

  for (const range of ranges.toSorted((left, right) => left.startRow - right.startRow)) {
    const previous = merged[merged.length - 1]
    if (!previous || range.startRow > previous.endRow + 1) {
      merged.push(range)
      continue
    }

    merged[merged.length - 1] = {
      startRow: previous.startRow,
      endRow: Math.max(previous.endRow, range.endRow),
    }
  }

  return merged
}

function lastSpanAtOrBefore(
  spans: readonly LineSpan[],
  atOrBefore: (span: LineSpan) => boolean,
): LineSpan | null {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (atOrBefore(spans[middle]!)) low = middle + 1
    else high = middle
  }
  return spans[low - 1] ?? null
}

/** The span's row holding `offset`; the closing entry is never a row of its own. */
function lastRowStartAtOrBefore(span: LineSpan, offset: number): number {
  let low = 0
  let high = span.starts.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (span.starts[middle]! <= offset) low = middle + 1
    else high = middle
  }
  return low - 1
}
