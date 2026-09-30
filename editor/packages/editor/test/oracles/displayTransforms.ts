import {
  INDEXED_TEXT_MIN_LENGTH,
  measureString,
  type MeasuredText,
  type TextMeasurements,
} from '../../src/textMeasurements'

type TransformBias = 'before' | 'after' | 'nearest'

export type DisplayDocumentTextRow = MeasuredText & {
  readonly kind: 'text'
  readonly source: 'document'
  readonly index: number
  readonly bufferRow: number
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
  readonly sourceText: string
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

type DisplayInjectedTextRow = MeasuredText & {
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
  readonly text: string
  readonly sourceText: string
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

type InjectedTextRowsAtBufferRow = {
  readonly before: readonly InjectedTextRow[]
  readonly after: readonly InjectedTextRow[]
}

type MutableInjectedTextRowsAtBufferRow = {
  readonly before: InjectedTextRow[]
  readonly after: InjectedTextRow[]
}

type InjectedTextRowIndex = ReadonlyMap<number, InjectedTextRowsAtBufferRow>

type WrapSegment = {
  readonly inputRow: number
  readonly outputRow: number
  readonly segmentIndex: number
  readonly startColumn: number
  readonly endColumn: number
  readonly startVisualColumn: number
  readonly endVisualColumn: number
}

type InlineCursorStops = 'both' | 'left' | 'right' | 'none'

/**
 * Fills the node a replacement is painted as. Returning a disposable lets the run take down whatever
 * it attached — a listener, an observer — when the replacement leaves the map.
 */
type InlineReplacementRender = (container: HTMLElement) => void | { dispose(): void }

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
  readonly metadata?: unknown
}

type InlineRowSegmentKind = 'source' | 'replacement'

type InlineRowSegment = {
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
  readonly metadata?: unknown
}

/**
 * One buffer line projected into display space. Segments are contiguous and cover the whole line,
 * so column conversion in either direction is total.
 */
type InlineRow = {
  readonly sourceText: string
  readonly text: string
  readonly segments: readonly InlineRowSegment[]
}

const DEFAULT_TAB_SIZE = 4

function bufferColumnToVisualColumn(
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

function visualColumnLength(text: string | MeasuredText, tabSize = DEFAULT_TAB_SIZE): number {
  return bufferColumnToVisualColumn(
    text,
    typeof text === 'string' ? text.length : text.text.length,
    tabSize,
  )
}

function indexedMeasurements(
  text: string,
  existing?: TextMeasurements,
): TextMeasurements | undefined {
  if (text.length < INDEXED_TEXT_MIN_LENGTH) return undefined
  return existing ?? measureString(text)
}

function displayTextSegments(
  text: string,
  width: number | null | undefined,
  tabSize: number,
): readonly Pick<WrapSegment, 'segmentIndex' | 'startColumn' | 'endColumn'>[] {
  if (!width || width <= 0) return [{ segmentIndex: 0, startColumn: 0, endColumn: text.length }]
  return textSegments(text, width, tabSize)
}

function createInlineRow(
  sourceText: string,
  replacements: readonly InlineReplacement[] = [],
): InlineRow {
  const normalized = normalizeInlineReplacements(sourceText, replacements)
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

  return { sourceText, text, segments }
}

function inlineColumnToSourceColumn(
  row: InlineRow,
  column: number,
  bias: TransformBias = 'nearest',
): number {
  const target = clampColumn(column, row.text.length)
  const segment = row.segments[inlineSegmentIndexForDisplayColumn(row, target, bias)]
  if (!segment) return row.sourceText.length

  if (segment.kind === 'source') {
    return segment.sourceStartColumn + (target - segment.displayStartColumn)
  }

  return inlineReplacementSourceColumn(segment, target, bias)
}

export function isDocumentTextDisplayRow(
  row: DisplayRow | undefined,
): row is DisplayDocumentTextRow {
  return row?.kind === 'text' && row.source === 'document'
}

export type DisplayRowLineInput = {
  readonly visibleLineCount: number
  readonly bufferRowForVisibleRow: (row: number) => number
  readonly lineText: (bufferRow: number) => string
  readonly lineMeasurements?: (bufferRow: number) => TextMeasurements
  readonly lineStartOffset: (bufferRow: number) => number
  readonly lineEndOffset: (bufferRow: number) => number
  readonly wrapColumn?: number | null
  readonly injectedTextRows?: readonly InjectedTextRow[]
  readonly inlineReplacements?: (bufferRow: number) => readonly InlineReplacement[]
  readonly tabSize?: number
}

export function createDisplayRows(options: {
  readonly lineStarts: readonly number[]
  readonly text: string
  readonly bufferRowForVisibleRow: (row: number) => number
  readonly visibleLineCount: number
  readonly wrapColumn?: number | null
  readonly injectedTextRows?: readonly InjectedTextRow[]
  readonly inlineReplacements?: (bufferRow: number) => readonly InlineReplacement[]
  readonly tabSize?: number
}): DisplayRow[] {
  return createDisplayRowsFromLines({
    ...options,
    lineText: (row) => lineTextFromFullText(options.text, options.lineStarts, row),
    lineStartOffset: (row) => lineStartOffsetFromLineStarts(options.text, options.lineStarts, row),
    lineEndOffset: (row) => lineEndOffsetFromLineStarts(options.text, options.lineStarts, row),
  })
}

export function createDisplayRowsFromLines(options: DisplayRowLineInput): DisplayRow[] {
  const rows: DisplayRow[] = []
  const injectedTextRows = injectedTextRowIndex(options.injectedTextRows ?? [])
  const tabSize = options.tabSize ?? DEFAULT_TAB_SIZE

  for (let visibleRow = 0; visibleRow < options.visibleLineCount; visibleRow += 1) {
    appendDisplayRowsForVisibleRow(rows, visibleRow, injectedTextRows, options, tabSize)
  }

  return rows
}

const identityInlineRow = (sourceText: string): InlineRow => ({
  sourceText,
  text: sourceText,
  segments: [inlineSourceSegment(0, sourceText.length, 0)],
})

const inlineSourceSegment = (
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

const inlineReplacementSegment = (
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
  ...(replacement.metadata === undefined ? {} : { metadata: replacement.metadata }),
})

const normalizeInlineReplacements = (
  sourceText: string,
  replacements: readonly InlineReplacement[],
): readonly InlineReplacement[] => {
  const candidates = replacements
    .filter((replacement) => replacement.id.length > 0)
    .filter((replacement) => !replacement.text.includes('\n'))
    .map((replacement) => ({
      ...replacement,
      startColumn: clampColumn(replacement.startColumn, sourceText.length),
      endColumn: clampColumn(replacement.endColumn, sourceText.length),
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

const inlineReplacementSourceColumn = (
  segment: InlineRowSegment,
  column: number,
  bias: TransformBias,
): number => {
  if (bias === 'before') return segment.sourceStartColumn
  if (bias === 'after') return segment.sourceEndColumn

  const width = segment.displayEndColumn - segment.displayStartColumn
  if (width <= 0) return segment.sourceStartColumn

  const fromStart = column - segment.displayStartColumn
  return fromStart * 2 <= width ? segment.sourceStartColumn : segment.sourceEndColumn
}

const appendDisplayRowsForVisibleRow = (
  rows: DisplayRow[],
  visibleRow: number,
  injectedTextRows: InjectedTextRowIndex,
  options: DisplayRowLineInput,
  tabSize: number,
): void => {
  const bufferRow = options.bufferRowForVisibleRow(visibleRow)
  const text = options.lineText(bufferRow)
  const startOffset = options.lineStartOffset(bufferRow)
  appendInjectedTextRows(
    rows,
    injectedTextRows,
    bufferRow,
    'before',
    startOffset,
    options.wrapColumn,
    tabSize,
  )
  appendDocumentTextDisplayRows(
    rows,
    bufferRow,
    createInlineRow(text, options.inlineReplacements?.(bufferRow)),
    startOffset,
    options.wrapColumn,
    tabSize,
    text.length >= INDEXED_TEXT_MIN_LENGTH ? options.lineMeasurements?.(bufferRow) : undefined,
  )
  appendInjectedTextRows(
    rows,
    injectedTextRows,
    bufferRow,
    'after',
    options.lineEndOffset(bufferRow),
    options.wrapColumn,
    tabSize,
  )
}

const appendDocumentTextDisplayRows = (
  rows: DisplayRow[],
  bufferRow: number,
  inlineRow: InlineRow,
  startOffset: number,
  wrapColumn: number | null | undefined,
  tabSize: number,
  sourceMeasurements: TextMeasurements | undefined,
): void => {
  const transformed = inlineRow.text !== inlineRow.sourceText
  const measurements = indexedMeasurements(
    inlineRow.text,
    transformed ? undefined : sourceMeasurements,
  )
  const segments = displayTextSegments(inlineRow.text, wrapColumn, tabSize)

  for (const segment of segments) {
    const sourceStartColumn = inlineColumnToSourceColumn(inlineRow, segment.startColumn, 'before')
    const sourceEndColumn = inlineColumnToSourceColumn(inlineRow, segment.endColumn, 'after')
    const segmentMeasurements = measurementsForSegment(measurements, segment)

    rows.push({
      kind: 'text',
      source: 'document',
      index: rows.length,
      bufferRow,
      startOffset: startOffset + sourceStartColumn,
      endOffset: startOffset + sourceEndColumn,
      text: inlineRow.text.slice(segment.startColumn, segment.endColumn),
      ...(segmentMeasurements ? { measurements: segmentMeasurements } : {}),
      sourceText: inlineRow.sourceText,
      sourceStartColumn,
      sourceEndColumn,
      displayStartColumn: segment.startColumn,
      displayEndColumn: segment.endColumn,
      wrapSegment: segment.segmentIndex,
      ...(transformed ? { inlineRow } : {}),
    })
  }
}

function measurementsForSegment(
  measurements: TextMeasurements | undefined,
  segment: Pick<WrapSegment, 'startColumn' | 'endColumn'>,
): TextMeasurements | undefined {
  if (!measurements || segment.endColumn - segment.startColumn < INDEXED_TEXT_MIN_LENGTH)
    return undefined
  if (segment.startColumn === 0 && segment.endColumn === measurements.length) return measurements
  return measurements.slice(segment.startColumn, segment.endColumn)
}

const appendInjectedTextRows = (
  rows: DisplayRow[],
  injectedTextRows: InjectedTextRowIndex,
  bufferRow: number,
  placement: InjectedTextRowPlacement,
  offset: number,
  wrapColumn: number | null | undefined,
  tabSize: number,
): void => {
  const rowInjections = injectedTextRows.get(bufferRow)?.[placement]
  if (!rowInjections) return

  for (const injected of rowInjections) {
    appendInjectedTextRowSegments(rows, injected, offset, wrapColumn, tabSize)
  }
}

const appendInjectedTextRowSegments = (
  rows: DisplayRow[],
  injected: InjectedTextRow,
  offset: number,
  wrapColumn: number | null | undefined,
  tabSize: number,
): void => {
  const segments = displayTextSegments(injected.text, wrapColumn, tabSize)
  for (const segment of segments) {
    const row = injectedTextDisplayRow(rows.length, injected, offset, segment)
    const measurements = indexedMeasurements(row.text)
    rows.push(measurements ? { ...row, measurements } : row)
  }
}

const injectedTextDisplayRow = (
  index: number,
  injected: InjectedTextRow,
  offset: number,
  segment: Pick<WrapSegment, 'segmentIndex' | 'startColumn' | 'endColumn'>,
): DisplayInjectedTextRow => ({
  kind: 'text',
  source: 'injected',
  id: injected.id,
  index,
  bufferRow: injected.anchorBufferRow,
  anchorBufferRow: injected.anchorBufferRow,
  placement: injected.placement,
  order: injected.order ?? 0,
  startOffset: offset,
  endOffset: offset,
  text: injected.text.slice(segment.startColumn, segment.endColumn),
  sourceText: injected.text,
  sourceStartColumn: segment.startColumn,
  sourceEndColumn: segment.endColumn,
  displayStartColumn: segment.startColumn,
  displayEndColumn: segment.endColumn,
  wrapSegment: segment.segmentIndex,
  ...(injected.className === undefined ? {} : { className: injected.className }),
  ...(injected.gutterClassName === undefined ? {} : { gutterClassName: injected.gutterClassName }),
  ...(injected.metadata === undefined ? {} : { metadata: injected.metadata }),
})

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

const visualWidthForChar = (char: string, column: number, tabSize: number): number => {
  if (char !== '\t') return 1
  return tabSize - (column % tabSize)
}

const placementOrder = (placement: InjectedTextRowPlacement): number =>
  placement === 'before' ? 0 : 1

const normalizeInjectedTextRows = (rows: readonly InjectedTextRow[]): readonly InjectedTextRow[] =>
  rows
    .filter((row) => row.id.length > 0)
    .filter((row) => row.anchorBufferRow >= 0)
    .toSorted((left, right) => {
      return (
        left.anchorBufferRow - right.anchorBufferRow ||
        placementOrder(left.placement) - placementOrder(right.placement) ||
        (left.order ?? 0) - (right.order ?? 0) ||
        left.id.localeCompare(right.id)
      )
    })

const injectedTextRowIndex = (rows: readonly InjectedTextRow[]): InjectedTextRowIndex => {
  const index = new Map<number, MutableInjectedTextRowsAtBufferRow>()

  for (const row of normalizeInjectedTextRows(rows)) {
    injectedTextRowsAtBufferRow(index, row.anchorBufferRow)[row.placement].push(row)
  }

  return index
}

const injectedTextRowsAtBufferRow = (
  index: Map<number, MutableInjectedTextRowsAtBufferRow>,
  bufferRow: number,
): MutableInjectedTextRowsAtBufferRow => {
  const existing = index.get(bufferRow)
  if (existing) return existing

  const rows = { before: [], after: [] }
  index.set(bufferRow, rows)
  return rows
}

const lineTextFromFullText = (text: string, lineStarts: readonly number[], row: number): string =>
  text.slice(
    lineStartOffsetFromLineStarts(text, lineStarts, row),
    lineEndOffsetFromLineStarts(text, lineStarts, row),
  )

const lineStartOffsetFromLineStarts = (
  text: string,
  lineStarts: readonly number[],
  row: number,
): number => lineStarts[row] ?? text.length

const lineEndOffsetFromLineStarts = (
  text: string,
  lineStarts: readonly number[],
  row: number,
): number => {
  const nextLineStart = lineStarts[row + 1]
  if (nextLineStart === undefined) return text.length
  return Math.max(lineStartOffsetFromLineStarts(text, lineStarts, row), nextLineStart - 1)
}

const normalizeWrapColumn = (wrapColumn: number): number => {
  if (!Number.isFinite(wrapColumn) || wrapColumn <= 0) return 0
  return Math.max(1, Math.floor(wrapColumn))
}

const clampColumn = (value: number, max: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(0, Math.floor(value)), Math.max(0, max))
}
