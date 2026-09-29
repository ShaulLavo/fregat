import type { TextContent } from '../textContent'
import type { MeasuredText } from '../textMeasurements'
import {
  BIDI_CONTROL_CODE_POINTS,
  isSimpleRowText,
  controlCharacterInfo,
  oneCellControlCharacterLabel,
  estimatedCodePointWidth,
  type ControlCharacterInfo,
} from '../textCharacters'
import {
  bufferColumnToVisualColumn,
  visualColumnToBufferColumn,
  type TransformBias,
} from '../displayTransforms'
import {
  codePointLength,
  isCombiningMark,
  isVariationSelector,
  nextGraphemeBoundary,
  previousGraphemeBoundary,
  segmentGraphemes,
  type TextSegment,
} from '../graphemes'
import type { SelectionAffinity } from '../selections'
import { recordEditorPerformanceDiagnostic } from '../editor/performanceDiagnostics'
import { clamp } from '../style-utils'
import { RTL_BIDI_CHARACTER } from './bidiClassData'
import { rowLocalIndexForOffset, rowOffsetForLocalIndex } from './virtualizedTextViewInlineMapping'
import type {
  MountedVirtualizedTextRow,
  VirtualizedBidiRun,
  VirtualizedTextChunk,
  VirtualizedTextChunkPart,
  VirtualizedTextChunkTextPart,
} from './virtualizedTextViewTypes'
import type { VirtualizedTextViewInternal } from './virtualizedTextViewInternals'
import { bidiVisualRunIndexAt, memoizedContainsRTL } from './virtualizedTextViewBidi'

const CONTROL_CHARACTER_CLASS = 'editor-virtualized-control-character'
// These are exactly the code units the renderer replaces with visible labels or fixed-width boxes.
// oxlint-disable-next-line eslint/no-control-regex
const RENDERED_CONTROL_CHARACTER = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/

/**
 * How many columns of pure arithmetic are allowed between two measured anchors on a calculated row.
 * `characterWidth` is an average taken over a probe string, so it sits a fraction of a pixel away
 * from any real advance, and multiplying it by a column index carries that error along with it —
 * unbounded in the line's length, which is why a caret drifts further from its glyph the further
 * right it goes. Re-reading a real advance every so often caps the error at whatever accumulates
 * over this many columns, for one layout read per anchor.
 */
const KEY_COLUMN_DISTANCE = 300
const COLUMN_EPSILON = 1e-9
const RANGE_RECT_MERGE_EPSILON = 0.9
const BIDI_BOUNDARY_EPSILON = 0.9
const BIDI_RECOVERED_SEAM_EPSILON = 1.1
const UNREAD_DIRECTIONAL_CARRIER = -2
const NO_DIRECTIONAL_CARRIER = -1

/**
 * Boundaries as two parallel arrays rather than one object per boundary: a row is rebuilt on every
 * scroll frame that remounts it, and a character-length object array plus a sorted copy of it is
 * garbage the collector pays for while the user is dragging.
 *
 * `offsets` ascends by construction. `xs` ascends with it for every row whose parts all measured,
 * so both directions binary-search the pair in place; `xOrder` carries the x ordering only for the
 * rows that interleave measured and estimated widths and can therefore step backwards.
 */
type RowGeometry = {
  readonly offsets: Float64Array
  readonly xs: Float64Array
  /**
   * What is still owed on `xs`, or null once nothing is. A caret asks one row for one column, so
   * reading the row's every advance to answer it is the whole row's cost spent on a hundredth of
   * it. The plan holds what a boundary would be read from, and `xs` starts as sentinels that the
   * boundaries somebody actually asks about replace.
   */
  plan: MeasuredRowPlan | null
  /** Retained after a whole-row resolve so one-glyph consumers can reuse the measured unit box. */
  readonly unitPlan: MeasuredRowPlan | null
  xOrder: Uint32Array | null
  width: number
  /**
   * Flattened (x, visual column) pairs, ascending, that a calculated row extrapolated from — null
   * when it extrapolated from column zero alone. The inverse mapping has to start from the same
   * anchor the boundary did, or a hit test and the caret it places disagree about the same column.
   */
  readonly anchors: Float64Array | null
  bidiRuns: readonly VirtualizedBidiRun[] | null | undefined
}

/** No advance is ever NaN, so it is free to stand for a boundary that has not been read yet. */
const UNREAD = Number.NaN

const LOGICAL_START = 0
const LOGICAL_END = 1

type MeasuredUnitKind = 'text' | 'control' | 'widget'

/**
 * One advance a measured row is assembled from: a grapheme of a text part, a control glyph, or a
 * mounted replacement. Which offsets it spans follows from the text alone and costs no layout, so a
 * row can be laid out in units in full while none of them has been measured.
 */
type MeasuredUnit = {
  readonly kind: MeasuredUnitKind
  readonly node: Text | null
  readonly nodeOffset: number
  readonly nodeLength: number
  readonly element: HTMLElement | null
  readonly widthCells: number
  readonly localStart: number
  readonly localEnd: number
  /**
   * The unit this one follows inside its chunk, or -1 at a chunk's first. Only a unit that fails to
   * measure — or a replacement, which is placed rather than measured — needs it: it stands where
   * whatever precedes it ended, and that is the one direction a lazy read has to chase.
   */
  readonly previous: number
  /** Where the chunk begins, for a unit with nothing before it to stand after. */
  readonly chunkX: number
}

type MeasuredRowPlan = {
  readonly view: VirtualizedTextViewInternal
  readonly row: MountedVirtualizedTextRow
  readonly baseDirection: MeasuredUnitDirection
  readonly units: readonly MeasuredUnit[]
  readonly lefts: Float64Array
  readonly widths: Float64Array
  /** Per boundary: the unit whose edge stands there, or -1 for one no unit reaches. */
  readonly writerUnit: Int32Array
  readonly writerSide: Uint8Array
  readonly writerX: Float64Array
  readonly mightContainRTL: boolean
  measurement: RowMeasurementContext | null
  bidiFormattingStates: readonly BidiFormattingState[] | null
  readonly bidiUnitDirections: (MeasuredUnitDirection | null | undefined)[]
  readonly backwardDirectionalCarriers: Int32Array
  readonly forwardDirectionalCarriers: Int32Array
}

type BoundaryBuffer = {
  offsets: Float64Array
  xs: Float64Array
  length: number
}

type PlanBuffer = {
  readonly offsets: Float64Array
  readonly writerUnit: Int32Array
  readonly writerSide: Uint8Array
  readonly writerX: Float64Array
  length: number
}

/**
 * Sampled once and carried through every advance a row is read for. `scale` is itself a layout
 * read, and two readings of it taken at different points would put the boundaries either side of
 * them in different spaces.
 */
type RowMeasurementContext = {
  readonly row: MountedVirtualizedTextRow
  readonly scale: number
}

/**
 * One Range reused for every segment instead of one allocated per grapheme, since a measured row
 * asks for as many rects as it has graphemes and the Range is scratch in all of them. It is parked
 * on a detached node between reads so it stops holding the row it last measured, which the row pool
 * is free to recycle underneath it.
 */
type MeasurementScratch = {
  readonly document: Document
  readonly range: Range
  readonly parking: Text
}

type RowGeometryCache = {
  readonly key: string
  readonly geometry: RowGeometry
}

type MutableRowGeometryCache = MountedVirtualizedTextRow & {
  geometryCache: RowGeometryCache | null
}

type HomogeneousRtlTextCache = {
  readonly textRevision: number
  readonly chunkKey: string
  readonly startOffset: number
  readonly textLength: number
  readonly classification: RtlTextClassification
}

type RtlTextClassification = 'controls-only' | 'homogeneous' | 'other'

type RowContentWidthCache = {
  readonly key: string
  readonly width: number
  readonly extent: RowTextExtent
}

export type RowTextExtent = {
  readonly left: number
  readonly right: number
}

type GeometryRangeSegment = {
  readonly left: number
  readonly width: number
}

type BidiRunBoundary = {
  readonly geometryIndex: number
  readonly offset: number
  readonly positions: readonly number[]
}

type BidiRunProbe = {
  readonly boundaries: readonly BidiRunBoundary[]
  readonly singleXs: Float64Array
}

type MeasuredUnitDirection = VirtualizedBidiRun['direction']

type DirectionalBoundaryUnit = {
  readonly direction: MeasuredUnitDirection
  readonly logicalEdge: 'start' | 'end'
  readonly unitIndex: number
}

type BidiFormattingState = {
  readonly kind: 'embedding' | 'isolate'
  readonly direction: MeasuredUnitDirection
  readonly override: MeasuredUnitDirection | null
}

type BidiDirectionalControlKind = 'none' | 'embedding-opener' | 'isolate-opener' | 'closer'

type PositionedBidiRun = {
  readonly run: VirtualizedBidiRun
  readonly left: number
  readonly right: number
}

type PositionedMeasuredUnit = {
  readonly direction: MeasuredUnitDirection | null
  readonly left: number
  readonly start: number
  readonly end: number
}

type BidiRunEdges = {
  readonly start: number
  readonly end: number
}

export type VisualCaretTarget = {
  readonly offset: number
  readonly affinity: SelectionAffinity
}

export type VisualRowCaretMove = VisualCaretTarget | { readonly kind: 'row-edge' }

type DomBoundary = {
  readonly node: Node
  readonly offset: number
}

export type RenderedChunkParts = {
  readonly nodes: readonly Node[]
  readonly parts: readonly VirtualizedTextChunkPart[]
  readonly textNode: Text
  readonly oversizedGrapheme: boolean
}

/** Where a mounted inline replacement sits in a row's rendered text, in row-local indices. */
export type InlineWidgetPlacement = {
  readonly localStart: number
  readonly localEnd: number
  readonly element: HTMLSpanElement
}

let rowRectMeasurementDepth = 0
let measuredRowRects: Map<HTMLElement, DOMRect> | null = null
/** `rowClientRectScale`, kept as long as the rect it divides: its `offsetWidth` is a layout read too. */
let measuredRowScales: Map<HTMLElement, number> | null = null
let measurementScratch: MeasurementScratch | null = null
const measuredRowWidths = new WeakMap<HTMLElement, RowContentWidthCache>()
const dualCollapsedBidiPositionSupport = new WeakMap<
  Document,
  { readonly getClientRects: Range['getClientRects'] | undefined; readonly supported: boolean }
>()
const bidiMeasurementRefusals = new WeakMap<
  HTMLElement,
  { readonly key: string; readonly refused: boolean }
>()
const homogeneousRtlTextCaches = new WeakMap<MountedVirtualizedTextRow, HomogeneousRtlTextCache>()
/**
 * Kept per element rather than per row: a mounted replacement outlives the rows it is painted into,
 * and its advance is a property of the node, not of whichever row currently hosts it.
 */
const inlineWidgetWidths = new WeakMap<HTMLElement, number>()
/**
 * Bumped whenever any of those advances moves, and carried in the row geometry key so that a row
 * hosting a replacement retires everything keyed against it. Global rather than per element,
 * because the key is built from the row and a row does not know which nodes it is standing on.
 */
let inlineWidgetWidthRevision = 0
let rowGeometrySweepCount = 0
let rtlTextClassificationScanCount = 0

/** Why a row's geometry is built the way it is; every value but `calculated` measures the DOM. */
type RowGeometryPath =
  | 'calculated'
  | 'inline-mapping'
  | 'non-simple-text'
  | 'proportional-font'
  | 'tab'

export function createTextChunkParts(
  node: Text,
  localStart: number,
  localEnd: number,
): readonly VirtualizedTextChunkTextPart[] {
  return [
    {
      kind: 'text',
      localStart,
      localEnd,
      node,
    },
  ]
}

export function createRenderedChunkParts(
  document: Document,
  text: TextContent,
  localStart: number,
  cellWidth: number,
  widgets: readonly InlineWidgetPlacement[] = [],
  maxTextNodeLength = Number.POSITIVE_INFINITY,
): RenderedChunkParts {
  const parts: VirtualizedTextChunkPart[] = []
  const nodes: Node[] = []
  let cursor = 0

  for (const widget of widgets) {
    const start = widget.localStart - localStart
    const fitsTextNodeBound = appendRenderedText(
      document,
      parts,
      nodes,
      text.slice(cursor, start),
      localStart + cursor,
      cellWidth,
      maxTextNodeLength,
    )
    if (!fitsTextNodeBound) return oversizedRenderedChunkParts(document)

    nodes.push(widget.element)
    parts.push({
      kind: 'widget',
      localStart: widget.localStart,
      localEnd: widget.localEnd,
      element: widget.element,
    })
    cursor = widget.localEnd - localStart
  }

  const fitsTextNodeBound = appendRenderedText(
    document,
    parts,
    nodes,
    text.slice(cursor),
    localStart + cursor,
    cellWidth,
    maxTextNodeLength,
  )
  if (!fitsTextNodeBound) return oversizedRenderedChunkParts(document)

  return {
    nodes,
    parts,
    textNode: firstTextNode(parts) ?? document.createTextNode(''),
    oversizedGrapheme: false,
  }
}

function appendRenderedText(
  document: Document,
  parts: VirtualizedTextChunkPart[],
  nodes: Node[],
  text: string,
  localStart: number,
  cellWidth: number,
  maxTextNodeLength: number,
): boolean {
  if (!RENDERED_CONTROL_CHARACTER.test(text)) {
    return appendTextParts(document, parts, nodes, localStart, text, maxTextNodeLength)
  }

  let run = ''
  let runStart = localStart
  let index = 0

  while (index < text.length) {
    const code = text.charCodeAt(index)
    const oneCell = oneCellControlCharacterLabel(code)
    if (oneCell !== null) {
      run += oneCell
      index += 1
      continue
    }

    const control = controlCharacterInfo(code)
    if (!control) {
      run += text[index]!
      index += 1
      continue
    }

    if (!appendTextParts(document, parts, nodes, runStart, run, maxTextNodeLength)) return false

    run = ''
    index += 1
    appendControlPart(document, parts, nodes, localStart + index - 1, control, cellWidth)
    runStart = localStart + index
  }

  return appendTextParts(document, parts, nodes, runStart, run, maxTextNodeLength)
}

function oversizedRenderedChunkParts(document: Document): RenderedChunkParts {
  return {
    nodes: [],
    parts: [],
    textNode: document.createTextNode(''),
    oversizedGrapheme: true,
  }
}

/**
 * Reports whether the advance changed, so a caller that has just measured can tell whether anything
 * that already read this width has to read it again.
 */
export function setInlineWidgetMeasuredWidth(element: HTMLElement, width: number): boolean {
  if (inlineWidgetWidths.get(element) === width) return false

  inlineWidgetWidths.set(element, width)
  inlineWidgetWidthRevision += 1
  return true
}

export function clearRowGeometryCache(row: MountedVirtualizedTextRow): void {
  ;(row as MutableRowGeometryCache).geometryCache = null
}

export function clearRowGeometryCaches(view: VirtualizedTextViewInternal): void {
  for (const row of view.rowElements.values()) clearRowGeometryCache(row)
  for (const row of view.rowPool) clearRowGeometryCache(row)
}

export function offsetToX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
): number {
  const geometry = ensureRowGeometry(view, row)
  const clamped = clamp(offset, row.startOffset, row.endOffset)
  return xForOffset(geometry, clamped)
}

export function xToOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
  scale?: number,
): number {
  if (rowUsesCalculatedGeometry(view, row)) return calculatedXToOffset(view, row, x, scale)

  const geometry = ensureRowGeometry(view, row)
  return offsetForX(geometry, Math.max(0, x))
}

/** Null when the row's rendered width is only available for the price of a layout read. */
export function knownRowContentWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): number | null {
  const key = rowGeometryCacheKey(view, row)
  const cached = row.geometryCache as RowGeometryCache | null
  if (cached?.key === key && !cached.geometry.plan && Number.isFinite(cached.geometry.width))
    return cached.geometry.width
  if (rowUsesCalculatedGeometry(view, row)) return calculatedRowWidth(view, row)

  const measured = measuredRowWidths.get(row.element)
  return measured?.key === key ? measured.width : null
}

/**
 * Pays that price: one rect per chunk, against the one per grapheme a geometry build spends. What
 * comes back is kept against the key that retires the row's geometry, so even a row whose rects all
 * read empty is asked once rather than once per frame.
 */
export function measureRowContentWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): number {
  return measuredRowContent(view, row).width
}

export function rowTextExtent(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowTextExtent {
  return measuredRowContent(view, row).extent
}

export function rowLocalXFromClientPoint(row: MountedVirtualizedTextRow, clientX: number): number {
  const rect = row.element.getBoundingClientRect()
  const scale = normalizedRowClientRectScale(rect.width, row.element.offsetWidth)
  return (clientX - rect.left) / scale
}

function measuredRowContent(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowContentWidthCache {
  const key = rowGeometryCacheKey(view, row)
  const cached = measuredRowWidths.get(row.element)
  if (cached?.key === key) return cached

  const known = knownRowContentWidth(view, row)
  if (known !== null) {
    return { key, width: known, extent: { left: 0, right: known } }
  }

  const measurement = { row, scale: rowClientRectScale(row) }
  const measured = measuredRowContentsRect(measurement)
  const contentRight = measured ? measured.left + measured.width : 0
  const width = measured ? contentRight : estimatedRowContentWidth(view, row)
  const extent = measured ? { left: measured.left, right: contentRight } : { left: 0, right: width }
  const content = { key, width, extent }
  measuredRowWidths.set(row.element, content)
  return content
}

export function rowMightContainRTL(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): boolean {
  return memoizedContainsRTL(view, row)
}

export function boundaryPositionXs(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
): readonly number[] {
  const geometry = ensureRowGeometry(view, row)
  const clamped = clamp(offset, row.startOffset, row.endOffset)
  const index = firstBoundaryAtOrAfterOffset(geometry.offsets, clamped)
  if (geometry.offsets[index] !== clamped) return [xForOffset(geometry, clamped)]

  return boundaryPositionXsAtIndex(row, geometry, index)
}

function boundaryPositionXsAtIndex(
  row: MountedVirtualizedTextRow,
  geometry: RowGeometry,
  index: number,
): readonly number[] {
  const offset = geometry.offsets[index]!
  const plan = geometry.unitPlan
  const boundaries = plan ? domBoundariesForGeometryIndex(row, plan, index, offset) : []
  const xs = plan ? collapsedBoundaryPositionXs(planMeasurement(plan), boundaries) : []
  if (xs.length > 0) return recoveredBidiBoundaryPositionXs(plan, index, offset, xs)
  if (plan) {
    const fallback = zeroRectBoundaryX(plan, index, offset)
    geometry.xs[index] = fallback
    return [fallback]
  }
  return [boundaryX(geometry, index)]
}

/** Null means no engine result is available, so callers must keep the logical path. */
export function bidiRunsForRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): readonly VirtualizedBidiRun[] | null {
  if (!rowMightContainRTL(view, row)) return null

  const cached = cachedRowGeometry(view, row)
  if (cached?.bidiRuns !== undefined) return cached.bidiRuns
  if (isBidiMeasurementRefusalRow(view, row)) return null

  const homogeneous = homogeneousRtlRun(row)
  if (homogeneous) return homogeneous

  const geometry = cached ?? ensureRowGeometry(view, row)
  geometry.bidiRuns = buildBidiRuns(view, row, geometry)
  return geometry.bidiRuns
}

function homogeneousRtlRun(row: MountedVirtualizedTextRow): readonly VirtualizedBidiRun[] | null {
  if (row.inlineMapping || row.text.length === 0) return null
  if (!hasHomogeneousRtlText(row)) return null

  return [{ startOffset: row.startOffset, endOffset: row.endOffset, direction: 'rtl' }]
}

function hasHomogeneousRtlText(row: MountedVirtualizedTextRow): boolean {
  return rtlTextClassification(row) === 'homogeneous'
}

export function rowHasOnlyBidiControls(row: MountedVirtualizedTextRow): boolean {
  if (row.inlineMapping || row.text.length === 0) return false
  return rtlTextClassification(row) === 'controls-only'
}

function rtlTextClassification(row: MountedVirtualizedTextRow): RtlTextClassification {
  const cached = homogeneousRtlTextCaches.get(row)
  if (
    cached?.textRevision === row.textRevision &&
    cached.chunkKey === row.chunkKey &&
    cached.startOffset === row.startOffset &&
    cached.textLength === row.text.length
  ) {
    return cached.classification
  }

  const classification = classifyRtlText(row.text)
  homogeneousRtlTextCaches.set(row, {
    textRevision: row.textRevision,
    chunkKey: row.chunkKey,
    startOffset: row.startOffset,
    textLength: row.text.length,
    classification,
  })
  return classification
}

function classifyRtlText(text: TextContent): RtlTextClassification {
  rtlTextClassificationScanCount += 1
  let hasStrongCharacter = false
  let hasBidiControl = false
  let hasNonControl = false
  for (let index = 0; index < text.length; index += codePointLength(text, index)) {
    const codePoint = text.codePointAt(index)!
    if (isBidiControlCodePoint(codePoint)) {
      hasBidiControl = true
      continue
    }
    hasNonControl = true
    if (RTL_BIDI_CHARACTER.test(String.fromCodePoint(codePoint))) {
      hasStrongCharacter = true
      continue
    }
    const inheritsDirection = isCombiningMark(codePoint) || isVariationSelector(codePoint)
    if (inheritsDirection && !hasStrongCharacter) return 'other'
    if (inheritsDirection) continue
    return 'other'
  }
  if (hasBidiControl && !hasNonControl) return 'controls-only'
  if (hasBidiControl) return 'other'
  return hasStrongCharacter ? 'homogeneous' : 'other'
}

export function visualCaretMoveInRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  const homogeneous = homogeneousRtlCaretMoveInRow(view, row, offset, direction)
  if (homogeneous) return homogeneous

  const runs = bidiRunsForRow(view, row)
  if (!runs) return plainCaretMoveInRow(view, row, offset, direction)

  const clamped = clamp(offset, row.startOffset, row.endOffset)
  const normalized = normalizedBoundaryAffinity(row, clamped, affinity)
  let current = { offset: clamped, affinity: normalized }
  let currentX = strongCaretX(view, row, current)
  for (let steps = 0; steps <= row.text.length + runs.length; steps += 1) {
    const next = nextBidiCaretMove(row, runs, current, direction)
    if (!next || 'kind' in next) return next

    const nextX = strongCaretX(view, row, next)
    if (Math.abs(nextX - currentX) > BIDI_BOUNDARY_EPSILON) return next

    current = next
    currentX = nextX
  }

  return { kind: 'row-edge' }
}

export function homogeneousRtlCaretMoveInRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  if (!rowMightContainRTL(view, row)) return null
  if (isBidiMeasurementRefusalRow(view, row)) return null
  if (!homogeneousRtlRun(row)) return null
  return homogeneousRtlCaretMove(row, offset, direction)
}

export function homogeneousRtlCaretAtRowEdge(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  edge: 'left' | 'right',
): VisualCaretTarget | null {
  if (!rowMightContainRTL(view, row)) return null
  if (isBidiMeasurementRefusalRow(view, row)) return null
  if (!homogeneousRtlRun(row)) return null
  if (edge === 'left') return { offset: row.endOffset, affinity: 'before' }
  return { offset: row.startOffset, affinity: 'after' }
}

function homogeneousRtlCaretMove(
  row: MountedVirtualizedTextRow,
  offset: number,
  direction: 'left' | 'right',
): VisualRowCaretMove {
  const clamped = clamp(offset, row.startOffset, row.endOffset)
  const logicalDirection = direction === 'right' ? 'backward' : 'forward'
  const target = rowUnitOffset(row, clamped, logicalDirection)
  if (target === clamped) return { kind: 'row-edge' }

  return {
    offset: target,
    affinity: logicalDirection === 'forward' ? 'before' : 'after',
  }
}

function plainCaretMoveInRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  if (rowMightContainRTL(view, row)) return null

  const clamped = clamp(offset, row.startOffset, row.endOffset)
  const logicalDirection = direction === 'left' ? 'backward' : 'forward'
  const target = rowUnitOffset(row, clamped, logicalDirection)
  if (target === clamped) return { kind: 'row-edge' }

  return {
    offset: target,
    affinity: logicalDirection === 'forward' ? 'before' : 'after',
  }
}

function nextBidiCaretMove(
  row: MountedVirtualizedTextRow,
  runs: readonly VirtualizedBidiRun[],
  current: VisualCaretTarget,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  const runIndex = bidiVisualRunIndexAt(runs, current.offset, current.affinity)
  if (runIndex === null) return null

  const run = runs[runIndex]!
  const target = moveOneBidiUnit(row, run, current.offset, direction)
  if (target) return target

  const adjacentIndex = runIndex + (direction === 'left' ? -1 : 1)
  const adjacent = runs[adjacentIndex]
  if (!adjacent) return { kind: 'row-edge' }

  const entryEdge = direction === 'left' ? 'right' : 'left'
  const entry = visualRunEdgeTarget(adjacent, entryEdge)
  return moveOneBidiUnit(row, adjacent, entry.offset, direction) ?? entry
}

function strongCaretX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  target: VisualCaretTarget,
): number {
  return boundaryPositionXsForAffinity(view, row, target.offset, target.affinity)[0]!
}

export function visualCaretAtRowEdge(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  edge: 'left' | 'right',
): VisualCaretTarget | null {
  const runs = bidiRunsForRow(view, row)
  if (!runs) return plainCaretAtRowEdge(view, row, edge)

  const run = edge === 'left' ? runs[0] : runs.at(-1)
  return run ? visualRunEdgeTarget(run, edge) : null
}

function plainCaretAtRowEdge(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  edge: 'left' | 'right',
): VisualCaretTarget | null {
  if (rowMightContainRTL(view, row)) return null
  if (edge === 'left') return { offset: row.startOffset, affinity: 'after' }
  return { offset: row.endOffset, affinity: 'before' }
}

function moveOneBidiUnit(
  row: MountedVirtualizedTextRow,
  run: VirtualizedBidiRun,
  offset: number,
  direction: 'left' | 'right',
): VisualCaretTarget | null {
  const logicalDirection = logicalDirectionForVisualMove(run.direction, direction)
  const target = rowUnitOffset(row, offset, logicalDirection)
  if (target === offset) return null
  if (target < run.startOffset || target > run.endOffset) return null

  return {
    offset: target,
    affinity: logicalDirection === 'forward' ? 'before' : 'after',
  }
}

function logicalDirectionForVisualMove(
  runDirection: VirtualizedBidiRun['direction'],
  direction: 'left' | 'right',
): 'backward' | 'forward' {
  if (direction === 'right') return runDirection === 'ltr' ? 'forward' : 'backward'
  return runDirection === 'ltr' ? 'backward' : 'forward'
}

function visualRunEdgeTarget(run: VirtualizedBidiRun, edge: 'left' | 'right'): VisualCaretTarget {
  if (edge === 'left' && run.direction === 'ltr') {
    return { offset: run.startOffset, affinity: 'after' }
  }
  if (edge === 'left') return { offset: run.endOffset, affinity: 'before' }
  if (run.direction === 'ltr') return { offset: run.endOffset, affinity: 'before' }
  return { offset: run.startOffset, affinity: 'after' }
}

function buildBidiRuns(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  geometry: RowGeometry,
): readonly VirtualizedBidiRun[] | null {
  const probe = probeBidiRunBoundaries(row, geometry)
  const boundaries = probe.boundaries
  const positioned: PositionedBidiRun[] = []
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1]!
    const end = boundaries[index]!
    const candidate = positionedBidiRun(view, row, geometry, probe.singleXs, start, end)
    if (candidate) positioned.push(candidate)
  }
  if (positioned.length === 0) return null

  positioned.sort(comparePositionedBidiRuns)
  return positioned.map((entry) => entry.run)
}

function probeBidiRunBoundaries(
  row: MountedVirtualizedTextRow,
  geometry: RowGeometry,
): BidiRunProbe {
  const boundaries: BidiRunBoundary[] = []
  const singleXs = new Float64Array(geometry.offsets.length).fill(Number.NaN)
  const lastIndex = geometry.offsets.length - 1
  const trustSingleXs = engineSupportsDualCollapsedBidiPositions(row.element.ownerDocument)
  for (let index = 0; index <= lastIndex; index += 1) {
    const positions = boundaryPositionXsAtIndex(row, geometry, index)
    if (trustSingleXs && positions.length === 1) singleXs[index] = positions[0]!
    const endpoint = index === 0 || index === lastIndex
    if (!endpoint && positions.length < 2) continue
    boundaries.push({ geometryIndex: index, offset: geometry.offsets[index]!, positions })
  }
  return { boundaries, singleXs }
}

function positionedBidiRun(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  geometry: RowGeometry,
  singleXs: Float64Array,
  start: BidiRunBoundary,
  end: BidiRunBoundary,
): PositionedBidiRun | null {
  if (end.offset <= start.offset) return null

  const edges = bidiRunEdges(view, row, start, end)
  const direction = bidiRunDirection(view, row, geometry, singleXs, start, end, edges)
  return {
    run: { startOffset: start.offset, endOffset: end.offset, direction },
    left: Math.min(edges.start, edges.end),
    right: Math.max(edges.start, edges.end),
  }
}

function bidiRunEdges(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  start: BidiRunBoundary,
  end: BidiRunBoundary,
): BidiRunEdges {
  return {
    start: boundaryPositionXsForAffinity(view, row, start.offset, 'after', start.positions)[0]!,
    end: boundaryPositionXsForAffinity(view, row, end.offset, 'before', end.positions)[0]!,
  }
}

function bidiRunDirection(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  geometry: RowGeometry,
  singleXs: Float64Array,
  start: BidiRunBoundary,
  end: BidiRunBoundary,
  edges: BidiRunEdges,
): VirtualizedBidiRun['direction'] {
  const interior = directionFromInteriorBoundaries(singleXs, start, end)
  if (interior) return interior

  const plan = geometry.unitPlan
  if (!plan) return directionFromRunEdges(edges)

  let first: PositionedMeasuredUnit | null = null
  const firstUnit = Math.max(0, plan.writerUnit[start.geometryIndex] ?? 0)
  for (let index = firstUnit; index < plan.units.length; index += 1) {
    const planUnit = plan.units[index]
    if (!planUnit) break
    const unitStart = rowOffsetForLocalIndex(row, planUnit.localStart)
    if (unitStart >= end.offset) break

    const unit = visibleUnitInRun(plan, index, start.offset, end.offset)
    if (!unit) continue
    if (!first) {
      first = unit
      continue
    }

    const delta = unit.left - first.left
    if (Math.abs(delta) <= BIDI_BOUNDARY_EPSILON) continue
    return delta < 0 ? 'rtl' : 'ltr'
  }
  if (!first) return directionFromRunEdges(edges)
  if (first.direction) return first.direction
  return directionFromUnit(view, row, first)
}

function directionFromInteriorBoundaries(
  singleXs: Float64Array,
  start: BidiRunBoundary,
  end: BidiRunBoundary,
): VirtualizedBidiRun['direction'] | null {
  let first = Number.NaN
  for (let index = start.geometryIndex + 1; index < end.geometryIndex; index += 1) {
    const x = singleXs[index]!
    if (Number.isNaN(x)) continue
    if (Number.isNaN(first)) {
      first = x
      continue
    }

    const delta = x - first
    if (Math.abs(delta) <= BIDI_BOUNDARY_EPSILON) continue
    return delta < 0 ? 'rtl' : 'ltr'
  }
  return null
}

function visibleUnitInRun(
  plan: MeasuredRowPlan,
  index: number,
  runStart: number,
  runEnd: number,
): PositionedMeasuredUnit | null {
  const unit = plan.units[index]
  if (!unit) return null

  const start = rowOffsetForLocalIndex(plan.row, unit.localStart)
  const end = rowOffsetForLocalIndex(plan.row, unit.localEnd)
  if (start < runStart) return null
  if (end > runEnd) return null
  if (start >= runEnd) return null
  if (unit.kind === 'widget') return null
  if (isBidiControlAtLocalIndex(plan.row, unit.localStart)) return null

  resolveUnit(plan, index)
  if (plan.widths[index]! <= BIDI_BOUNDARY_EPSILON) return null
  return { direction: measuredUnitDirection(plan, index), left: plan.lefts[index]!, start, end }
}

function directionFromUnit(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  unit: { readonly start: number; readonly end: number },
): VirtualizedBidiRun['direction'] {
  const start = boundaryPositionXsForAffinity(view, row, unit.start, 'after')[0]!
  const end = boundaryPositionXsForAffinity(view, row, unit.end, 'before')[0]!
  return end < start ? 'rtl' : 'ltr'
}

function directionFromRunEdges(edges: BidiRunEdges): VirtualizedBidiRun['direction'] {
  return edges.end < edges.start ? 'rtl' : 'ltr'
}

function comparePositionedBidiRuns(left: PositionedBidiRun, right: PositionedBidiRun): number {
  return (
    left.left - right.left ||
    left.right - right.right ||
    left.run.startOffset - right.run.startOffset
  )
}

export function isBidiMeasurementRefusalRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): boolean {
  const key = rowGeometryCacheKey(view, row)
  const cached = bidiMeasurementRefusals.get(row.element)
  if (cached?.key === key) return cached.refused

  const refused = row.element.querySelector('[data-editor-bidi-measurement-refusal]') !== null
  bidiMeasurementRefusals.set(row.element, { key, refused })
  return refused
}

export function resetRowGeometrySweepCount(): void {
  rowGeometrySweepCount = 0
}

export function getRowGeometrySweepCount(): number {
  return rowGeometrySweepCount
}

export function resetRtlTextClassificationScanCount(): void {
  rtlTextClassificationScanCount = 0
}

export function getRtlTextClassificationScanCount(): number {
  return rtlTextClassificationScanCount
}

export function unitRectForOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
): { readonly left: number; readonly width: number } | null {
  const geometry = ensureRowGeometry(view, row)
  const plan = geometry.unitPlan
  if (!plan) return calculatedUnitRect(view, row, offset)

  const boundary = firstBoundaryAtOrAfterOffset(geometry.offsets, offset)
  if (geometry.offsets[boundary] !== offset) return null

  const unitIndex = plan.writerUnit[boundary]
  if (unitIndex === undefined || unitIndex < 0) return null

  const unit = plan.units[unitIndex]
  if (!unit || rowOffsetForLocalIndex(row, unit.localStart) !== offset) return null

  resolveUnit(plan, unitIndex)
  return { left: plan.lefts[unitIndex]!, width: plan.widths[unitIndex]! }
}

export function boundaryPositionXsForAffinity(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
  positions?: readonly number[],
): readonly number[] {
  if (!rowMightContainRTL(view, row)) return [offsetToX(view, row, offset)]

  const candidates = positions ?? boundaryPositionXs(view, row, offset)
  if (candidates.length !== 2) return candidates

  const normalized = normalizedBoundaryAffinity(row, offset, affinity)
  const before = preferredBoundaryPositionIndex(view, row, offset, candidates, 'before')
  const after = preferredBoundaryPositionIndex(view, row, offset, candidates, 'after')
  return orderBoundaryPositionsForAffinity(candidates, normalized, before, after)
}

export function boundaryAffinityForX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  x: number,
  positions?: readonly number[],
): SelectionAffinity {
  const endpoint = normalizedBoundaryAffinity(row, offset, 'after')
  if (!rowMightContainRTL(view, row)) return endpoint

  const candidates = positions ?? boundaryPositionXs(view, row, offset)
  if (candidates.length !== 2) return endpoint

  const beforeIndex = preferredBoundaryPositionIndex(view, row, offset, candidates, 'before')
  const afterIndex = preferredBoundaryPositionIndex(view, row, offset, candidates, 'after')
  const before = orderBoundaryPositionsForAffinity(
    candidates,
    'before',
    beforeIndex,
    afterIndex,
  )[0]!
  const after = orderBoundaryPositionsForAffinity(candidates, 'after', beforeIndex, afterIndex)[0]!
  if (before === after) return endpoint
  return Math.abs(x - before) < Math.abs(x - after) ? 'before' : 'after'
}

function orderBoundaryPositionsForAffinity(
  positions: readonly number[],
  affinity: SelectionAffinity,
  before: number | null,
  after: number | null,
): readonly number[] {
  const preferred = affinity === 'before' ? before : after
  if (preferred !== null) return [positions[preferred]!, positions[1 - preferred]!]

  const other = affinity === 'before' ? after : before
  if (other !== null) return [positions[1 - other]!, positions[other]!]
  return positions
}

function preferredBoundaryPositionIndex(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  positions: readonly number[],
  affinity: SelectionAffinity,
): number | null {
  const coincident = coincidentUnitBoundaryIndex(view, row, offset, positions, affinity)
  if (coincident !== null) return coincident

  const unitOffset = affinity === 'before' ? previousRowUnitOffset(row, offset) : offset
  const rect = unitRectForOffset(view, row, unitOffset)
  if (!rect) return null

  const first = unitEdgeDistance(rect, positions[0]!)
  const second = unitEdgeDistance(rect, positions[1]!)
  if (Math.abs(first - second) <= 1) return null
  return first < second ? 0 : 1
}

function coincidentUnitBoundaryIndex(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  positions: readonly number[],
  affinity: SelectionAffinity,
): number | null {
  const unitOffset = affinity === 'before' ? previousRowUnitOffset(row, offset) : offset
  if (!isBidiControlAtOffset(row, unitOffset)) return null

  // Chromium gives an invisible BiDi control's nonempty range a neighbor's box. Its collapsed far
  // boundary is the trustworthy zero-advance signal.
  const adjacentOffset =
    affinity === 'before' ? previousRowUnitOffset(row, offset) : nextRowUnitOffset(row, offset)
  if (adjacentOffset === offset) return null

  const adjacent = boundaryPositionXs(view, row, adjacentOffset)
  const matches = positions.map((position) =>
    adjacent.some((candidate) => Math.abs(candidate - position) <= BIDI_BOUNDARY_EPSILON),
  )
  if (matches[0] === matches[1]) return null
  return matches[0] ? 0 : 1
}

function isBidiControlAtOffset(row: MountedVirtualizedTextRow, offset: number): boolean {
  const local = rowLocalIndexForOffset(row, offset, 'after')
  return isBidiControlAtLocalIndex(row, local)
}

function isBidiControlAtLocalIndex(row: MountedVirtualizedTextRow, local: number): boolean {
  const codePoint = row.text.codePointAt(local)
  return isBidiControlCodePoint(codePoint)
}

function isBidiControlCodePoint(codePoint: number | undefined): boolean {
  return BIDI_CONTROL_CODE_POINTS.some((candidate) => candidate === codePoint)
}

function normalizedBoundaryAffinity(
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
): SelectionAffinity {
  if (offset <= row.startOffset) return 'after'
  if (offset >= row.endOffset) return 'before'
  return affinity
}

function previousRowUnitOffset(row: MountedVirtualizedTextRow, offset: number): number {
  let local = rowLocalIndexForOffset(row, offset, 'before')
  while (local > 0) {
    const previous = previousGraphemeBoundary(row.text, local)
    if (previous === local) return offset

    const target = rowOffsetForLocalIndex(row, previous, 'before')
    if (target !== offset) return target
    local = previous
  }

  return offset
}

function nextRowUnitOffset(row: MountedVirtualizedTextRow, offset: number): number {
  let local = rowLocalIndexForOffset(row, offset, 'after')
  while (local < row.text.length) {
    const next = nextGraphemeBoundary(row.text, local)
    if (next === local) return offset

    const target = rowOffsetForLocalIndex(row, next, 'after')
    if (target !== offset) return target
    local = next
  }

  return offset
}

function rowUnitOffset(
  row: MountedVirtualizedTextRow,
  offset: number,
  direction: 'backward' | 'forward',
): number {
  if (direction === 'backward') return previousRowUnitOffset(row, offset)
  return nextRowUnitOffset(row, offset)
}

function unitEdgeDistance(
  rect: { readonly left: number; readonly width: number },
  x: number,
): number {
  return Math.min(Math.abs(rect.left - x), Math.abs(rect.left + rect.width - x))
}

function calculatedUnitRect(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
): { readonly left: number; readonly width: number } | null {
  const local = rowLocalIndexForOffset(row, offset)
  if (local < 0 || local >= row.text.length) return null

  const end = rowOffsetForLocalIndex(row, local + 1)
  if (end <= offset) return null

  const left = offsetToX(view, row, offset)
  const right = offsetToX(view, row, end)
  return { left: Math.min(left, right), width: Math.abs(right - left) }
}

export function rangeSegments(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  start: number,
  end: number,
): readonly GeometryRangeSegment[] {
  if (row.kind !== 'text') return []
  if (row.source === 'injected') return []
  if (end <= start) return []

  const segments: GeometryRangeSegment[] = []
  for (const chunk of row.chunks) {
    appendRangeSegmentForChunk(segments, view, row, chunk, start, end)
  }

  return mergeGeometryRangeSegments(segments)
}

function estimatedDisplayCells(content: string | MeasuredText, tabSize: number): number {
  const text = typeof content === 'string' ? content : content.text
  if (typeof content !== 'string' && content.measurements)
    return content.measurements.columnAt(text.length, tabSize, 'estimated')
  const simpleCells = simpleDisplayCellsOrNull(text, 0, text.length, 0, tabSize)
  if (simpleCells !== null) return simpleCells
  return estimatedDisplayCellsFrom(text, 0, text.length, 0, tabSize).cells
}

export function estimatedDisplayCellForColumn(
  content: string | MeasuredText,
  column: number,
  tabSize: number,
): number {
  if (typeof content !== 'string' && content.measurements)
    return content.measurements.columnAt(column, tabSize, 'estimated')
  const text = typeof content === 'string' ? content : content.text
  const end = clamp(column, 0, text.length)
  const simpleCells = simpleDisplayCellsOrNull(text, 0, end, 0, tabSize)
  if (simpleCells !== null) return simpleCells

  return estimatedDisplayCellsFrom(text, 0, end, 0, tabSize).cells
}

export function estimatedColumnToBufferColumn(
  content: string | MeasuredText,
  visualColumn: number,
  bias: TransformBias,
  tabSize: number,
): number {
  if (typeof content !== 'string' && content.measurements)
    return content.measurements.offsetAt(visualColumn, bias, tabSize, 'estimated')
  const text = typeof content === 'string' ? content : content.text
  if (isSimpleRowText(text)) return visualColumnToBufferColumn(content, visualColumn, bias, tabSize)

  const target = Math.max(0, visualColumn)
  let visual = 0
  let index = 0
  while (index < text.length) {
    const step = estimatedStep(text, index, visual, tabSize)
    const column = columnForVisualTarget(
      index,
      index + step.length,
      visual,
      visual + step.cells,
      target,
      bias,
    )
    if (column !== null) return column
    visual += step.cells
    index += step.length
  }

  return text.length
}

function estimatedRowWidth(
  text: string | MeasuredText,
  tabSize: number,
  cellWidth: number,
): number {
  return estimatedDisplayCells(text, tabSize) * cellWidth
}

export function createDomRangeForChunkRange(
  document: Document,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): Range | null {
  const boundaries = domBoundariesForChunkRange(row, chunk, start, end)
  if (!boundaries) return null

  const range = document.createRange()
  range.setStart(boundaries.start.node, boundaries.start.offset)
  range.setEnd(boundaries.end.node, boundaries.end.offset)
  return range
}

export function createStaticRangeForChunkRange(
  document: Document,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): StaticRange | null {
  const boundaries = domBoundariesForChunkRange(row, chunk, start, end)
  const StaticRangeConstructor = document.defaultView?.StaticRange
  if (!boundaries || !StaticRangeConstructor) return null

  return new StaticRangeConstructor({
    endContainer: boundaries.end.node,
    endOffset: boundaries.end.offset,
    startContainer: boundaries.start.node,
    startOffset: boundaries.start.offset,
  })
}

function domBoundariesForChunkRange(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): { readonly start: DomBoundary; readonly end: DomBoundary } | null {
  if (end <= start) return null
  if (end <= chunk.startOffset || start >= chunk.endOffset) return null

  const localStart = clampChunkLocal(chunk, rowLocalIndexForOffset(row, start, 'before'))
  const localEnd = clampChunkLocal(chunk, rowLocalIndexForOffset(row, end, 'after'))
  const startBoundary = domBoundaryForChunkLocalOffset(chunk, localStart)
  const endBoundary = domBoundaryForChunkLocalOffset(chunk, localEnd)
  if (!startBoundary || !endBoundary) return null

  return { end: endBoundary, start: startBoundary }
}

export function domBoundaryForOffset(
  row: MountedVirtualizedTextRow,
  offset: number,
): DomBoundary | null {
  const local = clamp(rowLocalIndexForOffset(row, offset), 0, row.text.length)
  const chunk = chunkForLocalOffset(row, local)
  if (!chunk) return null
  return domBoundaryForChunkLocalOffset(chunk, local)
}

function domBoundariesForGeometryIndex(
  row: MountedVirtualizedTextRow,
  plan: MeasuredRowPlan,
  geometryIndex: number,
  offset: number,
): readonly DomBoundary[] {
  const local = clamp(rowLocalIndexForOffset(row, offset), 0, row.text.length)
  const boundaries: DomBoundary[] = []
  const writer = plan.writerUnit[geometryIndex] ?? -1
  for (let unitIndex = writer - 1; unitIndex <= writer + 1; unitIndex += 1) {
    appendUnitDomBoundariesAtLocal(boundaries, plan.units[unitIndex], local)
  }
  if (boundaries.length > 0) return boundaries

  appendDomBoundary(boundaries, domBoundaryForOffset(row, offset))
  return boundaries
}

function appendUnitDomBoundariesAtLocal(
  boundaries: DomBoundary[],
  unit: MeasuredUnit | undefined,
  local: number,
): void {
  if (!unit) return
  if (unit.localStart === local) appendDomBoundary(boundaries, measuredUnitBoundary(unit, 'before'))
  if (unit.localEnd === local) appendDomBoundary(boundaries, measuredUnitBoundary(unit, 'after'))
}

function measuredUnitBoundary(unit: MeasuredUnit, side: 'before' | 'after'): DomBoundary | null {
  if (unit.node) {
    const offset = unit.nodeOffset + (side === 'after' ? unit.nodeLength : 0)
    return { node: unit.node, offset }
  }
  if (!unit.element) return null
  return elementBoundary(unit.element, side)
}

function appendDomBoundary(boundaries: DomBoundary[], candidate: DomBoundary | null): void {
  if (!candidate) return
  const duplicate = boundaries.some(
    (boundary) => boundary.node === candidate.node && boundary.offset === candidate.offset,
  )
  if (!duplicate) boundaries.push(candidate)
}

export function offsetFromDomBoundary(
  row: MountedVirtualizedTextRow,
  node: Node,
  offset: number,
): number | null {
  const textOffset = offsetFromTextPartBoundary(row, node, offset)
  if (textOffset !== null) return textOffset

  const controlOffset = offsetFromControlPartBoundary(row, node, offset)
  if (controlOffset !== null) return controlOffset

  const widgetOffset = offsetFromInlineWidgetBoundary(row, node, offset)
  if (widgetOffset !== null) return widgetOffset

  return offsetFromElementBoundary(row, node, offset)
}

/**
 * A replacement stands for its whole source span, so a boundary the browser found somewhere in the
 * rendered node — a double-click reaching into an image's alt text, a drag that ended over it —
 * resolves to an edge of the span rather than to whatever the row ends in.
 */
function offsetFromInlineWidgetBoundary(
  row: MountedVirtualizedTextRow,
  node: Node,
  offset: number,
): number | null {
  const part = inlineWidgetPartForNode(row, node)
  if (!part) return null
  if (node === part.element && offset > 0) return rowOffsetForLocalIndex(row, part.localEnd)

  return rowOffsetForLocalIndex(row, part.localStart)
}

function inlineWidgetPartForNode(
  row: MountedVirtualizedTextRow,
  node: Node,
): Extract<VirtualizedTextChunkPart, { readonly kind: 'widget' }> | null {
  for (const chunk of row.chunks) {
    const part = chunk.parts.find((candidate) => {
      if (candidate.kind !== 'widget') return false
      return candidate.element === node || candidate.element.contains(node)
    })
    if (part?.kind === 'widget') return part
  }

  return null
}

function ensureRowGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometry {
  const cached = cachedRowGeometry(view, row)
  if (cached) return cached

  const key = rowGeometryCacheKey(view, row)
  const geometry = buildRowGeometry(view, row)
  ;(row as MutableRowGeometryCache).geometryCache = { key, geometry }
  return geometry
}

function cachedRowGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometry | null {
  const key = rowGeometryCacheKey(view, row)
  const cached = row.geometryCache as RowGeometryCache | null
  return cached?.key === key ? cached.geometry : null
}

function rowGeometryCacheKey(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): string {
  return [
    row.textRevision,
    // Display text and source spans can stay equal while a fresh inline projection changes the
    // rendered glyphs or turns a row into an endpoint-only refusal placeholder.
    view.displayProjectionRevision,
    row.chunkKey,
    // Pins the key to a line: a row's element and its record are both recycled onto whatever line
    // scrolls into their place, and every other part of this key survives that move intact.
    row.startOffset,
    row.text.length,
    row.foldMarkerKey,
    row.rowDecorationKey,
    // Inline-kind classes restyle the row's font, so measured boundaries die with them.
    row.inlineKindsClassName,
    // A replacement that settles on its real size moves every column after it, and the row's own
    // text is unchanged when it does — nothing else in this key notices.
    inlineWidgetWidthRevision,
    view.tabSize,
    view.metrics.characterWidth,
  ].join(':')
}

function buildRowGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometry {
  const path = rowGeometryPath(view, row)
  recordEditorPerformanceDiagnostic('view.rowGeometry', () => ({
    path,
    length: row.text.length,
  }))
  if (path === 'calculated') return buildCalculatedRowGeometry(view, row)
  return buildMeasuredRowGeometry(view, row)
}

function rowUsesCalculatedGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): boolean {
  return rowGeometryPath(view, row) === 'calculated'
}

/**
 * Calculated geometry multiplies the global character width, which assumes every row renders in the
 * editor's base font. Rows with inline replacements can be restyled per replacement kind — a
 * markdown heading row is bold and larger — so their advance widths only exist in the DOM.
 */
function rowGeometryPath(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometryPath {
  if (row.inlineMapping) return 'inline-mapping'
  if (!isSimpleRowText(row)) return 'non-simple-text'
  if (!view.monospace) return 'proportional-font'
  // CSS tab stops can disagree with the estimated cell grid after a horizontal spacer.
  const hasTabs =
    row.measurements?.hasTabs ?? (typeof row.text === 'string' && row.text.includes('\t'))
  return hasTabs ? 'tab' : 'calculated'
}

function buildCalculatedRowGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometry {
  const boundaries = createBoundaryBuffer(row)
  const anchors: number[] = []
  // Read whether or not this row will re-anchor on anything: the boundaries below are written in
  // the row's own space either way, and the inverse mapping reads them back in it.
  const scale = rowClientRectScale(row)
  const measurement = row.text.length > KEY_COLUMN_DISTANCE ? { row, scale } : null
  const cellWidth = cellWidthInRowSpace(view, scale)
  for (const chunk of row.chunks) {
    appendCalculatedChunkBoundaries(boundaries, view, row, chunk, cellWidth, measurement, anchors)
  }

  return geometryFromBoundaries(row, boundaries, calculatedRowWidth(view, row), anchors)
}

function calculatedRowWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): number {
  const columns = bufferColumnToVisualColumn(row, row.text.length, view.tabSize)
  return columns * view.metrics.characterWidth
}

function calculatedXToOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
  scale?: number,
): number {
  const anchor = calculatedRowAnchorForX(view, row, x)
  // Undoing the anchor's own offset costs a few bits, so a column's exact left edge can come back a
  // hair under the whole number it was built from and fall into the cell before it. The tolerance
  // is orders of magnitude below a pixel, so it can only reclaim that.
  const cells =
    (x - anchor.x) / Math.max(1, cellWidthInRowSpace(view, scale ?? rowClientRectScale(row))) +
    COLUMN_EPSILON
  // Each anchor speaks only for its own columns. Re-anchoring on a measured
  // advance leaves a gap wherever the measured position and the extrapolated
  // one disagree, and an x inside that gap extrapolates past the span into
  // columns the next anchor owns — a click landing a character or two right of
  // where the caret is drawn, and not even monotonically.
  const visualColumn = clamp(anchor.column + Math.floor(cells), anchor.column, anchor.lastColumn)
  const local = visualColumnToBufferColumn(row, visualColumn, 'nearest', view.tabSize)
  return rowOffsetForLocalIndex(row, clampLocalOffsetToMountedChunks(row, local))
}

type CalculatedRowAnchor = {
  readonly x: number
  readonly column: number
  readonly lastColumn: number
}

function calculatedRowAnchorForX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
): CalculatedRowAnchor {
  const lastColumn = bufferColumnToVisualColumn(row, row.text.length, view.tabSize)
  const base = { x: 0, column: 0, lastColumn }
  if (row.text.length <= KEY_COLUMN_DISTANCE) return base

  const anchors = ensureRowGeometry(view, row).anchors
  if (!anchors) return base

  let anchor = base
  for (let index = 0; index + 1 < anchors.length; index += 2) {
    const anchorX = anchors[index]!
    const anchorColumn = anchors[index + 1]!
    if (anchorX > x) return { ...anchor, lastColumn: Math.max(anchor.column, anchorColumn - 1) }

    anchor = { x: anchorX, column: anchorColumn, lastColumn }
  }

  return anchor
}

// The measured advances an anchor is built from are read back in the row's own
// space, so the estimate they are extended with has to be too: metrics are
// probed through the host, which may scale everything it contains.
function cellWidthInRowSpace(view: VirtualizedTextViewInternal, scale: number): number {
  return view.metrics.characterWidth / scale
}

const clampChunkLocal = (chunk: VirtualizedTextChunk, local: number): number =>
  clamp(local, chunk.localStart, chunk.localEnd)

function clampLocalOffsetToMountedChunks(
  row: MountedVirtualizedTextRow,
  localOffset: number,
): number {
  const first = row.chunks[0]
  const last = row.chunks.at(-1)
  if (!first || !last) return clamp(localOffset, 0, row.text.length)
  return clamp(localOffset, first.localStart, last.localEnd)
}

function appendCalculatedChunkBoundaries(
  boundaries: BoundaryBuffer,
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  cellWidth: number,
  measurement: RowMeasurementContext | null,
  anchors: number[],
): void {
  // Column zero is the anchor an unanchored row extrapolates from, so a row that measures nothing
  // keeps the plain multiplication it had.
  let anchorColumn = 0
  let anchorX = 0
  let nextAnchorLocal = chunk.localStart

  let column = bufferColumnToVisualColumn(row, chunk.localStart, view.tabSize)
  for (let local = chunk.localStart; local <= chunk.localEnd; local += 1) {
    if (measurement && local >= nextAnchorLocal) {
      nextAnchorLocal = local + KEY_COLUMN_DISTANCE
      const measured = keyColumnX(measurement, chunk, local)
      if (measured !== null) {
        anchorColumn = column
        anchorX = measured
        anchors.push(measured, column)
      }
    }

    appendBoundary(
      boundaries,
      rowOffsetForLocalIndex(row, local),
      anchorX + (column - anchorColumn) * cellWidth,
    )
    column += row.text.charCodeAt(local) === 9 ? view.tabSize - (column % view.tabSize) : 1
  }
}

/**
 * Null when nothing in the chunk renders `local` as text — a control glyph stands there, or the
 * column belongs to a chunk that is not mounted. There is no advance to re-anchor on, so the caller
 * keeps extending the anchor it already has.
 */
function keyColumnX(
  measurement: RowMeasurementContext,
  chunk: VirtualizedTextChunk,
  local: number,
): number | null {
  for (const part of chunk.parts) {
    if (part.kind !== 'text') continue
    if (local < part.localStart || local >= part.localEnd) continue

    return measuredTextSegmentRect(measurement, part.node, local - part.localStart, 1)?.left ?? null
  }

  return null
}

/**
 * Lays the row out in units without reading a single advance. Everything expensive is deferred to
 * `boundaryX`, which reads the one unit the asked-for boundary stands on — a caret on a paragraph
 * row costs one segment rect instead of one per grapheme in the paragraph.
 */
function buildMeasuredRowGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): RowGeometry {
  const buffer = createPlanBuffer(row)
  const units: MeasuredUnit[] = []
  for (const chunk of row.chunks) appendChunkPlan(buffer, units, view, row, chunk)
  if (buffer.length === 0) appendPlanBoundary(buffer, row.startOffset, -1, LOGICAL_START, 0)
  const mightContainRTL = rowMightContainRTL(view, row)

  const plan: MeasuredRowPlan = {
    view,
    row,
    baseDirection: mightContainRTL ? measuredRowBaseDirection(row) : 'ltr',
    units,
    lefts: new Float64Array(units.length).fill(UNREAD),
    widths: new Float64Array(units.length).fill(UNREAD),
    writerUnit: buffer.writerUnit.subarray(0, buffer.length),
    writerSide: buffer.writerSide.subarray(0, buffer.length),
    writerX: buffer.writerX.subarray(0, buffer.length),
    mightContainRTL,
    measurement: null,
    bidiFormattingStates: null,
    bidiUnitDirections: Array.from({ length: units.length }),
    backwardDirectionalCarriers: new Int32Array(units.length).fill(UNREAD_DIRECTIONAL_CARRIER),
    forwardDirectionalCarriers: new Int32Array(units.length).fill(UNREAD_DIRECTIONAL_CARRIER),
  }

  return {
    offsets: buffer.offsets.subarray(0, buffer.length),
    xs: new Float64Array(buffer.length).fill(UNREAD),
    plan,
    unitPlan: plan,
    xOrder: null,
    width: UNREAD,
    anchors: null,
    bidiRuns: undefined,
  }
}

function estimatedRowContentWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): number {
  return estimatedRowWidth(row, view.tabSize, view.metrics.characterWidth)
}

function appendChunkPlan(
  buffer: PlanBuffer,
  units: MeasuredUnit[],
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
): void {
  const chunkX = estimatedPrefixWidth(view, row, chunk.localStart)
  appendPlanBoundary(
    buffer,
    rowOffsetForLocalIndex(row, chunk.localStart),
    -1,
    LOGICAL_START,
    chunkX,
  )

  let previous = -1
  for (const part of chunk.parts) {
    previous = appendPartPlan(buffer, units, row, part, previous, chunkX)
  }

  // A chunk that rendered nothing still ends where it began; one that rendered something ends where
  // its last unit does, which is the same edge that unit already wrote.
  appendPlanBoundary(
    buffer,
    rowOffsetForLocalIndex(row, chunk.localEnd),
    previous,
    LOGICAL_END,
    chunkX,
  )
}

function appendPartPlan(
  buffer: PlanBuffer,
  units: MeasuredUnit[],
  row: MountedVirtualizedTextRow,
  part: VirtualizedTextChunkPart,
  previous: number,
  chunkX: number,
): number {
  if (part.kind === 'text') {
    let last = previous
    for (const segment of segmentGraphemes(part.node.data)) {
      last = appendUnitPlan(buffer, units, row, textUnit(part, segment, last, chunkX))
    }

    return last
  }

  if (part.kind === 'control') {
    return appendUnitPlan(buffer, units, row, {
      kind: 'control',
      node: null,
      nodeOffset: 0,
      nodeLength: 0,
      element: part.element,
      widthCells: part.widthCells,
      localStart: part.localStart,
      localEnd: part.localEnd,
      previous,
      chunkX,
    })
  }

  return appendUnitPlan(buffer, units, row, {
    kind: 'widget',
    node: null,
    nodeOffset: 0,
    nodeLength: 0,
    element: part.element,
    widthCells: 0,
    localStart: part.localStart,
    localEnd: part.localEnd,
    previous,
    chunkX,
  })
}

function textUnit(
  part: VirtualizedTextChunkTextPart,
  segment: TextSegment,
  previous: number,
  chunkX: number,
): MeasuredUnit {
  const localStart = part.localStart + segment.index
  return {
    kind: 'text',
    node: part.node,
    nodeOffset: segment.index,
    nodeLength: segment.segment.length,
    element: null,
    widthCells: 0,
    localStart,
    localEnd: localStart + segment.segment.length,
    previous,
    chunkX,
  }
}

function appendUnitPlan(
  buffer: PlanBuffer,
  units: MeasuredUnit[],
  row: MountedVirtualizedTextRow,
  unit: MeasuredUnit,
): number {
  const index = units.length
  units.push(unit)
  appendPlanBoundary(
    buffer,
    rowOffsetForLocalIndex(row, unit.localStart),
    index,
    LOGICAL_START,
    UNREAD,
  )
  appendPlanBoundary(buffer, rowOffsetForLocalIndex(row, unit.localEnd), index, LOGICAL_END, UNREAD)
  return index
}

/** Sized once against the same bound `createBoundaryBuffer` is, and appended to the same way. */
function createPlanBuffer(row: MountedVirtualizedTextRow): PlanBuffer {
  const capacity = mountedBoundaryCapacity(row)
  return {
    offsets: new Float64Array(capacity),
    writerUnit: new Int32Array(capacity),
    writerSide: new Uint8Array(capacity),
    writerX: new Float64Array(capacity),
    length: 0,
  }
}

/**
 * Where two units meet, the later unit addresses the boundary from the character that starts there.
 * This is observable at a text-node seam inside a BiDi run: the end of the earlier node and the
 * start of the later one are the same logical offset but can be different legitimate visual edges.
 */
function appendPlanBoundary(
  buffer: PlanBuffer,
  offset: number,
  unit: number,
  side: number,
  x: number,
): void {
  const last = buffer.length - 1
  const at = last >= 0 && buffer.offsets[last] === offset ? last : buffer.length
  buffer.offsets[at] = offset
  buffer.writerUnit[at] = unit
  buffer.writerSide[at] = side
  buffer.writerX[at] = x
  if (at === buffer.length) buffer.length += 1
}

function boundaryX(geometry: RowGeometry, index: number): number {
  const cached = geometry.xs[index]
  if (cached === undefined) return 0
  if (!Number.isNaN(cached)) return cached

  const plan = geometry.plan
  if (!plan) return 0

  if (plan.mightContainRTL) {
    const browserX = browserBoundaryX(plan, geometry.offsets[index]!, index)
    geometry.xs[index] = browserX
    return browserX
  }

  const unit = plan.writerUnit[index]!
  const x =
    unit < 0
      ? plan.writerX[index]!
      : resolvedUnitLogicalEdge(plan, unit, plan.writerSide[index] === LOGICAL_END)
  geometry.xs[index] = x
  return x
}

function resolvedUnitLogicalEdge(plan: MeasuredRowPlan, unit: number, logicalEnd: boolean): number {
  resolveUnit(plan, unit)
  const left = plan.lefts[unit]!
  return logicalEnd ? left + plan.widths[unit]! : left
}

function browserBoundaryX(plan: MeasuredRowPlan, offset: number, index: number): number {
  const boundary = domBoundaryForOffset(plan.row, offset)
  const xs = boundary ? collapsedBoundaryXs(planMeasurement(plan), boundary) : []
  if (xs.length > 0) return Math.min(...xs)
  return zeroRectBoundaryX(plan, index, offset)
}

function collapsedBoundaryXs(
  measurement: RowMeasurementContext,
  boundary: DomBoundary,
): readonly number[] {
  const scratch = measurementScratchFor(
    boundary.node.ownerDocument ?? measurement.row.element.ownerDocument,
  )
  scratch.range.setStart(boundary.node, boundary.offset)
  scratch.range.collapse(true)
  const xs = Array.from(
    scratch.range.getClientRects(),
    (rect) => rowLocalRect(measurement, rect).left,
  )
  scratch.range.selectNodeContents(scratch.parking)
  return xs
}

function collapsedBoundaryPositionXs(
  measurement: RowMeasurementContext,
  boundaries: readonly DomBoundary[],
): readonly number[] {
  const positions: number[] = []
  for (const boundary of boundaries) {
    appendDistinctBoundaryPositions(positions, collapsedBoundaryXs(measurement, boundary))
  }
  return positions.toSorted((left, right) => left - right)
}

function appendDistinctBoundaryPositions(positions: number[], candidates: readonly number[]): void {
  for (const candidate of candidates) appendDistinctBoundaryPosition(positions, candidate)
}

function appendDistinctBoundaryPosition(positions: number[], candidate: number): void {
  if (positions.some((position) => Math.abs(position - candidate) <= BIDI_BOUNDARY_EPSILON)) return
  positions.push(candidate)
}

/**
 * Chromium exposes both visual caret positions at a logical BiDi boundary from one collapsed Range.
 * Gecko and WebKit expose only one. A non-empty grapheme Range is consistent across those engines,
 * so recover the missing position from the logical edge of the units on either side. Ordinary
 * boundaries still collapse to one position because both units resolve to the same direction.
 */
function recoveredBidiBoundaryPositionXs(
  plan: MeasuredRowPlan | null,
  geometryIndex: number,
  offset: number,
  collapsedXs: readonly number[],
): readonly number[] {
  if (!plan?.mightContainRTL || collapsedXs.length !== 1) return collapsedXs
  if (engineSupportsDualCollapsedBidiPositions(plan.row.element.ownerDocument)) return collapsedXs

  const local = rowLocalIndexForOffset(plan.row, offset)
  const precedingIndex = unitIndexAtBoundarySide(plan, geometryIndex, local, 'preceding')
  const followingIndex = unitIndexAtBoundarySide(plan, geometryIndex, local, 'following')
  if (precedingIndex === null || followingIndex === null) return collapsedXs
  if (plan.units[precedingIndex]!.kind === 'widget') return collapsedXs
  if (plan.units[followingIndex]!.kind === 'widget') return collapsedXs

  const preceding = directionalBoundaryUnit(plan, precedingIndex, 'preceding')
  const following = directionalBoundaryUnit(plan, followingIndex, 'following')
  if (!preceding || !following) return collapsedXs

  const positions: number[] = []
  appendDirectionalBoundaryEdge(positions, plan, preceding)
  appendDirectionalBoundaryEdge(positions, plan, following)
  if (positions.length === 0) return collapsedXs
  if (recoveredEdgesShareSeam(preceding, following, positions)) {
    return recoveredSameDirectionSeamXs(positions, collapsedXs)
  }
  return positions.toSorted((left, right) => left - right)
}

function recoveredEdgesShareSeam(
  preceding: DirectionalBoundaryUnit,
  following: DirectionalBoundaryUnit,
  positions: readonly number[],
): boolean {
  if (preceding.direction !== following.direction || positions.length !== 2) return false
  return Math.abs(positions[0]! - positions[1]!) <= BIDI_RECOVERED_SEAM_EPSILON
}

function recoveredSameDirectionSeamXs(
  derived: readonly number[],
  collapsed: readonly number[],
): readonly number[] {
  const raw = collapsed[0]!
  const rawMatches = derived.some(
    (candidate) => Math.abs(candidate - raw) <= BIDI_RECOVERED_SEAM_EPSILON,
  )
  return rawMatches ? collapsed : [derived[0]!]
}

function engineSupportsDualCollapsedBidiPositions(document: Document): boolean {
  const getClientRects = document.defaultView?.Range.prototype.getClientRects
  const cached = dualCollapsedBidiPositionSupport.get(document)
  if (cached && cached.getClientRects === getClientRects) return cached.supported

  const parent = document.body ?? document.documentElement
  if (!parent) return true

  const probe = document.createElement('span')
  const node = document.createTextNode('aאb')
  probe.style.cssText =
    'position:absolute;left:-10000px;top:-10000px;visibility:hidden;white-space:pre;direction:ltr'
  probe.append(node)
  parent.append(probe)

  const range = document.createRange()
  range.setStart(node, 1)
  range.collapse(true)
  const supported = range.getClientRects().length >= 2
  probe.remove()
  dualCollapsedBidiPositionSupport.set(document, { getClientRects, supported })
  return supported
}

function measuredRowBaseDirection(row: MountedVirtualizedTextRow): MeasuredUnitDirection {
  const window = row.element.ownerDocument.defaultView
  if (!window) return 'ltr'
  return window.getComputedStyle(row.element).direction === 'rtl' ? 'rtl' : 'ltr'
}

function directionalBoundaryUnit(
  plan: MeasuredRowPlan,
  immediate: number,
  side: 'preceding' | 'following',
): DirectionalBoundaryUnit | null {
  const direction = measuredUnitDirection(plan, immediate)
  if (!direction) return null

  const immediateUnit = plan.units[immediate]!
  const control = bidiDirectionalControlKind(plan.row, immediateUnit)
  const step = directionalCarrierStep(control, side)
  const unitIndex = directionalEdgeCarrierIndex(plan, immediate, step, direction)
  if (unitIndex === null) return null

  const logicalEdge = directionalCarrierLogicalEdge(control, side)
  return { direction, logicalEdge, unitIndex }
}

function directionalCarrierStep(
  control: BidiDirectionalControlKind,
  side: 'preceding' | 'following',
): -1 | 1 {
  if (control === 'isolate-opener') return -1
  if (control !== 'none') return 1
  return side === 'preceding' ? -1 : 1
}

function directionalCarrierLogicalEdge(
  control: BidiDirectionalControlKind,
  side: 'preceding' | 'following',
): 'start' | 'end' {
  if (control === 'isolate-opener') return 'end'
  if (control !== 'none') return 'start'
  return side === 'preceding' ? 'end' : 'start'
}

function unitIndexAtBoundarySide(
  plan: MeasuredRowPlan,
  geometryIndex: number,
  local: number,
  side: 'preceding' | 'following',
): number | null {
  const writer = plan.writerUnit[geometryIndex] ?? -1
  for (let unitIndex = writer - 1; unitIndex <= writer + 1; unitIndex += 1) {
    const unit = plan.units[unitIndex]
    if (!unit) continue
    if (side === 'preceding' && unit.localEnd === local) return unitIndex
    if (side === 'following' && unit.localStart === local) return unitIndex
  }
  return null
}

function directionalEdgeCarrierIndex(
  plan: MeasuredRowPlan,
  start: number,
  step: -1 | 1,
  direction: MeasuredUnitDirection,
): number | null {
  if (measuredUnitDirection(plan, start) !== direction) return null

  const carriers = step === -1 ? plan.backwardDirectionalCarriers : plan.forwardDirectionalCarriers
  const cached = carriers[start]!
  if (cached !== UNREAD_DIRECTIONAL_CARRIER) {
    return cached === NO_DIRECTIONAL_CARRIER ? null : cached
  }

  return resolveDirectionalCarrier(plan, start, step, direction, carriers)
}

function resolveDirectionalCarrier(
  plan: MeasuredRowPlan,
  start: number,
  step: -1 | 1,
  direction: MeasuredUnitDirection,
  carriers: Int32Array,
): number | null {
  const visited: number[] = []
  let result = NO_DIRECTIONAL_CARRIER
  for (let unitIndex = start; unitIndex >= 0 && unitIndex < plan.units.length; unitIndex += step) {
    if (measuredUnitDirection(plan, unitIndex) !== direction) break

    const cached = carriers[unitIndex]!
    if (cached !== UNREAD_DIRECTIONAL_CARRIER) {
      result = cached
      break
    }

    visited.push(unitIndex)
    if (!directionalUnitRect(plan, unitIndex)) continue
    result = unitIndex
    break
  }
  for (const unitIndex of visited) carriers[unitIndex] = result
  return result === NO_DIRECTIONAL_CARRIER ? null : result
}

function appendDirectionalBoundaryEdge(
  positions: number[],
  plan: MeasuredRowPlan,
  unit: DirectionalBoundaryUnit,
): void {
  const rect = directionalUnitRect(plan, unit.unitIndex)
  if (!rect) return

  const logicalEnd = unit.logicalEdge === 'end'
  const physicalRight = logicalEnd === (unit.direction === 'ltr')
  appendDistinctBoundaryPosition(positions, physicalRight ? rect.right : rect.left)
}

function measuredUnitDirection(
  plan: MeasuredRowPlan,
  unitIndex: number,
): MeasuredUnitDirection | null {
  const cached = plan.bidiUnitDirections[unitIndex]
  if (cached !== undefined) return cached

  const direction = resolveMeasuredUnitDirection(plan, unitIndex)
  plan.bidiUnitDirections[unitIndex] = direction
  return direction
}

function resolveMeasuredUnitDirection(
  plan: MeasuredRowPlan,
  unitIndex: number,
): MeasuredUnitDirection | null {
  const unit = plan.units[unitIndex]
  if (!unit) return null

  const formatting = bidiFormattingStateForUnit(plan, unitIndex)
  const control = bidiDirectionalControlKind(plan.row, unit)
  const formatted = control === 'none' ? formatting.override : formatting.direction
  const intrinsic = formatted ?? intrinsicMeasuredUnitDirection(plan.row, unit)
  const topology = measuredUnitTopologyDirection(plan, unitIndex)
  if (!intrinsic && !topology) return formatting.direction
  if (!topology || topology === intrinsic) return intrinsic ?? topology
  if (!intrinsic) return topology
  if (hasTopologyPeerWithDirection(plan, unitIndex, topology, intrinsic)) return topology
  return intrinsic
}

function bidiFormattingStateForUnit(plan: MeasuredRowPlan, unitIndex: number): BidiFormattingState {
  const states = plan.bidiFormattingStates ?? buildBidiFormattingStates(plan)
  plan.bidiFormattingStates = states
  return states[unitIndex] ?? baseBidiFormattingState(plan)
}

function buildBidiFormattingStates(plan: MeasuredRowPlan): readonly BidiFormattingState[] {
  const stack: BidiFormattingState[] = []
  const isolateIndexes: number[] = []
  const states: BidiFormattingState[] = []
  const fsiDirections = buildFsiDirections(plan)
  for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex += 1) {
    appendBidiFormattingState(states, stack, isolateIndexes, plan, fsiDirections, unitIndex)
  }
  return states
}

function appendBidiFormattingState(
  states: BidiFormattingState[],
  stack: BidiFormattingState[],
  isolateIndexes: number[],
  plan: MeasuredRowPlan,
  fsiDirections: readonly (MeasuredUnitDirection | null)[],
  unitIndex: number,
): void {
  const unit = plan.units[unitIndex]!
  const codePoint = measuredUnitCodePoint(plan.row, unit)
  if (codePoint === 0x202c) popBidiEmbedding(stack)
  if (codePoint === 0x2069) popBidiIsolate(stack, isolateIndexes)

  const outer = stack.at(-1) ?? baseBidiFormattingState(plan)
  const opener = bidiFormattingOpener(plan, fsiDirections, unitIndex, codePoint)
  const current = opener?.kind === 'embedding' ? opener : outer
  states.push(current)
  if (!opener) return
  if (opener.kind === 'isolate') isolateIndexes.push(stack.length)
  stack.push(opener)
}

function baseBidiFormattingState(plan: MeasuredRowPlan): BidiFormattingState {
  return { kind: 'embedding', direction: plan.baseDirection, override: null }
}

function bidiFormattingOpener(
  plan: MeasuredRowPlan,
  fsiDirections: readonly (MeasuredUnitDirection | null)[],
  unitIndex: number,
  codePoint: number | undefined,
): BidiFormattingState | null {
  if (codePoint === 0x202a) return { kind: 'embedding', direction: 'ltr', override: null }
  if (codePoint === 0x202b) return { kind: 'embedding', direction: 'rtl', override: null }
  if (codePoint === 0x202d) return { kind: 'embedding', direction: 'ltr', override: 'ltr' }
  if (codePoint === 0x202e) return { kind: 'embedding', direction: 'rtl', override: 'rtl' }
  if (codePoint === 0x2066) return { kind: 'isolate', direction: 'ltr', override: null }
  if (codePoint === 0x2067) return { kind: 'isolate', direction: 'rtl', override: null }
  if (codePoint !== 0x2068) return null

  const direction = fsiDirections[unitIndex] ?? plan.baseDirection
  return { kind: 'isolate', direction, override: null }
}

function buildFsiDirections(plan: MeasuredRowPlan): readonly (MeasuredUnitDirection | null)[] {
  const directions: (MeasuredUnitDirection | null)[] = Array.from(
    { length: plan.units.length },
    () => null,
  )
  const isolates: (number | null)[] = []
  for (let unitIndex = 0; unitIndex < plan.units.length; unitIndex += 1) {
    const unit = plan.units[unitIndex]!
    const codePoint = measuredUnitCodePoint(plan.row, unit)
    if (codePoint === 0x2069) {
      isolates.pop()
      continue
    }
    if (codePoint === 0x2066 || codePoint === 0x2067 || codePoint === 0x2068) {
      isolates.push(codePoint === 0x2068 ? unitIndex : null)
      continue
    }

    const fsiIndex = isolates.at(-1)
    if (fsiIndex === undefined || fsiIndex === null || directions[fsiIndex]) continue
    directions[fsiIndex] = directStrongDirection(codePoint)
  }
  return directions
}

function directStrongDirection(codePoint: number | undefined): MeasuredUnitDirection | null {
  if (codePoint === undefined) return null
  const character = String.fromCodePoint(codePoint)
  if (RTL_BIDI_CHARACTER.test(character)) return 'rtl'
  if (codePoint === 0x200e || /\p{Letter}/u.test(character)) return 'ltr'
  return null
}

function measuredUnitCodePoint(
  row: MountedVirtualizedTextRow,
  unit: MeasuredUnit,
): number | undefined {
  if (unit.kind !== 'text') return undefined
  return row.text.codePointAt(unit.localStart)
}

function popBidiEmbedding(stack: BidiFormattingState[]): void {
  if (stack.at(-1)?.kind === 'embedding') stack.pop()
}

function popBidiIsolate(stack: BidiFormattingState[], isolateIndexes: number[]): void {
  const index = isolateIndexes.pop()
  if (index !== undefined) stack.length = index
}

function bidiDirectionalControlKind(
  row: MountedVirtualizedTextRow,
  unit: MeasuredUnit,
): BidiDirectionalControlKind {
  const codePoint = measuredUnitCodePoint(row, unit)
  if (codePoint === 0x202c || codePoint === 0x2069) return 'closer'
  if (codePoint === 0x2066 || codePoint === 0x2067 || codePoint === 0x2068) {
    return 'isolate-opener'
  }
  if (codePoint === 0x202a || codePoint === 0x202b) return 'embedding-opener'
  if (codePoint === 0x202d || codePoint === 0x202e) return 'embedding-opener'
  return 'none'
}

function measuredUnitTopologyDirection(
  plan: MeasuredRowPlan,
  unitIndex: number,
): MeasuredUnitDirection | null {
  const previous = topologyDirectionBetweenUnits(plan, unitIndex - 1, unitIndex)
  const following = topologyDirectionBetweenUnits(plan, unitIndex, unitIndex + 1)
  if (!previous) return following
  if (!following || following === previous) return previous
  return null
}

function hasTopologyPeerWithDirection(
  plan: MeasuredRowPlan,
  unitIndex: number,
  topology: MeasuredUnitDirection,
  intrinsic: MeasuredUnitDirection,
): boolean {
  return (
    isTopologyPeerWithDirection(plan, unitIndex, unitIndex - 1, topology, intrinsic) ||
    isTopologyPeerWithDirection(plan, unitIndex, unitIndex + 1, topology, intrinsic)
  )
}

function isTopologyPeerWithDirection(
  plan: MeasuredRowPlan,
  unitIndex: number,
  peerIndex: number,
  topology: MeasuredUnitDirection,
  intrinsic: MeasuredUnitDirection,
): boolean {
  const leftIndex = Math.min(unitIndex, peerIndex)
  const rightIndex = Math.max(unitIndex, peerIndex)
  if (topologyDirectionBetweenUnits(plan, leftIndex, rightIndex) !== topology) return false
  if (peerIndex < 0 || peerIndex >= plan.units.length) return false
  return intrinsicMeasuredUnitDirection(plan.row, plan.units[peerIndex]!) === intrinsic
}

function topologyDirectionBetweenUnits(
  plan: MeasuredRowPlan,
  leftIndex: number,
  rightIndex: number,
): MeasuredUnitDirection | null {
  const left = directionalUnitRect(plan, leftIndex)
  const right = directionalUnitRect(plan, rightIndex)
  if (!left || !right) return null

  const ltrDistance = Math.abs(left.right - right.left)
  const rtlDistance = Math.abs(right.right - left.left)
  const closest = Math.min(ltrDistance, rtlDistance)
  if (closest > BIDI_BOUNDARY_EPSILON * 2) return null
  if (Math.abs(ltrDistance - rtlDistance) <= BIDI_BOUNDARY_EPSILON) return null
  return ltrDistance < rtlDistance ? 'ltr' : 'rtl'
}

function directionalUnitRect(
  plan: MeasuredRowPlan,
  unitIndex: number,
): { readonly left: number; readonly right: number } | null {
  const unit = plan.units[unitIndex]
  if (!unit || isBidiControlAtLocalIndex(plan.row, unit.localStart)) return null

  const elementRect =
    unit.kind === 'widget' && unit.element
      ? measuredElementRect(planMeasurement(plan), unit.element)
      : null
  if (elementRect) return { left: elementRect.left, right: elementRect.left + elementRect.width }

  resolveUnit(plan, unitIndex)
  const left = plan.lefts[unitIndex]!
  const width = plan.widths[unitIndex]!
  if (!Number.isFinite(left) || width <= BIDI_BOUNDARY_EPSILON) return null
  return { left, right: left + width }
}

function intrinsicMeasuredUnitDirection(
  row: MountedVirtualizedTextRow,
  unit: MeasuredUnit,
): MeasuredUnitDirection | null {
  if (unit.kind !== 'text') return null

  const text = row.text.slice(unit.localStart, unit.localEnd)
  if (RTL_BIDI_CHARACTER.test(text)) return 'rtl'
  if (/[\p{Letter}\p{Number}]/u.test(text)) return 'ltr'
  return bidiControlDirection(text.codePointAt(0))
}

function bidiControlDirection(codePoint: number | undefined): MeasuredUnitDirection | null {
  if (codePoint === 0x061c || codePoint === 0x200f) return 'rtl'
  if (codePoint === 0x202b || codePoint === 0x202e || codePoint === 0x2067) return 'rtl'
  if (codePoint === 0x200e || codePoint === 0x202a) return 'ltr'
  if (codePoint === 0x202d || codePoint === 0x2066) return 'ltr'
  return null
}

function zeroRectBoundaryX(plan: MeasuredRowPlan, index: number, offset: number): number {
  const local = rowLocalIndexForOffset(plan.row, offset)
  const preceding = adjacentTextBoundary(plan, index, local, 'preceding')
  if (preceding !== null) return preceding

  const following = adjacentTextBoundary(plan, index, local, 'following')
  if (following !== null) return following

  const unitIndex = plan.writerUnit[index]!
  const unit = unitIndex >= 0 ? plan.units[unitIndex] : null
  const measured = unit?.element ? measuredElementRect(planMeasurement(plan), unit.element) : null
  if (measured)
    return plan.writerSide[index] === LOGICAL_END ? measured.left + measured.width : measured.left
  return plan.writerX[index] ?? 0
}

function adjacentTextBoundary(
  plan: MeasuredRowPlan,
  geometryIndex: number,
  local: number,
  side: 'preceding' | 'following',
): number | null {
  const writer = plan.writerUnit[geometryIndex] ?? -1
  for (let unitIndex = writer - 1; unitIndex <= writer + 1; unitIndex += 1) {
    const unit = plan.units[unitIndex]
    if (!isAdjacentTextUnit(unit, local, side)) continue
    return collapsedTextBoundaryX(plan, unit, side)
  }
  return null
}

function isAdjacentTextUnit(
  unit: MeasuredUnit | undefined,
  local: number,
  side: 'preceding' | 'following',
): unit is MeasuredUnit & { readonly node: Text } {
  if (unit?.kind !== 'text' || !unit.node) return false
  return side === 'preceding' ? unit.localEnd === local : unit.localStart === local
}

function collapsedTextBoundaryX(
  plan: MeasuredRowPlan,
  unit: MeasuredUnit & { readonly node: Text },
  side: 'preceding' | 'following',
): number | null {
  const offset = side === 'preceding' ? unit.nodeOffset + unit.nodeLength : unit.nodeOffset
  const xs = collapsedBoundaryXs(planMeasurement(plan), { node: unit.node, offset })
  return xs.length > 0 ? Math.min(...xs) : null
}

/**
 * A measured advance stands at an absolute position in the row, so almost every unit answers from
 * its own rect alone. Only the ones with no rect to read — a replacement, whose drawn width is a
 * property of the mounted node rather than of the span it covers, or a segment the engine reports
 * empty — stand after whatever precedes them, and those walk backwards until something does.
 */
function resolveUnit(plan: MeasuredRowPlan, index: number): void {
  if (!Number.isNaN(plan.lefts[index]!)) return

  const placed: number[] = []
  let current = index
  while (current >= 0 && Number.isNaN(plan.lefts[current]!)) {
    const measured = measuredUnitRect(plan, plan.units[current]!)
    if (measured) {
      plan.lefts[current] = measured.left
      plan.widths[current] = measured.width
      break
    }

    placed.push(current)
    current = plan.units[current]!.previous
  }

  for (let at = placed.length - 1; at >= 0; at -= 1) {
    const unitIndex = placed[at]!
    const unit = plan.units[unitIndex]!
    plan.lefts[unitIndex] =
      unit.previous >= 0 ? plan.lefts[unit.previous]! + plan.widths[unit.previous]! : unit.chunkX
    plan.widths[unitIndex] = estimatedUnitWidth(plan, unit)
  }
}

function measuredUnitRect(
  plan: MeasuredRowPlan,
  unit: MeasuredUnit,
): { readonly left: number; readonly width: number } | null {
  if (unit.kind === 'widget') return null
  if (unit.kind === 'control') return measuredElementRect(planMeasurement(plan), unit.element!)
  return measuredTextSegmentRect(
    planMeasurement(plan),
    unit.node!,
    unit.nodeOffset,
    unit.nodeLength,
  )
}

/**
 * What a unit advances by when it has no rect of its own. A rendered replacement is the interesting
 * one: the columns it covers say nothing about how wide it draws, so its advance is the width the
 * mount observed — one rect per resize rather than one per read, and a width even while the row is
 * off-screen. Until something has measured it at all, the placeholder text's own width stands in.
 */
function estimatedUnitWidth(plan: MeasuredRowPlan, unit: MeasuredUnit): number {
  const { view, row } = plan
  if (unit.kind === 'control') return unit.widthCells * view.metrics.characterWidth

  const estimated = estimatedLocalRangeWidth(view, row, unit.localStart, unit.localEnd)
  if (unit.kind !== 'widget') return estimated
  return inlineWidgetWidths.get(unit.element!) ?? estimated
}

/**
 * Sampled at the first advance the row is asked for rather than when the plan is laid out, so a row
 * nobody measures into never reads a layout box at all. The factor is a ratio of two boxes and so
 * survives the row being scrolled, which is the only thing that moves it without retiring the plan.
 */
function planMeasurement(plan: MeasuredRowPlan): RowMeasurementContext {
  const current = plan.measurement
  if (current) return current

  const measurement = { row: plan.row, scale: rowClientRectScale(plan.row) }
  plan.measurement = measurement
  return measurement
}

/**
 * Reading a row's every boundary is what the plan exists to avoid, so this is only for the two
 * questions that genuinely need the whole row: which offset an x falls on, and how wide the row
 * draws. Both search across boundaries rather than at one, and neither can bound where it looks.
 */
function resolveRowGeometry(geometry: RowGeometry): RowGeometry {
  const plan = geometry.plan
  if (!plan) return geometry

  rowGeometrySweepCount += 1
  recordEditorPerformanceDiagnostic('view.rowGeometry.sweep', () => ({
    boundaries: geometry.offsets.length,
  }))

  const { offsets, xs } = geometry
  let ascending = true
  for (let index = 0; index < xs.length; index += 1) {
    const x = boundaryX(geometry, index)
    if (index > 0 && x < xs[index - 1]!) ascending = false
  }

  geometry.plan = null
  geometry.xOrder = ascending ? null : boundaryOrderByX(offsets, xs)
  geometry.width = measureRowContentWidth(plan.view, plan.row)
  return geometry
}

// Text parts contribute at most one boundary per UTF-16 unit plus their end.
// Widgets and gaps between chunks contribute endpoints without allocating for offscreen text.
function mountedBoundaryCapacity(row: MountedVirtualizedTextRow): number {
  let capacity = 1
  for (const chunk of row.chunks) {
    capacity += 2
    for (const part of chunk.parts) {
      capacity += part.kind === 'text' ? part.node.length + 1 : 2
    }
  }
  return capacity
}

function createBoundaryBuffer(row: MountedVirtualizedTextRow): BoundaryBuffer {
  const capacity = mountedBoundaryCapacity(row)
  return { offsets: new Float64Array(capacity), xs: new Float64Array(capacity), length: 0 }
}

function appendBoundary(boundaries: BoundaryBuffer, offset: number, x: number): void {
  const last = boundaries.length - 1
  if (last >= 0 && boundaries.offsets[last] === offset) {
    boundaries.xs[last] = x
    return
  }

  boundaries.offsets[boundaries.length] = offset
  boundaries.xs[boundaries.length] = x
  boundaries.length += 1
}

function geometryFromBoundaries(
  row: MountedVirtualizedTextRow,
  boundaries: BoundaryBuffer,
  fallbackWidth: number,
  anchors: readonly number[] | null,
): RowGeometry {
  if (boundaries.length === 0) appendBoundary(boundaries, row.startOffset, 0)

  const offsets = boundaries.offsets.subarray(0, boundaries.length)
  const xs = boundaries.xs.subarray(0, boundaries.length)
  let contentRight = 0
  let ascending = true
  for (let index = 0; index < xs.length; index += 1) {
    const x = xs[index]!
    if (x > contentRight) contentRight = x
    if (index > 0 && x < xs[index - 1]!) ascending = false
  }

  return {
    offsets,
    xs,
    plan: null,
    unitPlan: null,
    xOrder: ascending ? null : boundaryOrderByX(offsets, xs),
    width: Math.max(fallbackWidth, contentRight),
    anchors: anchors && anchors.length > 0 ? Float64Array.from(anchors) : null,
    bidiRuns: null,
  }
}

function boundaryOrderByX(offsets: Float64Array, xs: Float64Array): Uint32Array {
  const order = new Uint32Array(offsets.length)
  for (let index = 0; index < order.length; index += 1) order[index] = index
  return order.sort((left, right) => xs[left]! - xs[right]! || offsets[left]! - offsets[right]!)
}

function appendRangeSegmentForChunk(
  segments: GeometryRangeSegment[],
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): void {
  if (end <= chunk.startOffset || start >= chunk.endOffset) return

  const range = createDomRangeForChunkRange(row.element.ownerDocument, row, chunk, start, end)
  if (!range) return

  const measurement = { row, scale: rowClientRectScale(row) }
  const rects = range.getClientRects()
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index)
    if (!rect) continue
    segments.push(rowLocalRect(measurement, rect))
  }
  if (rects.length === 0) appendUnmeasuredRangeSegment(segments, view, row, chunk, start, end)
}

/**
 * A mounted browser row answers non-empty ranges, including an invisible bidi control, with at
 * least one client rect. DOM-only test environments answer with an empty list for every range;
 * retaining the old boundary box there keeps non-geometry tests meaningful without hiding any
 * real-browser result behind arithmetic.
 */
function appendUnmeasuredRangeSegment(
  segments: GeometryRangeSegment[],
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): void {
  const segmentStart = Math.max(start, chunk.startOffset)
  const segmentEnd = Math.min(end, chunk.endOffset)
  const startX = offsetToX(view, row, segmentStart)
  const endX = offsetToX(view, row, segmentEnd)
  segments.push({
    left: Math.min(startX, endX),
    width: Math.abs(endX - startX),
  })
}

function mergeGeometryRangeSegments(
  segments: readonly GeometryRangeSegment[],
): readonly GeometryRangeSegment[] {
  const sorted = segments.toSorted(
    (left, right) => left.left - right.left || left.width - right.width,
  )
  const merged: GeometryRangeSegment[] = []
  for (const segment of sorted) appendMergedGeometrySegment(merged, segment)
  return merged
}

function appendMergedGeometrySegment(
  merged: GeometryRangeSegment[],
  segment: GeometryRangeSegment,
): void {
  const previous = merged.at(-1)
  if (!previous || segment.left > previous.left + previous.width + RANGE_RECT_MERGE_EPSILON) {
    merged.push(segment)
    return
  }

  const right = Math.max(previous.left + previous.width, segment.left + segment.width)
  merged[merged.length - 1] = { left: previous.left, width: right - previous.left }
}

function xForOffset(geometry: RowGeometry, offset: number): number {
  const { offsets } = geometry
  const index = firstBoundaryAtOrAfterOffset(offsets, offset)
  if (offsets[index] === offset) return boundaryX(geometry, index)
  return boundaryX(geometry, clamp(index, 0, offsets.length - 1))
}

function firstBoundaryAtOrAfterOffset(offsets: Float64Array, offset: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle]! >= offset) {
      high = middle
      continue
    }

    low = middle + 1
  }

  return low
}

function offsetForX(lazy: RowGeometry, x: number): number {
  const geometry = resolveRowGeometry(lazy)
  const { offsets, xs, xOrder } = geometry
  const first = boundaryAtXRank(xOrder, 0)
  const last = boundaryAtXRank(xOrder, offsets.length - 1)
  if (x <= xs[first]!) return offsets[first]!
  if (x >= xs[last]!) return offsets[last]!

  const rank = firstBoundaryAtOrAfterX(xs, xOrder, x)
  const previous = boundaryAtXRank(xOrder, rank - 1)
  const next = boundaryAtXRank(xOrder, rank)
  if (x - xs[previous]! <= xs[next]! - x) return offsets[previous]!
  return offsets[next]!
}

const boundaryAtXRank = (xOrder: Uint32Array | null, rank: number): number =>
  xOrder ? xOrder[Math.max(0, rank)]! : Math.max(0, rank)

function firstBoundaryAtOrAfterX(xs: Float64Array, xOrder: Uint32Array | null, x: number): number {
  let low = 0
  let high = xs.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (xs[boundaryAtXRank(xOrder, middle)]! >= x) {
      high = middle
      continue
    }

    low = middle + 1
  }

  return low
}

function measuredTextSegmentRect(
  measurement: RowMeasurementContext,
  node: Text,
  start: number,
  length: number,
): { readonly left: number; readonly width: number } | null {
  if (length <= 0) return null

  const scratch = measurementScratchFor(node.ownerDocument)
  scratch.range.setStart(node, start)
  scratch.range.setEnd(node, start + length)
  const measured = measuredRangeRect(measurement, scratch.range)
  scratch.range.selectNodeContents(scratch.parking)
  return measured
}

function measuredRowContentsRect(
  measurement: RowMeasurementContext,
): { readonly left: number; readonly width: number } | null {
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  for (const chunk of measurement.row.chunks) {
    const measured = measuredChunkContentsRect(measurement, chunk)
    if (!measured) continue

    left = Math.min(left, measured.left)
    right = Math.max(right, measured.left + measured.width)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null

  return { left, width: Math.max(0, right - left) }
}

/**
 * One union rect per text chunk. Selecting the row element itself would also select its absolute
 * selection/hidden-character layers and trailing fold placeholder, making paint state part of the
 * source text's extent.
 */
function measuredChunkContentsRect(
  measurement: RowMeasurementContext,
  chunk: VirtualizedTextChunk,
): { readonly left: number; readonly width: number } | null {
  const first = chunk.parts[0]
  const last = chunk.parts.at(-1)
  if (!first || !last) return null

  const scratch = measurementScratchFor(measurement.row.element.ownerDocument)
  scratch.range.setStartBefore(renderedPartNode(first))
  scratch.range.setEndAfter(renderedPartNode(last))
  const rect = scratch.range.getBoundingClientRect()
  scratch.range.selectNodeContents(scratch.parking)
  if (rect.width <= 0) return null

  return rowLocalRect(measurement, rect)
}

function renderedPartNode(part: VirtualizedTextChunkPart): Node {
  if (part.kind === 'text') return part.node
  return part.element
}

function measurementScratchFor(document: Document): MeasurementScratch {
  const current = measurementScratch
  if (current?.document === document) return current

  const scratch = {
    document,
    range: document.createRange(),
    parking: document.createTextNode(''),
  }
  measurementScratch = scratch
  return scratch
}

function measuredRangeRect(
  measurement: RowMeasurementContext,
  range: Range,
): { readonly left: number; readonly width: number } | null {
  const rect = firstRangeRect(range)
  if (!rect || rect.width <= 0) return null

  return rowLocalRect(measurement, rect)
}

function measuredElementRect(
  measurement: RowMeasurementContext,
  element: HTMLElement,
): { readonly left: number; readonly width: number } | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) return null

  return rowLocalRect(measurement, rect)
}

function rowLocalRect(
  measurement: RowMeasurementContext,
  rect: DOMRect,
): { readonly left: number; readonly width: number } {
  const left = rect.left - measuredRowRect(measurement.row).left
  return { left: left / measurement.scale, width: rect.width / measurement.scale }
}

/**
 * Client rects arrive in the host's own space, so a row rendered under a CSS transform reports
 * advances the transform has already scaled — while the caret translations and selection rects they
 * feed are written back in the row's untransformed space. `offsetWidth` is the same box before the
 * transform, so the two together recover the factor and take measurements back to where they are
 * consumed.
 *
 * `offsetWidth` is rounded to whole pixels though, so a ratio small enough to be explained by that
 * rounding is noise, not a transform: dividing by it would bend every measured x on a host that has
 * no transform at all.
 */
function rowClientRectScale(row: MountedVirtualizedTextRow): number {
  const cached = measuredRowScales?.get(row.element)
  if (cached !== undefined) return cached

  const scale = readRowClientRectScale(row)
  measuredRowScales?.set(row.element, scale)
  return scale
}

function readRowClientRectScale(row: MountedVirtualizedTextRow): number {
  const layoutWidth = row.element.offsetWidth
  return normalizedRowClientRectScale(measuredRowRect(row).width, layoutWidth)
}

function normalizedRowClientRectScale(clientWidth: number, layoutWidth: number): number {
  if (layoutWidth <= 0) return 1

  const scale = clientWidth / layoutWidth
  if (!Number.isFinite(scale) || scale <= 0) return 1
  if (Math.abs(scale - 1) * layoutWidth <= 1) return 1
  return scale
}

/**
 * A measured row asks for its own rect once per grapheme and once per control
 * glyph, because that rect is the origin every part of the row is measured
 * against — the same layout read, repeated for the length of the row. Between
 * `beginRowRectMeasurements` and `endRowRectMeasurements` it is read once per
 * row instead, on the caller's promise that it reports anything moving a row —
 * a write to row DOM, a scroll — through `invalidateRowRectMeasurements`.
 * Outside that window nothing is remembered, so a caller that cannot make the
 * promise simply does not open one.
 */
export function beginRowRectMeasurements(): void {
  rowRectMeasurementDepth += 1
  measuredRowRects ??= new Map()
  measuredRowScales ??= new Map()
}

export function invalidateRowRectMeasurements(): void {
  measuredRowRects?.clear()
  measuredRowScales?.clear()
}

export function endRowRectMeasurements(): void {
  rowRectMeasurementDepth = Math.max(0, rowRectMeasurementDepth - 1)
  if (rowRectMeasurementDepth > 0) return

  measuredRowRects = null
  measuredRowScales = null
}

function measuredRowRect(row: MountedVirtualizedTextRow): DOMRect {
  const cached = measuredRowRects?.get(row.element)
  if (cached) return cached

  const rect = row.element.getBoundingClientRect()
  measuredRowRects?.set(row.element, rect)
  return rect
}

function firstRangeRect(range: Range): DOMRect | null {
  const rects = range.getClientRects()
  const first = rects.item(0)
  if (first) return first

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

function estimatedPrefixWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  localOffset: number,
): number {
  const firstStart = row.chunks[0]?.localStart
  if (firstStart !== undefined && localOffset >= firstStart) {
    return row.leftSpacerWidth + estimatedLocalRangeWidth(view, row, firstStart, localOffset)
  }
  return estimatedLocalRangeWidth(view, row, 0, localOffset)
}

function estimatedLocalRangeWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  localStart: number,
  localEnd: number,
): number {
  const start = estimatedDisplayCellForColumn(row, localStart, view.tabSize)
  const end = estimatedDisplayCellForColumn(row, localEnd, view.tabSize)
  return Math.max(0, end - start) * view.metrics.characterWidth
}

function isSimpleRowCodeUnit(code: number): boolean {
  if (code === 9) return true
  return code >= 32 && code <= 126
}

function appendTextPart(
  document: Document,
  parts: VirtualizedTextChunkPart[],
  nodes: Node[],
  localStart: number,
  text: string,
): void {
  if (text.length === 0) return

  const node = document.createTextNode(text)
  nodes.push(node)
  parts.push({
    kind: 'text',
    localStart,
    localEnd: localStart + text.length,
    node,
  })
}

function appendTextParts(
  document: Document,
  parts: VirtualizedTextChunkPart[],
  nodes: Node[],
  localStart: number,
  text: string,
  maxTextNodeLength: number,
): boolean {
  if (text.length === 0) return true
  if (text.length <= maxTextNodeLength) {
    appendTextPart(document, parts, nodes, localStart, text)
    return true
  }
  if (hasOnlyStandaloneGraphemes(text)) {
    appendFixedLengthTextParts(document, parts, nodes, localStart, text, maxTextNodeLength)
    return true
  }

  let sliceStart = 0
  for (const segment of segmentGraphemes(text)) {
    if (segment.segment.length > maxTextNodeLength) return false

    const segmentEnd = segment.index + segment.segment.length
    if (segmentEnd - sliceStart <= maxTextNodeLength) continue
    appendTextPart(
      document,
      parts,
      nodes,
      localStart + sliceStart,
      text.slice(sliceStart, segment.index),
    )
    sliceStart = segment.index
  }
  appendTextPart(document, parts, nodes, localStart + sliceStart, text.slice(sliceStart))
  return true
}

function hasOnlyStandaloneGraphemes(text: TextContent): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (!isStandaloneGraphemeCodeUnit(text.charCodeAt(index))) return false
  }
  return true
}

/**
 * This intentionally narrow whitelist covers the editor's common Latin/Hebrew BiDi rows. Every
 * accepted UTF-16 unit is independently a grapheme; marks, joiners, surrogates, Jamo, and other
 * scripts stay on the complete Unicode segmenter path below.
 */
function isStandaloneGraphemeCodeUnit(code: number): boolean {
  if (code === 9 || (code >= 32 && code <= 126)) return true
  if (code === 0x05be || code === 0x05c0 || code === 0x05c3 || code === 0x05c6) return true
  return code >= 0x05d0 && code <= 0x05f4
}

function appendFixedLengthTextParts(
  document: Document,
  parts: VirtualizedTextChunkPart[],
  nodes: Node[],
  localStart: number,
  text: string,
  maxTextNodeLength: number,
): void {
  for (let start = 0; start < text.length; start += maxTextNodeLength) {
    appendTextPart(
      document,
      parts,
      nodes,
      localStart + start,
      text.slice(start, start + maxTextNodeLength),
    )
  }
}

function appendControlPart(
  document: Document,
  parts: VirtualizedTextChunkPart[],
  nodes: Node[],
  localStart: number,
  control: ControlCharacterInfo,
  cellWidth: number,
): void {
  const element = document.createElement('span')
  element.className = CONTROL_CHARACTER_CLASS
  element.dataset.editorControlCharacter = control.key
  element.style.width = `${control.widthCells * cellWidth}px`
  element.textContent = control.label
  nodes.push(element)
  parts.push({
    kind: 'control',
    localStart,
    localEnd: localStart + 1,
    element,
    widthCells: control.widthCells,
  })
}

function firstTextNode(parts: readonly VirtualizedTextChunkPart[]): Text | null {
  const part = parts.find((candidate) => candidate.kind === 'text')
  return part?.kind === 'text' ? part.node : null
}

function estimatedDisplayCellsFrom(
  text: TextContent,
  start: number,
  end: number,
  initialCells: number,
  tabSize: number,
): { readonly cells: number; readonly index: number } {
  let cells = initialCells
  let index = start
  while (index < end) {
    const step = estimatedStep(text, index, cells, tabSize)
    cells += step.cells
    index += step.length
  }

  return { cells, index }
}

function simpleDisplayCellsOrNull(
  text: TextContent,
  start: number,
  end: number,
  initialCells: number,
  tabSize: number,
): number | null {
  let cells = initialCells
  for (let index = start; index < end; index += 1) {
    const code = text.charCodeAt(index)
    if (!isSimpleRowCodeUnit(code)) return null
    cells += code === 9 ? tabSize - (cells % tabSize) : 1
  }

  return cells
}

function estimatedStep(
  text: TextContent,
  index: number,
  visualCell: number,
  tabSize: number,
): { readonly cells: number; readonly length: number } {
  const codePoint = text.codePointAt(index) ?? 0
  if (codePoint === 9) {
    return { cells: tabSize - (visualCell % tabSize), length: 1 }
  }

  return { cells: estimatedCodePointWidth(codePoint), length: codePointLength(text, index) }
}

function columnForVisualTarget(
  startIndex: number,
  endIndex: number,
  visual: number,
  next: number,
  target: number,
  bias: TransformBias,
): number | null {
  if (target < visual || target > next) return null
  if (target === visual) return startIndex
  if (target === next) return endIndex
  if (bias === 'before') return startIndex
  if (bias === 'after') return endIndex
  return target - visual <= next - target ? startIndex : endIndex
}

function chunkForLocalOffset(
  row: MountedVirtualizedTextRow,
  local: number,
): VirtualizedTextChunk | null {
  for (const chunk of row.chunks) {
    if (local < chunk.localStart || local > chunk.localEnd) continue
    return chunk
  }

  return null
}

function domBoundaryForChunkLocalOffset(
  chunk: VirtualizedTextChunk,
  local: number,
): DomBoundary | null {
  for (const part of chunk.parts) {
    if (part.localStart !== local) continue
    return boundaryBeforePart(part)
  }

  for (const part of chunk.parts) {
    if (local <= part.localStart) continue
    const boundary = domBoundaryForPartLocalOffset(part, local)
    if (boundary) return boundary
  }

  return fallbackChunkDomBoundary(chunk, local)
}

function domBoundaryForPartLocalOffset(
  part: VirtualizedTextChunkPart,
  local: number,
): DomBoundary | null {
  if (local < part.localStart || local > part.localEnd) return null
  if (part.kind === 'text') return { node: part.node, offset: local - part.localStart }
  if (local <= part.localStart) return elementBoundary(part.element, 'before')
  return elementBoundary(part.element, 'after')
}

function fallbackChunkDomBoundary(chunk: VirtualizedTextChunk, local: number): DomBoundary | null {
  const first = chunk.parts[0]
  const last = chunk.parts.at(-1)
  if (local <= chunk.localStart && first) return boundaryBeforePart(first)
  if (last) return boundaryAfterPart(last)
  return { node: chunk.textNode, offset: 0 }
}

function boundaryBeforePart(part: VirtualizedTextChunkPart): DomBoundary | null {
  if (part.kind === 'text') return { node: part.node, offset: 0 }
  return elementBoundary(part.element, 'before')
}

function boundaryAfterPart(part: VirtualizedTextChunkPart): DomBoundary | null {
  if (part.kind === 'text') return { node: part.node, offset: part.node.length }
  return elementBoundary(part.element, 'after')
}

function elementBoundary(element: HTMLElement, side: 'before' | 'after'): DomBoundary | null {
  const parent = element.parentNode
  if (!parent) return null

  const offset = childNodeIndex(parent, element) + (side === 'after' ? 1 : 0)
  return { node: parent, offset }
}

function childNodeIndex(parent: Node, child: Node): number {
  return Array.prototype.indexOf.call(parent.childNodes, child) as number
}

function offsetFromTextPartBoundary(
  row: MountedVirtualizedTextRow,
  node: Node,
  offset: number,
): number | null {
  const part = textPartForNode(row, node)
  if (!part) return null

  const local = part.localStart + clamp(offset, 0, part.node.length)
  return rowOffsetForLocalIndex(row, local)
}

function offsetFromControlPartBoundary(
  row: MountedVirtualizedTextRow,
  node: Node,
  offset: number,
): number | null {
  const part = controlPartForNode(row, node)
  if (!part) return null
  if (node === part.element && offset <= 0) return rowOffsetForLocalIndex(row, part.localStart)

  const labelLength = part.element.textContent?.length ?? 0
  if (node !== part.element && offset <= 0) return rowOffsetForLocalIndex(row, part.localStart)
  if (node !== part.element && offset < labelLength / 2)
    return rowOffsetForLocalIndex(row, part.localStart)
  return rowOffsetForLocalIndex(row, part.localEnd)
}

function offsetFromElementBoundary(
  row: MountedVirtualizedTextRow,
  node: Node,
  offset: number,
): number | null {
  if (!(node instanceof HTMLElement)) return null
  if (!row.element.contains(node) && node !== row.element) return null
  if (node === row.element && offset <= 0) return row.startOffset
  if (node === row.element && offset >= node.childNodes.length) return row.endOffset

  const chunk = chunkForElement(row, node)
  if (chunk && offset <= 0) return chunk.startOffset
  if (chunk && offset >= node.childNodes.length) return chunk.endOffset

  const part = partAtElementChildBoundary(row, node, offset)
  if (!part) return row.endOffset
  return rowOffsetForLocalIndex(row, part.localStart)
}

function chunkForElement(
  row: MountedVirtualizedTextRow,
  element: HTMLElement,
): VirtualizedTextChunk | null {
  for (const chunk of row.chunks) {
    if (chunk.element === element) return chunk
  }

  return null
}

function textPartForNode(
  row: MountedVirtualizedTextRow,
  node: Node,
): VirtualizedTextChunkTextPart | null {
  for (const chunk of row.chunks) {
    const part = chunk.parts.find(
      (candidate) => candidate.kind === 'text' && candidate.node === node,
    )
    if (part?.kind === 'text') return part
  }

  return null
}

function controlPartForNode(
  row: MountedVirtualizedTextRow,
  node: Node,
): Extract<VirtualizedTextChunkPart, { readonly kind: 'control' }> | null {
  for (const chunk of row.chunks) {
    const part = chunk.parts.find((candidate) => {
      if (candidate.kind !== 'control') return false
      return candidate.element === node || candidate.element.contains(node)
    })
    if (part?.kind === 'control') return part
  }

  return null
}

function partAtElementChildBoundary(
  row: MountedVirtualizedTextRow,
  element: HTMLElement,
  offset: number,
): VirtualizedTextChunkPart | null {
  if (offset >= element.childNodes.length) return null

  for (let index = Math.max(0, offset); index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index)
    const part = child ? partForNode(row, child) : null
    if (part) return part
  }

  return null
}

function partForNode(row: MountedVirtualizedTextRow, node: Node): VirtualizedTextChunkPart | null {
  for (const chunk of row.chunks) {
    const part = chunk.parts.find((candidate) => partContainsNode(candidate, node))
    if (part) return part
  }

  return null
}

function partContainsNode(part: VirtualizedTextChunkPart, node: Node): boolean {
  if (part.kind === 'text') return part.node === node
  return part.element === node || part.element.contains(node)
}
