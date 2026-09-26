import type { TextContent } from '../textContent'
import type { FoldMap } from '../foldMap'
import type { InlineMap } from '../inlineMap'
import type { RowInlineMapping } from './virtualizedTextViewInlineMapping'
import type { EditorTokenStyle } from '../tokens'
import { clamp } from '../style-utils'
import type { FixedRowVirtualizerOptions, FixedRowVirtualizerSnapshot } from './fixedRowVirtualizer'
import type {
  EditorInputKind,
  EditorInputRoute,
  DocumentWithCaretHitTesting,
  HighlightRegistry,
  MountedVirtualizedTextRow,
  OffsetRange,
  TokenRowSegment,
  VirtualizedFoldMarker,
  VirtualizedTextChunk,
  VirtualizedTextRow,
  VirtualizedTextViewScrollMode,
} from './virtualizedTextViewTypes'
import {
  clearRowGeometryCache,
  createDomRangeForChunkRange,
  createStaticRangeForChunkRange,
} from './virtualizedTextViewGeometry'
import { rowLocalIndexForOffset } from './virtualizedTextViewInlineMapping'

const DEFAULT_ROW_HEIGHT = 24
export const DEFAULT_OVERSCAN = 12
export const DEFAULT_SELECTION_HIGHLIGHT = 'editor-virtualized-selection'
const DEFAULT_LONG_LINE_CHUNK_SIZE = 2048
const DEFAULT_LONG_LINE_CHUNK_THRESHOLD = 4096
const DEFAULT_HORIZONTAL_OVERSCAN_COLUMNS = 256

export function normalizeRowHeight(rowHeight: number): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return DEFAULT_ROW_HEIGHT
  return rowHeight
}

export function normalizeRowGap(rowGap: number | undefined): number {
  if (!Number.isFinite(rowGap) || rowGap === undefined || rowGap < 0) return 0
  return rowGap
}

export function normalizeChunkSize(size: number | undefined): number {
  if (!Number.isFinite(size) || size === undefined || size <= 0) {
    return DEFAULT_LONG_LINE_CHUNK_SIZE
  }

  return Math.floor(size)
}

export function normalizeChunkThreshold(threshold: number | undefined, chunkSize: number): number {
  if (!Number.isFinite(threshold) || threshold === undefined || threshold <= 0) {
    return Math.max(DEFAULT_LONG_LINE_CHUNK_THRESHOLD, chunkSize)
  }

  return Math.max(Math.floor(threshold), chunkSize)
}

export function normalizeHorizontalOverscan(overscan: number | undefined): number {
  if (!Number.isFinite(overscan) || overscan === undefined || overscan < 0) {
    return DEFAULT_HORIZONTAL_OVERSCAN_COLUMNS
  }

  return Math.floor(overscan)
}

export function normalizeScrollMode(
  scrollMode: VirtualizedTextViewScrollMode | undefined,
): VirtualizedTextViewScrollMode {
  if (scrollMode === 'static') return 'static'

  return 'virtualized'
}

export function normalizeFoldMarkers(
  markers: readonly VirtualizedFoldMarker[],
  textLength: number,
): readonly VirtualizedFoldMarker[] {
  return markers
    .filter((marker) => marker.endOffset > marker.startOffset)
    .filter((marker) => marker.endRow > marker.startRow)
    .map((marker) => ({
      ...marker,
      startOffset: clamp(marker.startOffset, 0, textLength),
      endOffset: clamp(marker.endOffset, marker.startOffset, textLength),
    }))
    .toSorted((left, right) => left.startRow - right.startRow || left.endRow - right.endRow)
}

export function indexFoldMarkersByStartRow(
  markers: readonly VirtualizedFoldMarker[],
): ReadonlyMap<number, VirtualizedFoldMarker> {
  const index = new Map<number, VirtualizedFoldMarker>()
  for (const marker of markers) {
    if (index.has(marker.startRow)) continue
    index.set(marker.startRow, marker)
  }

  return index
}

export function indexFoldMarkersByKey(
  markers: readonly VirtualizedFoldMarker[],
): ReadonlyMap<string, VirtualizedFoldMarker> {
  const index = new Map<string, VirtualizedFoldMarker>()
  for (const marker of markers) {
    if (index.has(marker.key)) continue
    index.set(marker.key, marker)
  }

  return index
}

export function hideFoldPlaceholder(element: HTMLSpanElement): void {
  setElementHidden(element, true)
  deleteDatasetValue(element, 'editorFoldPlaceholder')
  if (element.isConnected) element.remove()
}

export function showFoldPlaceholder(element: HTMLSpanElement, key: string): void {
  setElementHidden(element, false)
  setDatasetValue(element, 'editorFoldPlaceholder', key)
}

export function createVirtualizerOptions(
  rowHeight: number,
  overscan: number,
  rowGap?: number,
  scrollMode?: VirtualizedTextViewScrollMode,
  scrollPastEnd = true,
): FixedRowVirtualizerOptions {
  return {
    count: 1,
    rowHeight,
    rowGap: normalizeRowGap(rowGap),
    overscan,
    enabled: true,
    scrollMode: normalizeScrollMode(scrollMode),
    scrollPastEnd,
  }
}

export function snapshotRowsKey(
  snapshot: FixedRowVirtualizerSnapshot,
  horizontalKey: string,
): string {
  const first = snapshot.virtualItems[0]
  const last = snapshot.virtualItems.at(-1)
  return `${snapshot.totalSize}:${first?.index ?? -1}:${last?.index ?? -1}:${snapshot.virtualItems.length}:${horizontalKey}`
}

export function createScrollElement(
  container: HTMLElement,
  className: string | undefined,
): HTMLDivElement {
  const scrollElement = container.ownerDocument.createElement('div')
  scrollElement.className = className ? `editor-virtualized ${className}` : 'editor-virtualized'
  scrollElement.tabIndex = 0
  scrollElement.spellcheck = false
  container.appendChild(scrollElement)
  return scrollElement
}

export function createInputElement(
  container: HTMLElement,
  route: EditorInputRoute,
  label = 'Editor input',
  kind: EditorInputKind = 'code',
): HTMLElement {
  const view = container.ownerDocument.defaultView
  const input =
    route === 'edit-context' && view && 'EditContext' in view
      ? createEditContextInput(container)
      : createTextareaInput(container)
  input.setAttribute('aria-label', label)
  // Attributes rather than properties: the EditContext host is a div, and keyboards read both.
  input.setAttribute('autocapitalize', kind === 'prose' ? 'sentences' : 'off')
  input.setAttribute('autocorrect', kind === 'prose' ? 'on' : 'off')
  return input
}

function createEditContextInput(container: HTMLElement): HTMLDivElement {
  const input = container.ownerDocument.createElement('div')
  input.className = 'editor-virtualized-input'
  input.tabIndex = 0
  input.setAttribute('role', 'textbox')
  input.setAttribute('aria-multiline', 'true')
  input.setAttribute('aria-readonly', 'true')
  return input
}

function createTextareaInput(container: HTMLElement): HTMLTextAreaElement {
  const input = container.ownerDocument.createElement('textarea')
  input.className = 'editor-virtualized-input'
  input.autocomplete = 'off'
  input.readOnly = true
  input.spellcheck = false
  // Said out loud because the element carries a window of the document rather than a line of it: a
  // reader told this is a multi-line text box navigates it by line, which is how code is read.
  input.setAttribute('role', 'textbox')
  input.setAttribute('aria-multiline', 'true')
  // The window is written with the document's own breaks, so a soft wrap the element added would be
  // read as a line the file does not have.
  input.setAttribute('wrap', 'off')
  return input
}

export function foldMarkersEqual(
  left: readonly VirtualizedFoldMarker[],
  right: readonly VirtualizedFoldMarker[],
): boolean {
  if (left === right) return true

  const length = left.length
  if (length !== right.length) return false

  for (let index = 0; index < length; index += 1) {
    if (!foldMarkerEqual(left[index]!, right[index]!)) return false
  }

  return true
}

function foldMarkerEqual(left: VirtualizedFoldMarker, right: VirtualizedFoldMarker): boolean {
  return (
    left.key === right.key &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset &&
    left.startRow === right.startRow &&
    left.endRow === right.endRow &&
    left.collapsed === right.collapsed
  )
}

export function computeLineStarts(text: string): number[] {
  const starts = [0]
  let index = text.indexOf('\n')

  while (index !== -1) {
    starts.push(index + 1)
    index = text.indexOf('\n', index + 1)
  }

  return starts
}

export function rowElementFromNode(node: Node, boundary: HTMLElement): HTMLDivElement | null {
  if (node instanceof HTMLDivElement && node.dataset.editorVirtualRow !== undefined) return node
  if (!(node.parentElement instanceof HTMLElement)) return null

  const element = node.parentElement.closest<HTMLDivElement>('[data-editor-virtual-row]')
  if (!element || !boundary.contains(element)) return null
  return element
}

export function getOrCreateTokenSegments(
  segmentsByRow: Map<number, TokenRowSegment[]>,
  rowSlotId: number,
): TokenRowSegment[] {
  const existing = segmentsByRow.get(rowSlotId)
  if (existing) return existing

  const segments: TokenRowSegment[] = []
  segmentsByRow.set(rowSlotId, segments)
  return segments
}

export type TokenSegmentAppendResult = 'added' | 'merged-adjacent' | 'merged-gap' | 'skipped'

export function appendTokenSegmentForChunk(
  segments: TokenRowSegment[],
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  range: OffsetRange,
  style: EditorTokenStyle,
  styleKey: string,
): TokenSegmentAppendResult {
  if (!rangesIntersect(range.start, range.end, chunk.startOffset, chunk.endOffset)) {
    return 'skipped'
  }

  const start = Math.max(range.start, chunk.startOffset)
  const end = Math.min(range.end, chunk.endOffset)
  if (end <= start) return 'skipped'

  const last = segments.at(-1)
  if (last) {
    const mergeResult = tokenSegmentMergeResult(row, last, chunk, start, style, styleKey)
    if (mergeResult) {
      segments[segments.length - 1] = {
        ...last,
        end: Math.max(last.end, end),
      }
      return mergeResult
    }
  }

  segments.push({
    chunk,
    start,
    end,
    style,
    styleKey,
  })
  return 'added'
}

function tokenSegmentMergeResult(
  row: MountedVirtualizedTextRow,
  segment: TokenRowSegment,
  chunk: VirtualizedTextChunk,
  start: number,
  style: EditorTokenStyle,
  styleKey: string,
): TokenSegmentAppendResult | null {
  if (segment.chunk !== chunk) return null
  if (segment.styleKey !== styleKey) return null
  if (start <= segment.end) return 'merged-adjacent'
  if (!tokenStyleCanCoverWhitespaceGap(style)) return null

  return chunkRangeIsPlainWhitespace(row, chunk, segment.end, start) ? 'merged-gap' : null
}

function tokenStyleCanCoverWhitespaceGap(style: EditorTokenStyle): boolean {
  return !style.backgroundColor && !style.textDecoration
}

function chunkRangeIsPlainWhitespace(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  startOffset: number,
  endOffset: number,
): boolean {
  const localStart = rowLocalIndexForOffset(row, startOffset, 'before') - chunk.localStart
  const localEnd = rowLocalIndexForOffset(row, endOffset, 'after') - chunk.localStart
  if (localEnd <= localStart) return true

  for (let index = localStart; index < localEnd; index += 1) {
    const charCode = chunk.text.charCodeAt(index)
    if (charCode === 32 || charCode === 9) continue
    return false
  }

  return true
}

export function tokenRowSignature(
  row: MountedVirtualizedTextRow,
  segments: readonly TokenRowSegment[],
): string {
  const parts = [tokenRowBaseSignature(row)]
  for (const segment of segments) {
    parts.push(tokenSegmentSignature(segment))
  }

  return parts.join('|')
}

function tokenRowBaseSignature(row: MountedVirtualizedTextRow): string {
  return `${row.chunkKey}:${row.text.length}`
}

function tokenSegmentSignature(segment: TokenRowSegment): string {
  const localStart = segment.start - segment.chunk.startOffset
  const localEnd = segment.end - segment.chunk.startOffset
  return `${segment.styleKey}:${segment.chunk.localStart}:${localStart}:${localEnd}`
}

export function addTokenRangeToChunk(
  document: Document,
  highlight: Highlight,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): AbstractRange | null {
  const range =
    createStaticRangeForChunkRange(document, row, chunk, start, end) ??
    createDomRangeForChunkRange(document, row, chunk, start, end)
  if (!range) return null

  highlight.add(range)
  return range
}

export function appendTokenRange(
  rangesByStyle: Map<string, AbstractRange[]>,
  styleKey: string,
  range: AbstractRange,
): void {
  const ranges = rangesByStyle.get(styleKey)
  if (ranges) {
    ranges.push(range)
    return
  }

  rangesByStyle.set(styleKey, [range])
}

function firstRangeRect(range: Range): DOMRect | null {
  const rects = range.getClientRects()
  const first = rects.item(0)
  if (first) return first

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return rect
}

export function countValidCaretChecks(
  rows: readonly VirtualizedTextRow[],
  failures: string[],
): number {
  let count = 0
  for (const row of rows) {
    const chunk = row.chunks[0]
    if (!chunk) continue
    count += 1
    validateCollapsedRange(chunk, failures)
  }

  return count
}

function validateCollapsedRange(chunk: VirtualizedTextChunk, failures: string[]): void {
  const range = chunk.textNode.ownerDocument.createRange()
  range.setStart(chunk.textNode, 0)
  range.setEnd(chunk.textNode, 0)
  if (range.startContainer !== chunk.textNode) failures.push('caret range escaped row text')
}

export function countValidSelectionChecks(
  rows: readonly VirtualizedTextRow[],
  failures: string[],
): number {
  let count = 0
  for (const row of rows) {
    const chunk = row.chunks.find((candidate) => candidate.textNode.length > 0)
    if (!chunk) continue
    count += 1
    validateSelectionRange(chunk, failures)
  }

  return count
}

function validateSelectionRange(chunk: VirtualizedTextChunk, failures: string[]): void {
  const range = chunk.textNode.ownerDocument.createRange()
  range.setStart(chunk.textNode, 0)
  range.setEnd(chunk.textNode, Math.min(1, chunk.textNode.length))
  if (range.endContainer !== chunk.textNode) failures.push('selection range escaped row text')
}

export function countValidHitTestChecks(
  scrollElement: HTMLElement,
  rows: readonly VirtualizedTextRow[],
  failures: string[],
): number {
  const documentWithCaret = scrollElement.ownerDocument as DocumentWithCaretHitTesting
  const probe = hitTestProbePoint(rows)
  if (!probe) return 0

  const hit = hitTestBoundaryFromPoint(documentWithCaret, probe.x, probe.y)
  if (!hit) return 0
  if (!rows.some((row) => row.element.contains(hit.node))) {
    failures.push('hit test missed mounted rows')
  }
  return 1
}

function hitTestProbePoint(
  rows: readonly VirtualizedTextRow[],
): { readonly x: number; readonly y: number } | null {
  for (const row of rows) {
    const chunk = row.chunks.find((candidate) => candidate.textNode.length > 0)
    const rect = chunk ? rangeRectForChunk(chunk) : null
    if (!rect) continue
    return { x: rect.left + 1, y: rect.top + rect.height / 2 }
  }

  return null
}

function rangeRectForChunk(chunk: VirtualizedTextChunk): DOMRect | null {
  const range = chunk.textNode.ownerDocument.createRange()
  range.setStart(chunk.textNode, 0)
  range.setEnd(chunk.textNode, Math.min(1, chunk.textNode.length))
  return firstRangeRect(range)
}

export function hitTestBoundaryFromPoint(
  documentWithCaret: DocumentWithCaretHitTesting,
  x: number,
  y: number,
): { readonly node: Node; readonly offset: number } | null {
  const position = documentWithCaret.caretPositionFromPoint?.(x, y)
  if (position) return { node: position.offsetNode, offset: position.offset }

  const range = documentWithCaret.caretRangeFromPoint?.(x, y)
  if (!range) return null
  return { node: range.startContainer, offset: range.startOffset }
}

export function updateMutableRow(
  row: MountedVirtualizedTextRow,
  values: {
    readonly index: number
    readonly bufferRow: number
    readonly source: MountedVirtualizedTextRow['source']
    readonly injectedTextRowId?: string
    readonly metadata?: unknown
    readonly startOffset: number
    readonly endOffset: number
    readonly text: TextContent
    readonly measurements?: MountedVirtualizedTextRow['measurements']
    readonly inlineMapping: RowInlineMapping | null
    readonly kind: 'text'
    readonly top: number
    readonly height: number
    readonly textRevision: number
    readonly chunkKey: string
    readonly foldMarkerKey: string
    readonly foldCollapsed: boolean
  },
): void {
  const mutable = row as {
    index: number
    bufferRow: number
    source: MountedVirtualizedTextRow['source']
    injectedTextRowId?: string
    metadata?: unknown
    startOffset: number
    endOffset: number
    text: TextContent
    measurements?: MountedVirtualizedTextRow['measurements']
    inlineMapping: RowInlineMapping | null
    kind: 'text'
    top: number
    height: number
    textRevision: number
    chunkKey: string
    foldMarkerKey: string
    foldCollapsed: boolean
  }
  mutable.index = values.index
  mutable.bufferRow = values.bufferRow
  mutable.source = values.source
  mutable.injectedTextRowId = values.injectedTextRowId
  mutable.metadata = values.metadata
  mutable.startOffset = values.startOffset
  mutable.endOffset = values.endOffset
  mutable.text = values.text
  mutable.measurements = values.measurements
  mutable.inlineMapping = values.inlineMapping
  mutable.kind = values.kind
  mutable.top = values.top
  mutable.height = values.height
  mutable.textRevision = values.textRevision
  mutable.chunkKey = values.chunkKey
  mutable.foldMarkerKey = values.foldMarkerKey
  mutable.foldCollapsed = values.foldCollapsed
  clearRowGeometryCache(row)
}

export function updateMutableRowChunks(
  row: MountedVirtualizedTextRow,
  chunks: readonly VirtualizedTextChunk[],
): void {
  const mutable = row as { chunks: readonly VirtualizedTextChunk[]; textNode: Text }
  mutable.chunks = chunks
  mutable.textNode = chunks[0]?.textNode ?? row.textNode
  clearRowGeometryCache(row)
}

export function retireRowElements(rows: readonly MountedVirtualizedTextRow[]): void {
  for (const row of rows) {
    retireElement(row.element, 'data-editor-virtual-row')
    retireElement(row.gutterElement, 'data-editor-virtual-gutter-row')
    markRowRetired(row)
  }
}

export function restoreRowElements(
  row: MountedVirtualizedTextRow,
  rowParent: HTMLDivElement,
  gutterParent: HTMLDivElement | null,
): void {
  restoreElement(row.element, rowParent)
  if (gutterParent) {
    restoreElement(row.gutterElement, gutterParent)
    return
  }

  row.gutterElement.remove()
}

function retireElement(element: HTMLElement, rowAttribute: string): void {
  element.removeAttribute(rowAttribute)
  element.hidden = true
}

function restoreElement(element: HTMLElement, parent: HTMLDivElement): void {
  if (element.parentNode !== parent) parent.appendChild(element)
  element.hidden = false
}

export function markRowRetired(row: MountedVirtualizedTextRow): void {
  const mutable = row as {
    index: number
    textRevision: number
  }
  mutable.index = -1
  mutable.textRevision = -1
  clearRowGeometryCache(row)
}

type ScrollElementPadding = {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

const scrollElementPaddings = new WeakMap<HTMLElement, ScrollElementPadding>()

// Reading computed style forces a style pass, once per editor open. The view sets the padding
// itself (reserved overlay widths), so it drops the reading whenever it may have changed.
export function scrollElementPadding(element: HTMLElement): ScrollElementPadding {
  const cached = scrollElementPaddings.get(element)
  if (cached) return cached

  const padding = readScrollElementPadding(element)
  scrollElementPaddings.set(element, padding)
  return padding
}

export function invalidateScrollElementPadding(element: HTMLElement): void {
  scrollElementPaddings.delete(element)
}

function readScrollElementPadding(element: HTMLElement): ScrollElementPadding {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return {
    left: parseCssPixels(style?.paddingLeft) ?? 0,
    right: parseCssPixels(style?.paddingRight) ?? 0,
    top: parseCssPixels(style?.paddingTop) ?? 0,
    bottom: parseCssPixels(style?.paddingBottom) ?? 0,
  }
}

export function setElementHidden(element: HTMLElement, hidden: boolean): void {
  if (element.hidden === hidden) return
  element.hidden = hidden
}

/**
 * The host's font goes in as the variables the stylesheet sizes rows with and the editor's popups
 * copy, so a hover opened over the editor reads the same face. Null hands the choice back to CSS.
 * Reports whether the element changed.
 */
export function setFontVariable(
  element: HTMLElement,
  property: '--editor-font-size' | '--editor-font-family',
  value: string | null,
): boolean {
  const current = element.style.getPropertyValue(property)
  if (value === null) {
    if (current === '') return false
    element.style.removeProperty(property)
    return true
  }
  if (current === value) return false
  element.style.setProperty(property, value)
  return true
}

export function fontSizeValue(fontSize: number | undefined): string | null {
  if (fontSize === undefined || !Number.isFinite(fontSize) || fontSize <= 0) return null
  return `${fontSize}px`
}

export function fontFamilyValue(fontFamily: string | undefined): string | null {
  const trimmed = fontFamily?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function setStyleValue(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) === value) return
  element.style.setProperty(property, value)
}

function setDatasetValue(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] === value) return
  element.dataset[key] = value
}

function deleteDatasetValue(element: HTMLElement, key: string): void {
  if (element.dataset[key] === undefined) return
  delete element.dataset[key]
}

function parseCssPixels(value: string | undefined): number | null {
  if (!value) return null

  const pixels = Number.parseFloat(value)
  if (!Number.isFinite(pixels)) return null
  return pixels
}

export function alignChunkStart(value: number, chunkSize: number): number {
  return Math.floor(value / chunkSize) * chunkSize
}

export function alignChunkEnd(value: number, chunkSize: number): number {
  return Math.ceil(value / chunkSize) * chunkSize
}

export function foldMapMatchesText(foldMap: FoldMap | null, textLength: number): boolean {
  if (!foldMap) return false
  return foldMap.snapshot.length === textLength
}

export function inlineMapMatchesText(inlineMap: InlineMap | null, textLength: number): boolean {
  if (!inlineMap) return false
  return inlineMap.snapshot.length === textLength
}

export function getDefaultHighlightRegistry(): HighlightRegistry | null {
  // Firefox can expose CSS.highlights while intermittently painting registered
  // ranges from a stale snapshot; geckoHighlightRepaint.ts re-registers the
  // registry after token range mutations to force a rebuild. See
  // docs/display/browser-quirks.md.
  const css = globalThis.CSS as { highlights?: HighlightRegistry } | undefined
  return css?.highlights ?? null
}

function rangesIntersect(startA: number, endA: number, startB: number, endB: number): boolean {
  return endA > startB && startA < endB
}

export function rangesIntersectInclusive(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return endA >= startB && startA <= endB
}

export function createRowResizeObserver(callback: ResizeObserverCallback): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null

  return new ResizeObserver(callback)
}

// getBoundingClientRect is the laid-out box; scroll size is the fallback for a node the
// browser has not given a rect yet.
export function elementMeasuredSize(container: HTMLElement, dimension: 'height' | 'width'): number {
  const rect = container.getBoundingClientRect()
  const rectSize = dimension === 'height' ? rect.height : rect.width
  if (rectSize > 0) return rectSize

  return dimension === 'height' ? container.scrollHeight : container.scrollWidth
}
