import type { TextContent } from './textContent'
import type { Point } from '@singapore-editor/textbuffer'
import { type MeasuredText } from './textMeasurements'

declare const tabPointBrand: unique symbol
declare const wrapPointBrand: unique symbol

export type TransformBias = 'before' | 'after' | 'nearest'

export type InvalidatedRange<TPoint extends Point> = {
  readonly start: TPoint
  readonly end: TPoint
  readonly lineCountDelta: number
}

export type TabPoint = Point & {
  readonly [tabPointBrand]: true
}

export type WrapPoint = Point & {
  readonly [wrapPointBrand]: true
}

export type DisplayTextRowSource = 'document' | 'injected'

export type DisplayDocumentTextRow = MeasuredText & {
  readonly kind: 'text'
  readonly source: 'document'
  readonly index: number
  readonly bufferRow: number
  readonly startOffset: number
  readonly endOffset: number
  readonly text: TextContent
  readonly sourceText: TextContent
  readonly sourceStartColumn: number
  readonly sourceEndColumn: number
  readonly displayStartColumn: number
  readonly displayEndColumn: number
  readonly wrapSegment: number
  /**
   * The whole buffer line projected into display space, present only when the line carries inline
   * replacements. Shared by every wrap slice of the line; its segments are line-absolute, so
   * subtract `displayStartColumn` to rebase them onto this row.
   */
  readonly inlineRow?: InlineRow
}

export type DisplayInjectedTextRow = MeasuredText & {
  readonly kind: 'text'
  readonly source: 'injected'
  readonly id: string
  readonly index: number
  readonly bufferRow: number
  readonly anchorBufferRow: number
  readonly placement: InjectedTextRowPlacement
  readonly order: number
  readonly startOffset: number
  readonly endOffset: number
  readonly text: TextContent
  readonly sourceText: TextContent
  readonly sourceStartColumn: number
  readonly sourceEndColumn: number
  readonly displayStartColumn: number
  readonly displayEndColumn: number
  readonly wrapSegment: number
  readonly className?: string
  readonly gutterClassName?: string
  readonly metadata?: unknown
}

type DisplayTextRow = DisplayDocumentTextRow | DisplayInjectedTextRow

export type DisplayRow = DisplayTextRow

type InjectedTextRowPlacement = 'before' | 'after'

export type InjectedTextRow = {
  readonly id: string
  readonly anchorBufferRow: number
  readonly placement: InjectedTextRowPlacement
  readonly text: string
  readonly order?: number
  readonly className?: string
  readonly gutterClassName?: string
  readonly metadata?: unknown
}

type WrapSegment = {
  readonly inputRow: number
  readonly outputRow: number
  readonly segmentIndex: number
  readonly startColumn: number
  readonly endColumn: number
  readonly startVisualColumn: number
  readonly endVisualColumn: number
}

export type WrapMap = {
  readonly wrapColumn: number
  readonly segments: readonly WrapSegment[]
}

/**
 * Which display edge of an injected run the caret may rest on. Only a position with no direction of
 * its own needs telling: every other one at that point is the edge of a range, and a range takes the
 * side that leaves the run outside it.
 */
export type InlineCursorStops = 'both' | 'left' | 'right' | 'none'

/**
 * Fills the node a replacement is painted as. Returning a disposable lets the run take down whatever
 * it attached — a listener, an observer — when the replacement leaves the map.
 */
export type InlineReplacementRender = (container: HTMLElement) => void | { dispose(): void }

/**
 * A single-line source span painted as `text` instead of its own characters. An empty `text` hides
 * the span outright; a non-empty `text` stands in for it. Replacements are atomic: no display
 * column ever resolves to a source column strictly inside one.
 *
 * An `insertion` covers no source columns at all — phantom text hanging off a point, which is how an
 * inlay hint or a colour swatch reaches the screen without the document ever holding it.
 */
export type InlineReplacement = {
  readonly id: string
  readonly startColumn: number
  readonly endColumn: number
  readonly text: string
  readonly insertion?: boolean
  readonly kind?: string
  /** Styles the run alone, where `kind` restyles the whole row the run sits on. */
  readonly className?: string
  readonly cursorStops?: InlineCursorStops
  readonly render?: InlineReplacementRender
  /** Which mount a rendered node belongs to; the id when unset. */
  readonly key?: string
  readonly metadata?: unknown
}

type InlineRowSegmentKind = 'source' | 'replacement'

export type InlineRowSegment = {
  readonly kind: InlineRowSegmentKind
  readonly sourceStartColumn: number
  readonly sourceEndColumn: number
  readonly displayStartColumn: number
  readonly displayEndColumn: number
  readonly id?: string
  readonly replacementKind?: string
  readonly className?: string
  readonly cursorStops?: InlineCursorStops
  readonly render?: InlineReplacementRender
  readonly key?: string
  readonly metadata?: unknown
}

/**
 * One buffer line projected into display space. Segments are contiguous and cover the whole line,
 * so column conversion in either direction is total.
 */
export type InlineRow = {
  readonly sourceLength: number
  readonly displayLength: number
  readonly segments: readonly InlineRowSegment[]
}

export type MaterializedInlineRow = InlineRow & {
  readonly sourceText: string
  readonly text: string
}

export type InlineColumnRange = {
  readonly startColumn: number
  readonly endColumn: number
}

const DEFAULT_TAB_SIZE = 4

export function normalizeTabSize(tabSize: number | undefined): number {
  if (tabSize === undefined) return DEFAULT_TAB_SIZE
  if (!Number.isFinite(tabSize) || tabSize <= 0) return DEFAULT_TAB_SIZE
  return Math.max(1, Math.floor(tabSize))
}

export function bufferColumnToVisualColumn(
  content: string | MeasuredText,
  column: number,
  tabSize = DEFAULT_TAB_SIZE,
): number {
  if (typeof content !== 'string' && content.measurements)
    return content.measurements.columnAt(column, tabSize, 'utf16')
  const text = typeof content === 'string' ? content : content.text
  let visual = 0
  const end = clampColumn(column, text.length)

  for (let index = 0; index < end; index += 1) {
    visual += visualWidthForChar(text.charAt(index), visual, tabSize)
  }

  return visual
}

export function visualColumnToBufferColumn(
  content: string | MeasuredText,
  visualColumn: number,
  bias: TransformBias = 'nearest',
  tabSize = DEFAULT_TAB_SIZE,
): number {
  if (typeof content !== 'string' && content.measurements)
    return content.measurements.offsetAt(visualColumn, bias, tabSize, 'utf16')
  const text = typeof content === 'string' ? content : content.text
  const target = Math.max(0, visualColumn)
  let visual = 0

  for (let index = 0; index < text.length; index += 1) {
    const next = visual + visualWidthForChar(text.charAt(index), visual, tabSize)
    const column = columnForVisualTarget(index, visual, next, target, bias)
    if (column !== null) return column
    visual = next
  }

  return text.length
}

export function visualColumnLength(
  text: string | MeasuredText,
  tabSize = DEFAULT_TAB_SIZE,
): number {
  return bufferColumnToVisualColumn(
    text,
    typeof text === 'string' ? text.length : text.text.length,
    tabSize,
  )
}

export function bufferPointToTabPoint(
  text: string,
  point: Point,
  tabSize = DEFAULT_TAB_SIZE,
): TabPoint {
  return asTabPoint({
    row: point.row,
    column: bufferColumnToVisualColumn(text, point.column, tabSize),
  })
}

export function tabPointToBufferPoint(
  text: string,
  point: TabPoint,
  bias: TransformBias = 'nearest',
  tabSize = DEFAULT_TAB_SIZE,
): Point {
  return {
    row: point.row,
    column: visualColumnToBufferColumn(text, point.column, bias, tabSize),
  }
}

export function createWrapMap(
  rows: readonly { readonly row: number; readonly text: string }[],
  wrapColumn: number,
  tabSize = DEFAULT_TAB_SIZE,
): WrapMap {
  const width = normalizeWrapColumn(wrapColumn)
  const segments: WrapSegment[] = []

  for (const row of rows) {
    appendWrapSegments(segments, row.row, row.text, width, tabSize)
  }

  return { wrapColumn: width, segments }
}

export function tabPointToWrapPoint(map: WrapMap, point: TabPoint): WrapPoint {
  const segment = wrapSegmentForInput(map, point.row, point.column)
  if (!segment) return asWrapPoint(point)

  return asWrapPoint({
    row: segment.outputRow,
    column: point.column - segment.startVisualColumn,
  })
}

export function wrapPointToTabPoint(
  map: WrapMap,
  point: WrapPoint,
  bias: TransformBias = 'nearest',
): TabPoint {
  const segment = wrapSegmentForOutput(map, point.row)
  if (!segment) return asTabPoint(point)

  const column = segment.startVisualColumn + clampWrapColumn(point.column, segment, bias)
  return asTabPoint({ row: segment.inputRow, column })
}

export function createInlineRow(
  sourceText: string,
  replacements: readonly InlineReplacement[] = [],
): MaterializedInlineRow {
  const normalized = normalizeInlineReplacements(sourceText.length, replacements)
  if (normalized.length === 0) return identityInlineRow(sourceText)

  const segments: InlineRowSegment[] = []
  let sourceColumn = 0
  let displayColumn = 0
  let text = ''

  for (const replacement of normalized) {
    if (replacement.startColumn > sourceColumn) {
      segments.push(inlineSourceSegment(sourceColumn, replacement.startColumn, displayColumn))
      text += sourceText.slice(sourceColumn, replacement.startColumn)
      displayColumn += replacement.startColumn - sourceColumn
    }

    segments.push(inlineReplacementSegment(replacement, displayColumn))
    text += replacement.text
    displayColumn += replacement.text.length
    sourceColumn = replacement.endColumn
  }

  if (sourceColumn < sourceText.length) {
    segments.push(inlineSourceSegment(sourceColumn, sourceText.length, displayColumn))
    text += sourceText.slice(sourceColumn)
  }

  return { sourceText, text, sourceLength: sourceText.length, displayLength: text.length, segments }
}

export function sourceColumnToInlineColumn(
  row: InlineRow,
  column: number,
  bias: TransformBias = 'nearest',
): number {
  const target = clampColumn(column, row.sourceLength)

  for (const segment of row.segments) {
    if (target > segment.sourceEndColumn) continue

    const displayColumn =
      segment.kind === 'source'
        ? segment.displayStartColumn + (target - segment.sourceStartColumn)
        : inlineReplacementDisplayColumn(segment, target, bias)

    return injectedRunSideColumn(row, displayColumn, bias)
  }

  return row.displayLength
}

/**
 * Hidden replacements are zero-width in display space, so several source columns share one display
 * column and the inverse is genuinely ambiguous there. The rule is: `before` and `nearest` resolve to
 * the earliest source column for that display column, `after` to the latest. Horizontal motion
 * therefore passes the bias matching its direction. `display -> source -> display` is the identity
 * across a hidden run; `source -> display -> source` is not, at a hidden boundary.
 */
export function inlineColumnToSourceColumn(
  row: InlineRow,
  column: number,
  bias: TransformBias = 'nearest',
): number {
  const target = clampColumn(column, row.displayLength)
  const segment = row.segments[inlineSegmentIndexForDisplayColumn(row, target, bias)]
  if (!segment) return row.sourceLength

  if (segment.kind === 'source') {
    return segment.sourceStartColumn + (target - segment.displayStartColumn)
  }

  return inlineReplacementSourceColumn(segment, target, bias)
}

/**
 * Projects a source column range into display space. A range that overlaps a replacement covers the
 * whole replacement, so selections, find matches, and syntax tokens paint replacements atomically.
 * A range hidden in its entirety returns no display ranges.
 */
export function sourceRangeToInlineRanges(
  row: InlineRow,
  startColumn: number,
  endColumn: number,
): readonly InlineColumnRange[] {
  const low = clampColumn(Math.min(startColumn, endColumn), row.sourceLength)
  const high = clampColumn(Math.max(startColumn, endColumn), row.sourceLength)

  if (low === high) {
    const column = sourceColumnToInlineColumn(row, low)
    return [{ startColumn: column, endColumn: column }]
  }

  const ranges: InlineColumnRange[] = []
  for (const segment of row.segments) {
    const range = inlineSegmentDisplayOverlap(segment, low, high)
    if (range) appendInlineColumnRange(ranges, range)
  }

  return ranges
}

export function isDocumentTextDisplayRow(
  row: DisplayRow | undefined,
): row is DisplayDocumentTextRow {
  return row?.kind === 'text' && row.source === 'document'
}

export function isInjectedTextDisplayRow(
  row: DisplayRow | undefined,
): row is DisplayInjectedTextRow {
  return row?.kind === 'text' && row.source === 'injected'
}

const asTabPoint = (point: Point): TabPoint => point as TabPoint
const asWrapPoint = (point: Point): WrapPoint => point as WrapPoint

const identityInlineRow = (sourceText: string): MaterializedInlineRow => ({
  sourceText,
  text: sourceText,
  sourceLength: sourceText.length,
  displayLength: sourceText.length,
  segments: [inlineSourceSegment(0, sourceText.length, 0)],
})

export const inlineSourceSegment = (
  startColumn: number,
  endColumn: number,
  displayStartColumn: number,
): InlineRowSegment => ({
  kind: 'source',
  sourceStartColumn: startColumn,
  sourceEndColumn: endColumn,
  displayStartColumn,
  displayEndColumn: displayStartColumn + (endColumn - startColumn),
})

export const inlineReplacementSegment = (
  replacement: InlineReplacement,
  displayStartColumn: number,
): InlineRowSegment => ({
  kind: 'replacement',
  id: replacement.id,
  sourceStartColumn: replacement.startColumn,
  sourceEndColumn: replacement.endColumn,
  displayStartColumn,
  displayEndColumn: displayStartColumn + replacement.text.length,
  ...(replacement.kind === undefined ? {} : { replacementKind: replacement.kind }),
  ...(replacement.className === undefined ? {} : { className: replacement.className }),
  ...(replacement.cursorStops === undefined ? {} : { cursorStops: replacement.cursorStops }),
  ...(replacement.render === undefined ? {} : { render: replacement.render }),
  ...(replacement.key === undefined ? {} : { key: replacement.key }),
  ...(replacement.metadata === undefined ? {} : { metadata: replacement.metadata }),
})

export const normalizeInlineReplacements = (
  sourceLength: number,
  replacements: readonly InlineReplacement[],
): readonly InlineReplacement[] => {
  const candidates = replacements
    .filter((replacement) => replacement.id.length > 0)
    .filter((replacement) => !replacement.text.includes('\n'))
    .map((replacement) => ({
      ...replacement,
      startColumn: clampColumn(replacement.startColumn, sourceLength),
      endColumn: clampColumn(replacement.endColumn, sourceLength),
    }))
    // Zero width is phantom text at a point, which only a replacement that asked for one may be; an
    // ordinary span that clamping collapsed onto itself is degenerate and still goes.
    .filter((replacement) =>
      replacement.insertion === true
        ? replacement.endColumn === replacement.startColumn
        : replacement.endColumn > replacement.startColumn,
    )
    .toSorted((left, right) => {
      return (
        left.startColumn - right.startColumn ||
        insertionOrder(left) - insertionOrder(right) ||
        right.endColumn - left.endColumn ||
        left.id.localeCompare(right.id)
      )
    })

  const kept: InlineReplacement[] = []
  for (const replacement of candidates) {
    const previous = kept.at(-1)
    if (previous && replacement.startColumn < previous.endColumn) continue
    kept.push(replacement)
  }

  return kept
}

/**
 * Phantom text hung off a point stands in front of whatever begins at that point, and — covering no
 * source column — cannot overlap it. Ordering it ahead of a span starting on the same column is what
 * keeps a hint or a suggestion offered at the opening edge of a replaced span, which is where a
 * construct's own markers sit, from being read as a range inside that span and dropped.
 */
const insertionOrder = (replacement: InlineReplacement): number =>
  replacement.insertion === true ? 0 : 1

/**
 * Which side of the injected runs standing at a display column a source column belongs on.
 *
 * A run owns no source column, so it falls outside every source range: one that opens at the point
 * opens past the runs, one that closes there stops in front of them. That is what keeps a decoration,
 * a find match or a syntax token from spreading over text the document does not hold.
 *
 * Only a direction-free position — a caret standing still — has a real choice, and the runs' own
 * cursor stops make it. A run that stops on neither side hands the choice to whatever follows it,
 * which is how padding between two hint parts never traps the caret inside the hint.
 */
const injectedRunSideColumn = (row: InlineRow, column: number, bias: TransformBias): number => {
  let past = column
  let stop: number | null = null

  for (const segment of row.segments) {
    if (segment.displayStartColumn !== past) continue
    if (!isInjectedSegment(segment)) continue
    if (stop === null && injectedRunStopsLeft(segment)) stop = past
    past = segment.displayEndColumn
    if (stop === null && injectedRunStopsRight(segment)) stop = past
  }

  if (bias === 'before') return past
  if (bias === 'after') return column
  return stop ?? column
}

const isInjectedSegment = (segment: InlineRowSegment): boolean =>
  segment.kind === 'replacement' && segment.sourceStartColumn === segment.sourceEndColumn

/** A run without stated stops takes both, matching a replacement that never heard of the concept. */
const injectedRunStopsLeft = (segment: InlineRowSegment): boolean => {
  const stops = segment.cursorStops ?? 'both'
  return stops === 'both' || stops === 'left'
}

const injectedRunStopsRight = (segment: InlineRowSegment): boolean => {
  const stops = segment.cursorStops ?? 'both'
  return stops === 'both' || stops === 'right'
}

const inlineSegmentIndexForDisplayColumn = (
  row: InlineRow,
  target: number,
  bias: TransformBias,
): number => {
  const index = row.segments.findIndex((segment) => target <= segment.displayEndColumn)
  if (index < 0) return row.segments.length - 1
  if (bias !== 'after') return index

  return skipZeroWidthInlineSegments(row, index, target)
}

/**
 * Hidden replacements are zero-width in display space, so a caret sitting on one shares its display
 * column with the segments around it. An `after` bias walks past them to the far source column,
 * which is what horizontal motion out of a hidden marker needs.
 */
const skipZeroWidthInlineSegments = (row: InlineRow, index: number, target: number): number => {
  let current = index

  while (current + 1 < row.segments.length) {
    const next = row.segments[current + 1]!
    if (next.displayStartColumn !== target) break
    if (next.displayEndColumn !== target) break
    current += 1
  }

  return current
}

const inlineReplacementDisplayColumn = (
  segment: InlineRowSegment,
  column: number,
  bias: TransformBias,
): number => {
  if (column <= segment.sourceStartColumn) return segment.displayStartColumn
  if (column >= segment.sourceEndColumn) return segment.displayEndColumn
  if (bias === 'before') return segment.displayStartColumn
  if (bias === 'after') return segment.displayEndColumn

  const fromStart = column - segment.sourceStartColumn
  const fromEnd = segment.sourceEndColumn - column
  return fromStart <= fromEnd ? segment.displayStartColumn : segment.displayEndColumn
}

const inlineReplacementSourceColumn = (
  segment: InlineRowSegment,
  column: number,
  bias: TransformBias,
): number => {
  const width = segment.displayEndColumn - segment.displayStartColumn
  // Bias only chooses inside a run: its far edge is the source it ends at, or a step back from the
  // column after a chip would land on the chip's start.
  if (width > 0 && column >= segment.displayEndColumn) return segment.sourceEndColumn
  if (bias === 'before') return segment.sourceStartColumn
  if (bias === 'after') return segment.sourceEndColumn
  if (width <= 0) return segment.sourceStartColumn

  const fromStart = column - segment.displayStartColumn
  return fromStart * 2 <= width ? segment.sourceStartColumn : segment.sourceEndColumn
}

const inlineSegmentDisplayOverlap = (
  segment: InlineRowSegment,
  low: number,
  high: number,
): InlineColumnRange | null => {
  const start = Math.max(low, segment.sourceStartColumn)
  const end = Math.min(high, segment.sourceEndColumn)
  if (end <= start) return null

  if (segment.kind === 'replacement') {
    // A hidden span paints nothing, so it contributes no display range rather than a zero-width one.
    if (segment.displayEndColumn === segment.displayStartColumn) return null
    return { startColumn: segment.displayStartColumn, endColumn: segment.displayEndColumn }
  }

  return {
    startColumn: segment.displayStartColumn + (start - segment.sourceStartColumn),
    endColumn: segment.displayStartColumn + (end - segment.sourceStartColumn),
  }
}

const appendInlineColumnRange = (ranges: InlineColumnRange[], range: InlineColumnRange): void => {
  const previous = ranges.at(-1)
  if (!previous || range.startColumn > previous.endColumn) {
    ranges.push(range)
    return
  }

  ranges[ranges.length - 1] = {
    startColumn: previous.startColumn,
    endColumn: Math.max(previous.endColumn, range.endColumn),
  }
}

const textSegments = (
  text: string,
  wrapColumn: number | null | undefined,
  tabSize: number,
): readonly Omit<WrapSegment, 'inputRow' | 'outputRow'>[] => {
  const width = wrapColumn ? normalizeWrapColumn(wrapColumn) : 0
  if (width <= 0) return [fullTextSegment(text, tabSize)]

  const segments: Omit<WrapSegment, 'inputRow' | 'outputRow'>[] = []
  let segmentStartColumn = 0
  let segmentStartVisual = 0
  let segmentVisual = 0
  let visual = 0

  for (let column = 0; column < text.length; column += 1) {
    const charWidth = visualWidthForChar(text[column]!, visual, tabSize)
    if (segmentVisual > 0 && segmentVisual + charWidth > width) {
      segments.push(segmentForColumns(segments.length, text, segmentStartColumn, column, tabSize))
      segmentStartColumn = column
      segmentStartVisual = visual
      segmentVisual = 0
    }

    segmentVisual += charWidth
    visual += charWidth
  }

  segments.push({
    segmentIndex: segments.length,
    startColumn: segmentStartColumn,
    endColumn: text.length,
    startVisualColumn: segmentStartVisual,
    endVisualColumn: visual,
  })
  return segments
}

const appendWrapSegments = (
  segments: WrapSegment[],
  row: number,
  text: string,
  wrapColumn: number,
  tabSize: number,
): void => {
  const rowSegments = textSegments(text, wrapColumn, tabSize)
  for (const segment of rowSegments) {
    segments.push({
      ...segment,
      inputRow: row,
      outputRow: segments.length,
    })
  }
}

const fullTextSegment = (
  text: string,
  tabSize: number,
): Omit<WrapSegment, 'inputRow' | 'outputRow'> => ({
  segmentIndex: 0,
  startColumn: 0,
  endColumn: text.length,
  startVisualColumn: 0,
  endVisualColumn: visualColumnLength(text, tabSize),
})

const segmentForColumns = (
  index: number,
  text: string,
  startColumn: number,
  endColumn: number,
  tabSize: number,
): Omit<WrapSegment, 'inputRow' | 'outputRow'> => ({
  segmentIndex: index,
  startColumn,
  endColumn,
  startVisualColumn: bufferColumnToVisualColumn(text, startColumn, tabSize),
  endVisualColumn: bufferColumnToVisualColumn(text, endColumn, tabSize),
})

const wrapSegmentForInput = (map: WrapMap, row: number, column: number): WrapSegment | undefined =>
  map.segments.find((segment) => {
    if (segment.inputRow !== row) return false
    if (column < segment.startVisualColumn) return false
    return column <= segment.endVisualColumn
  })

const wrapSegmentForOutput = (map: WrapMap, row: number): WrapSegment | undefined =>
  map.segments.find((segment) => segment.outputRow === row)

const clampWrapColumn = (column: number, segment: WrapSegment, bias: TransformBias): number => {
  const length = segment.endVisualColumn - segment.startVisualColumn
  if (bias === 'after') return clampColumn(column, length)
  return clampColumn(column, length)
}

const columnForVisualTarget = (
  index: number,
  visual: number,
  next: number,
  target: number,
  bias: TransformBias,
): number | null => {
  if (target < visual || target > next) return null
  if (target === visual) return index
  if (target === next) return index + 1
  if (bias === 'before') return index
  if (bias === 'after') return index + 1
  return target - visual <= next - target ? index : index + 1
}

const visualWidthForChar = (char: string, column: number, tabSize: number): number => {
  if (char !== '\t') return 1
  return tabSize - (column % tabSize)
}

const normalizeWrapColumn = (wrapColumn: number): number => {
  if (!Number.isFinite(wrapColumn) || wrapColumn <= 0) return 0
  return Math.max(1, Math.floor(wrapColumn))
}

const clampColumn = (value: number, max: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(0, Math.floor(value)), Math.max(0, max))
}
