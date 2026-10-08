import { completeRowPresentation, invalidateRowPresentations } from '../rowPresentation'
import { createError } from '../logging/errors'
import { pointViewport } from './pointViewport'
import type { SavedPaint, SavedPaintRow } from '../editor/paintSnapshot'
import type { MeasuredText } from '../textMeasurements'
import { sliceTextContent, type TextContent } from '../textContent'
import { isSimpleRowText } from '../textCharacters'
import {
  isDocumentTextDisplayRow,
  isInjectedTextDisplayRow,
  bufferColumnToVisualColumn,
  visualColumnToBufferColumn,
  visualColumnLength,
  type DisplayInjectedTextRow,
  type DisplayRow,
  type InlineReplacementRender,
  type InlineRow,
} from '../displayTransforms'
import { clamp } from '../style-utils'
import type { InlineMap } from '../inlineMap'
import type { SelectionAffinity } from '../selections'
import type {
  EditorMountedChunkPaintJSON,
  EditorGutterContribution,
  EditorGutterRowContext,
  EditorGutterWidthContext,
} from '../plugins'
import { nextGraphemeBoundary, previousGraphemeBoundary, segmentGraphemes } from '../graphemes'
import type { FixedRowVirtualItem, FixedRowVirtualizerSnapshot } from './fixedRowVirtualizer'
import {
  alignChunkEnd,
  alignChunkStart,
  createRowResizeObserver,
  elementMeasuredSize,
  hideFoldPlaceholder,
  markRowRetired,
  rangesIntersectInclusive,
  restoreRowElements,
  retireRowElements,
  rowElementFromNode,
  setStyleValue,
  showFoldPlaceholder,
  snapshotRowsKey,
  updateMutableRow,
  updateMutableRowChunks,
} from './virtualizedTextViewHelpers'
import {
  bufferRowForOffset,
  bufferRowForVirtualRow,
  getRowHeight,
  lineEndOffset,
  lineStartOffset,
  lineText,
  lineContent,
  rowForCaretPosition,
  rowForOffset,
  rowTop,
  scrollableHeight,
  updateVirtualizerRows,
  visibleLineCount,
} from './virtualizedTextViewLayout'
import type {
  HorizontalChunkWindow,
  MountedVirtualizedTextRow,
  SameLineEditPatch,
  VirtualizedFoldMarker,
  VirtualizedTextChunk,
  VirtualizedTextChunkPart,
  VirtualizedTextRowDecoration,
  VirtualizedTextRenderMode,
  VirtualizedCaretPosition,
  VirtualizedCaretPositions,
} from './virtualizedTextViewTypes'
import type { RevealBlock, VirtualizedTextViewInternal } from './virtualizedTextViewInternals'
import {
  type RowInlineMapping,
  offsetForLocalIndex,
  rowInlineMappingForDisplayRow,
} from './virtualizedTextViewInlineMapping'
import {
  type InlineWidgetPlacement,
  type RenderedChunkParts,
  boundaryPositionXsForAffinity,
  clearRowGeometryCaches,
  createRenderedChunkParts,
  createTextChunkParts,
  domBoundaryForOffset,
  estimatedColumnToBufferColumn,
  estimatedDisplayCellForColumn,
  offsetFromDomBoundary,
  offsetToX,
  setInlineWidgetMeasuredWidth,
} from './virtualizedTextViewGeometry'
import {
  clearHiddenCharactersForRow,
  renderHiddenCharacters,
} from './virtualizedTextViewHiddenCharacters'
import { memoizedContainsRTL } from './virtualizedTextViewBidi'
import type { GlyphAdvances } from './glyphAdvances'
import { columnAtPixels, pixelsBeforeColumn } from './proportionalRows'

const GUTTER_CELL_CLASS = 'editor-virtualized-gutter-cell'
const CURSOR_LINE_ROW_CLASS = 'editor-virtualized-cursor-line-row'
const CURSOR_LINE_GUTTER_CLASS = 'editor-virtualized-cursor-line-gutter'
const CURSOR_LINE_GUTTER_BAND_CLASS = 'editor-virtualized-cursor-line-gutter-band'
const gutterCursorLineStates = new WeakMap<HTMLElement, boolean>()
const gutterCursorLineBandStates = new WeakMap<HTMLElement, boolean>()
const MAX_ROW_TEXT_NODE_LENGTH = 50
const MAX_SINGLE_NODE_ROW_LENGTH = 512
/** Above this, the row shows a fixed endpoint-only placeholder instead of laying out unbounded text. */
export const BIDI_LINE_MEASUREMENT_CEILING = 32_000

type BidiMeasurementRefusal = 'line-length' | 'grapheme-length'
const INLINE_WIDGET_CLASS = 'editor-inline-widget'
const inlineWidgetsByView = new WeakMap<VirtualizedTextViewInternal, InlineWidgets>()
const pendingInlineWidgetRepaints = new WeakMap<VirtualizedTextViewInternal, () => void>()

type RowUpdatePass = {
  readonly cursorBufferRow: number | null
  readonly cursorVirtualRow: number | null
  readonly cursorLineHighlight: VirtualizedTextViewInternal['cursorLineHighlight']
  readonly foldMarkers: ReadonlyMap<number, VirtualizedFoldMarker>
  readonly lineCount: number
  readonly toggleFold: EditorGutterRowContext['toggleFold']
}

type RowUpdateState = EditorGutterRowContext &
  MeasuredText & {
    readonly cursorVirtualLine: boolean
    readonly inlineMapping: RowInlineMapping | null
  }

/** Fills the span an inline replacement renders into; the return value tears that content down. */

type InlineWidgets = {
  readonly hosts: Map<string, InlineWidgetHost>
  /** The map the live ids were last taken from; a different one is what retires a mount. */
  inlineMap: InlineMap | null
}

type InlineWidgetHost = {
  measuredWidth: number | null
  readonly element: HTMLSpanElement
  readonly mountDisposable: { dispose(): void } | null
  readonly observer: ResizeObserver | null
}

type InlineWidgetCleanup = Pick<InlineWidgetHost, 'element' | 'observer'> & {
  readonly release: (() => void) | null
}

type InlineWidgetRun = {
  /** The mount's key: the replacement's `key`, else its id. */
  readonly id: string
  readonly localStart: number
  readonly localEnd: number
  readonly render: InlineReplacementRender
  readonly className?: string
}

/** A run that stays the text it stands for, boxed so it can be styled apart from that text. */
type InlineClassRun = {
  readonly id: string
  readonly localStart: number
  readonly localEnd: number
  readonly className: string
}

type InlineRowRuns = {
  readonly widgets: readonly InlineWidgetRun[]
  readonly classes: readonly InlineClassRun[]
}

const NO_INLINE_ROW_RUNS: InlineRowRuns = { widgets: [], classes: [] }

export function rowsKey(
  view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
): string {
  return snapshotRowsKey(snapshot, horizontalWindowKey(view, snapshot.virtualItems, snapshot))
}

export function renderRows(
  view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
  onRemoveSlot: (rowSlotId: number) => void,
): void {
  if (view.disposed) return
  const updatePass = createRowUpdatePass(view, snapshot.virtualItems)
  if (view.disposed) return
  applyTotalHeight(view, snapshot)
  updateContentWidth(view, snapshot.virtualItems)
  retireInlineWidgets(view)
  if (view.disposed) return
  reconcileRows(view, snapshot.virtualItems, snapshot, updatePass, onRemoveSlot)
  if (view.disposed) return
  renderHiddenCharacters(view)
}

function reconcileRows(
  view: VirtualizedTextViewInternal,
  items: readonly FixedRowVirtualItem[],
  snapshot: FixedRowVirtualizerSnapshot,
  updatePass: RowUpdatePass,
  onRemoveSlot: (rowSlotId: number) => void,
): void {
  const contributions = view.gutterContributions
  const reusableRows = releaseRowsOutside(view, items)
  for (const item of items) {
    mountOrUpdateRow(view, item, reusableRows, snapshot, updatePass)
    if (view.disposed) break
  }

  if (view.disposed) {
    for (const row of reusableRows) disposeUnownedRow(row, contributions)
    return
  }
  removeReusableRows(view, reusableRows, onRemoveSlot)
}

function mountOrUpdateRow(
  view: VirtualizedTextViewInternal,
  item: FixedRowVirtualItem,
  reusableRows: MountedVirtualizedTextRow[],
  snapshot: FixedRowVirtualizerSnapshot,
  updatePass: RowUpdatePass,
): void {
  const existing = view.rowElements.get(item.index)
  if (existing) {
    updateRow(view, existing, item, snapshot, updatePass)
    return
  }

  const row = reusableRows.pop() ?? view.rowPool.pop() ?? createRow(view)
  if (!row) return
  const contributions = view.gutterContributions
  const gutterParent = view.gutterContributions.length > 0 ? view.gutterElement : null
  restoreRowElements(row, view.spacer, gutterParent)
  updateRow(view, row, item, snapshot, updatePass)
  if (view.disposed) {
    disposeUnownedRow(row, contributions)
    return
  }
  view.rowElements.set(item.index, row)
}

function disposeUnownedRow(
  row: MountedVirtualizedTextRow,
  contributions: readonly EditorGutterContribution[],
): void {
  disposeGutterCellMap(row.gutterCells, contributions)
  invalidateRowPresentations(row.element)
  row.element.remove()
  row.gutterElement.remove()
}

function createRow(view: VirtualizedTextViewInternal): MountedVirtualizedTextRow | null {
  const document = view.scrollElement.ownerDocument
  const element = document.createElement('div')
  const gutterElement = document.createElement('div')
  const leftSpacerElement = document.createElement('span')
  const selectionLayerElement = document.createElement('div')
  const foldPlaceholderElement = document.createElement('span')
  const hiddenCharactersLayerElement = document.createElement('div')
  const textNode = document.createTextNode('')
  const gutterCells = createGutterCells(view, document)
  if (view.disposed) return null

  element.className = 'editor-virtualized-row'
  gutterElement.className = 'editor-virtualized-gutter-row'
  leftSpacerElement.className = 'editor-virtualized-row-spacer'
  selectionLayerElement.className = 'editor-virtualized-selection-layer'
  selectionLayerElement.setAttribute('aria-hidden', 'true')
  foldPlaceholderElement.className = 'editor-virtualized-fold-placeholder'
  hiddenCharactersLayerElement.className = 'editor-virtualized-hidden-character-layer'
  hiddenCharactersLayerElement.setAttribute('aria-hidden', 'true')
  foldPlaceholderElement.textContent = '...'
  foldPlaceholderElement.hidden = true
  for (const cell of gutterCells.values()) gutterElement.appendChild(cell)
  element.appendChild(textNode)
  if (view.gutterContributions.length > 0) view.gutterElement.appendChild(gutterElement)
  view.spacer.appendChild(element)

  return {
    index: -1,
    bufferRow: -1,
    source: 'document',
    startOffset: 0,
    endOffset: 0,
    text: '',
    kind: 'text',
    chunks: [],
    top: Number.NaN,
    height: Number.NaN,
    leftSpacerWidth: 0,
    primaryText: false,
    foldMarker: null,
    gutterNumberCursorLine: false,
    gutterCursorLineBackgroundLaneIds: [],
    mountedPaintSupport: 'replayable',
    coreBidiRefusal: false,
    textRevision: -1,
    tokenHighlightSlotId: view.nextTokenHighlightSlotId++,
    chunkKey: '',
    foldMarkerKey: '',
    foldCollapsed: false,
    element,
    gutterElement,
    gutterCells,
    gutterCellList: Array.from(gutterCells.values()),
    leftSpacerElement,
    selectionLayerElement,
    foldPlaceholderElement,
    hiddenCharactersLayerElement,
    textNode,
    selectionLayerKey: '',
    hiddenCharactersKey: '',
    rowDecorationClassName: '',
    rowDecorationGutterClassName: '',
    rowDecorationKey: '',
    rowDecorationSnapshotStyle: false,
    inlineKindsClassName: '',
    cursorLineContentActive: false,
    textRenderMode: 'simple',
    geometryCache: null,
  }
}

function createGutterCells(
  view: VirtualizedTextViewInternal,
  document: Document,
): Map<string, HTMLElement> {
  const cells = new Map<string, HTMLElement>()
  const contributions = view.gutterContributions
  for (const contribution of contributions) {
    const cell = createGutterCell(view, contribution, document)
    if (!cell) break
    cells.set(contribution.id, cell)
  }

  if (view.disposed) disposeGutterCellMap(cells, contributions)
  return cells
}

function createGutterCell(
  view: VirtualizedTextViewInternal,
  contribution: EditorGutterContribution,
  document: Document,
): HTMLElement | null {
  const release = contribution.disposeCell
  const cell = contribution.createCell(document)
  if (view.disposed) {
    disposeGutterCell({ cell, release: release ? release.bind(contribution, cell) : null })
    return null
  }
  cell.classList.add(GUTTER_CELL_CLASS)
  if (contribution.className) cell.classList.add(contribution.className)
  cell.dataset.editorGutterContribution = contribution.id
  if (contribution.interactive) cell.dataset.editorGutterInteractive = ''
  setCachedGutterCellWidth(view, cell, contribution.id)
  return cell
}

export function takeGutterCells(
  view: VirtualizedTextViewInternal,
  rows: Iterable<MountedVirtualizedTextRow>,
): () => void {
  const owners = contributionMap(view.gutterContributions)
  const pending = Array.from(rows, (row) => {
    const cells = takeGutterCellMap(row.gutterCells, owners)
    setGutterCellList(row, [])
    return cells
  }).flat()
  return () => disposeResourceSnapshot(pending, disposeGutterCell)
}

export function updateGutterContributions(
  view: VirtualizedTextViewInternal,
  contributions: readonly EditorGutterContribution[],
): boolean {
  if (sameGutterContributions(view.gutterContributions, contributions)) return false

  const previousContributions = contributionMap(view.gutterContributions)
  view.gutterContributions = contributions
  syncGutterHostElement(view)
  syncGutterRows(view, previousContributions)
  view.gutterWidthDirty = true
  view.lastRenderedRowsKey = ''
  return true
}

type GutterCellCleanup = {
  readonly cell: HTMLElement
  readonly release: (() => void) | null
}

function disposeGutterCellMap(
  cells: Map<string, HTMLElement>,
  contributions: readonly EditorGutterContribution[],
): void {
  const pending = takeGutterCellMap(cells, contributionMap(contributions))
  disposeResourceSnapshot(pending, disposeGutterCell)
}

function takeGutterCellMap(
  cells: Map<string, HTMLElement>,
  owners: ReadonlyMap<string, EditorGutterContribution>,
): readonly GutterCellCleanup[] {
  const pending = Array.from(cells, ([id, cell]) => {
    const owner = owners.get(id)
    return { cell, release: owner?.disposeCell?.bind(owner, cell) ?? null }
  })
  cells.clear()
  return pending
}

function disposeGutterCell({ cell, release }: GutterCellCleanup): void {
  try {
    release?.()
  } finally {
    cell.remove()
  }
}

function disposeResourceSnapshot<T>(resources: readonly T[], release: (resource: T) => void): void {
  let failure: { readonly error: unknown } | null = null
  for (const resource of resources) {
    try {
      release(resource)
    } catch (error) {
      failure ??= { error }
    }
  }
  if (failure) throw failure.error
}

function sameGutterContributions(
  left: readonly EditorGutterContribution[],
  right: readonly EditorGutterContribution[],
): boolean {
  if (left.length !== right.length) return false

  return left.every((contribution, index) => contribution === right[index])
}

function contributionMap(
  contributions: readonly EditorGutterContribution[],
): ReadonlyMap<string, EditorGutterContribution> {
  return new Map(contributions.map((contribution) => [contribution.id, contribution]))
}

function syncGutterHostElement(view: VirtualizedTextViewInternal): void {
  if (!gutterHostEnabled(view)) {
    view.gutterElement.remove()
    return
  }

  if (view.gutterElement.isConnected) return

  view.viewport.gutterSpacer.appendChild(view.gutterElement)
}

function gutterHostEnabled(view: VirtualizedTextViewInternal): boolean {
  return view.gutterContributions.length > 0 || view.gutterWidthProvider !== null
}

function syncGutterRows(
  view: VirtualizedTextViewInternal,
  previousContributions: ReadonlyMap<string, EditorGutterContribution>,
): void {
  const currentContributions = contributionMap(view.gutterContributions)
  for (const row of allRows(view)) {
    syncGutterRow(view, row, previousContributions, currentContributions)
  }
}

function allRows(view: VirtualizedTextViewInternal): readonly MountedVirtualizedTextRow[] {
  return Array.from(view.rowElements.values()).concat(view.rowPool)
}

function syncGutterRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  previousContributions: ReadonlyMap<string, EditorGutterContribution>,
  currentContributions: ReadonlyMap<string, EditorGutterContribution>,
): void {
  removeStaleGutterCells(row, previousContributions, currentContributions)
  addCurrentGutterCells(view, row)
  syncGutterRowElement(view, row)
}

function removeStaleGutterCells(
  row: MountedVirtualizedTextRow,
  previousContributions: ReadonlyMap<string, EditorGutterContribution>,
  currentContributions: ReadonlyMap<string, EditorGutterContribution>,
): void {
  for (const [id, cell] of row.gutterCells) {
    if (currentContributions.get(id) === previousContributions.get(id)) continue

    previousContributions.get(id)?.disposeCell?.(cell)
    cell.remove()
    row.gutterCells.delete(id)
  }
}

function addCurrentGutterCells(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): void {
  const document = view.scrollElement.ownerDocument
  const cells: HTMLElement[] = []
  for (const contribution of view.gutterContributions) {
    const cell =
      row.gutterCells.get(contribution.id) ?? createGutterCell(view, contribution, document)
    if (!cell || view.disposed) return
    row.gutterCells.set(contribution.id, cell)
    row.gutterElement.appendChild(cell)
    cells.push(cell)
  }
  setGutterCellList(row, cells)
}

function syncGutterRowElement(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): void {
  if (view.gutterContributions.length === 0) {
    row.gutterElement.remove()
    return
  }
  if (!view.rowElements.has(row.index)) return
  if (row.gutterElement.isConnected) return

  view.gutterElement.appendChild(row.gutterElement)
}

const noopToggleFold: EditorGutterRowContext['toggleFold'] = () => {}

function createRowUpdatePass(
  view: VirtualizedTextViewInternal,
  rows: Iterable<{ readonly index: number }>,
): RowUpdatePass {
  return {
    cursorBufferRow: cursorLineBufferRow(view),
    cursorVirtualRow: cursorLineVirtualRow(view),
    cursorLineHighlight: view.cursorLineHighlight,
    foldMarkers: foldMarkersForPass(view, rows),
    lineCount: view.model.lineCount,
    toggleFold: view.onFoldToggle ?? noopToggleFold,
  }
}

function foldMarkersForPass(
  view: VirtualizedTextViewInternal,
  rows: Iterable<{ readonly index: number }>,
): ReadonlyMap<number, VirtualizedFoldMarker> {
  const source = view.foldMarkerSource
  if (!source || source.size === 0) return view.foldMarkerByStartRow
  if (view.gutterContributions.length === 0 && !view.model.foldMap?.ranges.length)
    return view.foldMarkerByStartRow

  const bufferRows: number[] = []
  for (const { index } of rows) {
    const row = view.model.projection.getRow(index)
    if (!isDocumentTextDisplayRow(row) || row.sourceStartColumn !== 0) continue
    bufferRows.push(row.bufferRow)
  }
  if (bufferRows.length === 0) return view.foldMarkerByStartRow
  return source.readRows(bufferRows)
}

/** A mounted row the projection cannot place would paint as line 1, so it fails instead. */
function mountedBufferRow(view: VirtualizedTextViewInternal, index: number): number {
  const bufferRow = bufferRowForVirtualRow(view, index)
  if (bufferRow !== null) return bufferRow
  throw createError({
    code: 'EDITOR_ROW_UNMAPPED',
    message: 'The editor mounted a display row its projection does not have',
    why: 'Rows are mounted from the virtualizer, which must agree with the display projection.',
    fix: 'Report this editor bug with the document that triggered it.',
    internal: { index, rowCount: view.model.projection.rowCount },
  })
}

function rowUpdateState(
  view: VirtualizedTextViewInternal,
  index: number,
  updatePass: RowUpdatePass,
): RowUpdateState {
  const displayRow = view.model.projection.getRow(index)
  const bufferRow = mountedBufferRow(view, index)
  const primaryText = isDocumentTextDisplayRow(displayRow) && displayRow.sourceStartColumn === 0

  return {
    index,
    bufferRow,
    source: displayRowSource(displayRow),
    injectedTextRowId: injectedTextRowId(displayRow),
    metadata: displayRowMetadata(displayRow),
    startOffset: lineStartOffset(view, index),
    endOffset: lineEndOffset(view, index),
    text: displayRow?.text ?? '',
    measurements: displayRow?.measurements,
    inlineMapping: rowInlineMappingForDisplayRow(displayRow),
    kind: displayRow?.kind ?? 'text',
    primaryText,
    cursorLine: primaryText && bufferRow === updatePass.cursorBufferRow,
    cursorLineHighlight: updatePass.cursorLineHighlight,
    cursorVirtualLine: index === updatePass.cursorVirtualRow,
    foldMarker: primaryText ? (updatePass.foldMarkers.get(bufferRow) ?? null) : null,
    lineCount: updatePass.lineCount,
    toggleFold: updatePass.toggleFold,
  }
}

function mountedRowUpdateState(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  updatePass: RowUpdatePass,
): RowUpdateState {
  const primaryText = isPrimaryTextRow(view, row.index)
  return {
    index: row.index,
    bufferRow: row.bufferRow,
    source: row.source,
    injectedTextRowId: row.injectedTextRowId,
    metadata: row.metadata,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    text: row.text,
    measurements: row.measurements,
    inlineMapping: row.inlineMapping ?? null,
    kind: row.kind,
    primaryText,
    cursorLine: primaryText && row.bufferRow === updatePass.cursorBufferRow,
    cursorLineHighlight: updatePass.cursorLineHighlight,
    cursorVirtualLine: row.index === updatePass.cursorVirtualRow,
    foldMarker: primaryText ? (updatePass.foldMarkers.get(row.bufferRow) ?? null) : null,
    lineCount: updatePass.lineCount,
    toggleFold: updatePass.toggleFold,
  }
}

function inlineRowForDisplayRow(row: DisplayRow | undefined): InlineRow | undefined {
  return isDocumentTextDisplayRow(row) ? row.inlineRow : undefined
}

function displayRowSource(row: DisplayRow | undefined): EditorGutterRowContext['source'] {
  if (!row) return 'document'
  return row.source
}

function injectedTextRowId(row: DisplayRow | undefined): string | undefined {
  if (!isInjectedTextDisplayRow(row)) return undefined
  return row.id
}

function displayRowMetadata(row: DisplayRow | undefined): unknown {
  if (!isInjectedTextDisplayRow(row)) return undefined
  return row.metadata
}

function updateRowFrame(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
): void {
  if (row.index !== item.index) row.element.dataset.editorVirtualRow = String(item.index)
  if (row.top !== item.start) positionRowElement(view, row.element, item.start)

  const height = `${item.size}px`
  if (row.element.style.height !== height) row.element.style.height = height
  if (row.gutterElement.style.height !== height) row.gutterElement.style.height = height
}

function updateRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  snapshot: FixedRowVirtualizerSnapshot,
  updatePass: RowUpdatePass,
): void {
  if (isRowCurrent(view, row, item, snapshot, updatePass)) {
    const state = mountedRowUpdateState(view, row, updatePass)
    updateCursorLineContentClass(view, row, state.cursorVirtualLine)
    updateGutterRowElement(view, row, item, state)
    if (view.disposed) return
    updateMountedRowPaintFacts(row, state)
    return
  }

  const state = rowUpdateState(view, item.index, updatePass)

  const replacing = rowContentChanged(row, state)
  if (replacing) invalidateRowPresentations(row.element)
  try {
    updateRowElement(view, row, item, state, snapshot)
    if (view.disposed) return
    updateMountedRowPaintFacts(row, state)
    updateMutableRow(row, {
      bufferRow: state.bufferRow,
      endOffset: state.endOffset,
      injectedTextRowId: state.injectedTextRowId,
      kind: state.kind,
      metadata: state.metadata,
      foldCollapsed: state.foldMarker?.collapsed ?? false,
      foldMarkerKey: state.foldMarker?.key ?? '',
      height: item.size,
      index: item.index,
      source: state.source,
      startOffset: state.startOffset,
      text: state.text,
      measurements: state.measurements,
      inlineMapping: state.inlineMapping,
      textRevision: view.textRevision,
      top: item.start,
      chunkKey: rowChunkKey(view, state, snapshot, state.inlineMapping),
    })
  } finally {
    if (replacing && !view.disposed) completeRowPresentation(row.element)
  }
}

function rowContentChanged(row: MountedVirtualizedTextRow, state: RowUpdateState): boolean {
  return (
    row.index !== state.index ||
    row.bufferRow !== state.bufferRow ||
    row.source !== state.source ||
    row.injectedTextRowId !== state.injectedTextRowId ||
    row.kind !== state.kind ||
    row.text !== state.text ||
    row.inlineMapping?.line !== state.inlineMapping?.line
  )
}

function updateRowElement(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  state: RowUpdateState,
  snapshot: FixedRowVirtualizerSnapshot,
): void {
  updateRowFrame(view, row, item)
  applyRowDecoration(view, row, item.index)
  updateCursorLineContentClass(view, row, state.cursorVirtualLine)
  updateRowInlineKindClasses(row, state.kind === 'text' ? state.inlineMapping : null)
  updateGutterRowElement(view, row, item, state)
  if (view.disposed) return
  updateRowTextChunks(view, row, state, state.startOffset, state.inlineMapping, snapshot)
  if (view.disposed) return
  updateRowFoldPresentation(row, state.foldMarker)
}

export function updateMountedRowsAfterSameLineEdit(
  view: VirtualizedTextViewInternal,
  items: readonly FixedRowVirtualItem[],
  patch: SameLineEditPatch,
  snapshot: FixedRowVirtualizerSnapshot,
): boolean {
  const updatePass = createRowUpdatePass(view, items)
  let editedRowPatchedInPlace = false
  for (const item of items) {
    const row = view.rowElements.get(item.index)
    if (!row) continue
    if (updateRowAfterSameLineEdit(view, row, item, patch, snapshot, updatePass)) {
      editedRowPatchedInPlace = true
    }
  }

  return editedRowPatchedInPlace
}

export function updateMountedFoldMarkers(view: VirtualizedTextViewInternal): void {
  const pass = createRowUpdatePass(view, view.rowElements.values())
  for (const row of view.rowElements.values()) {
    const state = mountedRowUpdateState(view, row, pass)
    const marker = state.foldMarker
    if (
      row.foldMarkerKey === (marker?.key ?? '') &&
      row.foldCollapsed === (marker?.collapsed ?? false)
    )
      continue
    updateRowFoldPresentation(row, marker)
    updateGutterContributionCells(view, row, state)
    updateMountedRowPaintFacts(row, state)
    Object.assign(row, {
      foldMarkerKey: marker?.key ?? '',
      foldCollapsed: marker?.collapsed ?? false,
    })
  }
}

function updateRowAfterSameLineEdit(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  patch: SameLineEditPatch,
  snapshot: FixedRowVirtualizerSnapshot,
  updatePass: RowUpdatePass,
): boolean {
  const state = rowUpdateState(view, item.index, updatePass)

  const replacing = rowContentChanged(row, state)
  if (replacing) invalidateRowPresentations(row.element)
  try {
    const editedRowPatchedInPlace = updateRowElementForSameLineEdit(
      view,
      row,
      item,
      state,
      patch,
      snapshot,
    )
    if (view.disposed) return false
    updateMountedRowPaintFacts(row, state)
    updateMutableRow(row, {
      bufferRow: state.bufferRow,
      endOffset: state.endOffset,
      injectedTextRowId: state.injectedTextRowId,
      kind: state.kind,
      metadata: state.metadata,
      foldCollapsed: state.foldMarker?.collapsed ?? false,
      foldMarkerKey: state.foldMarker?.key ?? '',
      height: item.size,
      index: item.index,
      source: state.source,
      startOffset: state.startOffset,
      text: state.text,
      measurements: state.measurements,
      inlineMapping: state.inlineMapping,
      textRevision: view.textRevision,
      top: item.start,
      chunkKey: rowChunkKey(view, state, snapshot, state.inlineMapping),
    })
    return editedRowPatchedInPlace
  } finally {
    if (replacing && !view.disposed) completeRowPresentation(row.element)
  }
}

function updateRowElementForSameLineEdit(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  state: RowUpdateState,
  patch: SameLineEditPatch,
  snapshot: FixedRowVirtualizerSnapshot,
): boolean {
  updateRowFrame(view, row, item)
  applyRowDecoration(view, row, item.index)
  updateGutterRowElement(view, row, item, state)
  if (view.disposed) return false
  const editedRowPatchedInPlace = updateRowTextForSameLineEdit(
    view,
    row,
    item,
    state,
    patch,
    state.startOffset,
    state.inlineMapping,
    snapshot,
  )
  if (view.disposed) return false
  updateRowFoldPresentation(row, state.foldMarker)
  return editedRowPatchedInPlace
}

function updateRowTextForSameLineEdit(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  content: MeasuredText,
  patch: SameLineEditPatch,
  startOffset: number,
  mapping: RowInlineMapping | null,
  snapshot: FixedRowVirtualizerSnapshot,
): boolean {
  const { text } = content
  if (typeof text !== 'string' || bidiMeasurementRefusal(view, content)) {
    updateRowTextChunks(view, row, content, startOffset, mapping, snapshot)
    return false
  }

  if (item.index !== patch.rowIndex) {
    if (row.text !== text) updateRowTextChunks(view, row, content, startOffset, mapping, snapshot)
    if (row.text === text) syncRowChunkOffsets(row, startOffset, mapping)
    return false
  }

  if (memoizedContainsRTL(view, content)) {
    updateRowTextChunks(view, row, content, startOffset, mapping, snapshot)
    return false
  }

  if (row.textNode.data !== row.text) {
    updateRowTextChunks(view, row, content, startOffset, mapping, snapshot)
    return false
  }

  if (shouldChunkLine(view, content)) {
    updateRowTextChunks(view, row, content, startOffset, mapping, snapshot)
    return false
  }

  row.textNode.replaceData(patch.localFrom, patch.deleteLength, patch.text)
  if (row.textRenderMode === 'simple') {
    syncSimpleDirectRowChunk(row, text, startOffset, mapping)
    return true
  }

  syncDirectRowChunk(row, text, startOffset, mapping)
  return true
}

function syncRowChunkOffsets(
  row: MountedVirtualizedTextRow,
  startOffset: number,
  mapping: RowInlineMapping | null,
): void {
  const chunks = row.chunks.map((chunk) => ({
    ...chunk,
    startOffset: offsetForLocalIndex(mapping, startOffset, chunk.localStart, 'before'),
    endOffset: offsetForLocalIndex(mapping, startOffset, chunk.localEnd, 'after'),
  }))
  updateMutableRowChunks(row, chunks)
}

function updateRowTextChunks(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  content: MeasuredText,
  startOffset: number,
  mapping: RowInlineMapping | null,
  snapshot = view.virtualizer.getSnapshot(),
): void {
  const { text } = content
  setCoreBidiRefusal(row, false)
  const runs = inlineRowRuns(mapping, text)
  const refusal = bidiMeasurementRefusal(view, content)
  if (refusal) {
    setUnmeasurableBidiRowText(row, text, startOffset, mapping, refusal)
    return
  }
  if (runs.widgets.length > 0 || runs.classes.length > 0) {
    setInlineRunRowText(view, row, content, startOffset, mapping, runs)
    return
  }

  if (!shouldChunkLine(view, content)) {
    setDirectRowText(view, row, content, startOffset, mapping)
    return
  }

  setChunkedRowText(view, row, content, startOffset, mapping, snapshot)
}

function setDirectRowText(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  content: MeasuredText,
  startOffset: number,
  mapping: RowInlineMapping | null,
): void {
  const text =
    typeof content.text === 'string' ? content.text : content.text.slice(0, content.text.length)
  if (reuseDirectRowText(row, text, startOffset, mapping)) return
  setLeftSpacerWidth(row, 0)

  // Splitting costs the row the in-place `Text.data` patch it lives on while the user types, so a
  // row short enough to be scanned cheaply keeps its single node and pays nothing.
  if (!isSimpleRowText(content) || text.length > MAX_SINGLE_NODE_ROW_LENGTH) {
    setRenderedDirectRowText(view, row, content, startOffset, mapping)
    return
  }

  if (row.textRenderMode !== 'simple' || rowHasInlineAttachments(row)) {
    if (!isSoleRowChild(row, row.textNode)) row.element.replaceChildren(row.textNode)
    setTextRenderMode(row, 'simple')
  }
  if (row.textNode.data !== text) row.textNode.data = text
  syncSimpleDirectRowChunk(row, text, startOffset, mapping)
}

function setRenderedDirectRowText(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  content: MeasuredText,
  startOffset: number,
  mapping: RowInlineMapping | null,
): void {
  const text =
    typeof content.text === 'string' ? content.text : content.text.slice(0, content.text.length)
  const simple = isSimpleRowText(content)
  const maxTextNodeLength = simple ? Number.POSITIVE_INFINITY : bidiTextNodeLength(view, content)
  const rendered = simple
    ? createSplitTextChunkParts(row.element.ownerDocument, text, 0, characterWidth(view))
    : createRenderedChunkParts(
        row.element.ownerDocument,
        text,
        0,
        characterWidth(view),
        [],
        maxTextNodeLength,
      )
  if (rendered.oversizedGrapheme) {
    setUnmeasurableBidiRowText(row, text, startOffset, mapping, 'grapheme-length')
    return
  }

  if (!adoptRenderedSingleTextPart(row, rendered)) {
    row.element.replaceChildren(...rendered.nodes)
  }
  setTextRenderMode(row, 'rendered')
  syncDirectRowChunk(row, text, startOffset, mapping, rendered.parts, rendered.textNode)
}

/**
 * Most non-simple lines still render as a single text part (no
 * control-character spans). When the row's current DOM is already exactly one
 * text node, adopt it: write `Text.data` in place and point the fresh parts at
 * the retained node. `replaceChildren` would tear down and rebuild the row's
 * layout objects on every recycle, for DOM-identical output.
 */
function adoptRenderedSingleTextPart(
  row: MountedVirtualizedTextRow,
  rendered: RenderedChunkParts,
): boolean {
  const part = rendered.parts[0]
  if (rendered.parts.length !== 1 || part?.kind !== 'text') return false
  if (!isSoleRowChild(row, row.textNode)) return false

  const existing = row.textNode
  if (existing.data !== rendered.textNode.data) existing.data = rendered.textNode.data

  const mutablePart = part as { node: Text }
  mutablePart.node = existing
  const mutableRendered = rendered as { textNode: Text }
  mutableRendered.textNode = existing
  return true
}

function isSoleRowChild(row: MountedVirtualizedTextRow, node: Text): boolean {
  if (node.parentNode !== row.element) return false
  return node.previousSibling === null && node.nextSibling === null
}

function reuseDirectRowText(
  row: MountedVirtualizedTextRow,
  text: string,
  startOffset: number,
  mapping: RowInlineMapping | null,
): boolean {
  if (row.text !== text) return false
  if (row.textRenderMode === 'simple') {
    syncSimpleDirectRowChunk(row, text, startOffset, mapping)
    return true
  }

  if (row.textRenderMode !== 'rendered') return false

  const chunk = row.chunks[0]
  if (!isReusableRenderedDirectChunk(row, chunk)) return false

  syncDirectRowChunk(row, text, startOffset, mapping, chunk.parts, chunk.textNode)
  return true
}

function syncDirectRowChunk(
  row: MountedVirtualizedTextRow,
  text: TextContent,
  startOffset: number,
  mapping: RowInlineMapping | null,
  parts: readonly VirtualizedTextChunkPart[] = createTextChunkParts(row.textNode, 0, text.length),
  textNode = row.textNode,
  mountedPaint = captureMountedPaint(parts),
): void {
  const chunk = {
    startOffset,
    endOffset: offsetForLocalIndex(mapping, startOffset, text.length, 'after'),
    localStart: 0,
    localEnd: text.length,
    text,
    element: null,
    textNode,
    parts,
    mountedPaint,
  }
  updateMutableRowChunks(row, [chunk])
}

function captureMountedPaint(
  parts: readonly VirtualizedTextChunkPart[],
): EditorMountedChunkPaintJSON {
  const captured: Extract<EditorMountedChunkPaintJSON, { kind: 'replayable' }>['parts'][number][] =
    []
  for (const part of parts) {
    if (part.kind === 'widget') return { kind: 'unreplayable-widget' }
    if (part.kind === 'text') {
      captured.push({ kind: 'text', text: part.node.data })
      continue
    }

    captured.push({
      kind: 'control',
      text: part.element.textContent ?? '',
      widthCells: part.widthCells,
    })
  }

  return { kind: 'replayable', parts: captured }
}

function syncSimpleDirectRowChunk(
  row: MountedVirtualizedTextRow,
  text: string,
  startOffset: number,
  mapping: RowInlineMapping | null,
): void {
  const chunk = row.chunks[0]
  if (!isReusableSimpleDirectChunk(row, chunk)) {
    syncDirectRowChunk(row, text, startOffset, mapping)
    return
  }

  const mutableChunk = chunk as {
    startOffset: number
    endOffset: number
    localEnd: number
    text: string
    mountedPaint: EditorMountedChunkPaintJSON
  }
  mutableChunk.startOffset = startOffset
  // Chunk offsets are buffer offsets; with an inline mapping the display text is shorter than the
  // buffer span, and `startOffset + text.length` silently clips every token range to the display
  // length before the boundary math ever maps it.
  mutableChunk.endOffset = offsetForLocalIndex(mapping, startOffset, text.length, 'after')
  mutableChunk.localEnd = text.length
  mutableChunk.text = text
  mutableChunk.mountedPaint = {
    kind: 'replayable',
    parts: [{ kind: 'text', text: chunk.textNode.data }],
  }

  const part = chunk.parts[0] as { localEnd: number }
  part.localEnd = text.length
  updateMutableRowChunks(row, row.chunks)
}

function isReusableSimpleDirectChunk(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk | undefined,
): chunk is VirtualizedTextChunk {
  if (!chunk) return false
  if (row.chunks.length !== 1) return false
  if (chunk.element !== null || chunk.textNode !== row.textNode) return false

  const part = chunk.parts[0]
  if (chunk.parts.length !== 1 || !part) return false
  return part.kind === 'text' && part.localStart === 0 && part.node === row.textNode
}

function isReusableRenderedDirectChunk(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk | undefined,
): chunk is VirtualizedTextChunk {
  if (!chunk) return false
  if (row.chunks.length !== 1) return false
  if (chunk.element !== null) return false
  if (chunk.localStart !== 0) return false
  return chunk.localEnd === row.text.length
}

function rowHasInlineAttachments(row: MountedVirtualizedTextRow): boolean {
  if (row.foldCollapsed) return true
  return row.hiddenCharactersKey.length > 0
}

/**
 * Which of the row's replacements need a box of their own — one that renders itself, one that only
 * asks to be styled apart from the text around it. The row's display columns are line-absolute in
 * the mapping, so a wrapped row only claims the runs that fall inside the slice it renders: a run
 * cut by a wrap boundary has no single box to be, and stays the text it stands for.
 */
function inlineRowRuns(mapping: RowInlineMapping | null, text: TextContent): InlineRowRuns {
  if (!mapping) return NO_INLINE_ROW_RUNS

  const widgets: InlineWidgetRun[] = []
  const classes: InlineClassRun[] = []
  for (const segment of mapping.line.segments) {
    if (segment.kind !== 'replacement' || segment.id === undefined) continue
    const { className, render } = segment
    if (!render && className === undefined) continue

    const localStart = segment.displayStartColumn - mapping.displayStartColumn
    const localEnd = segment.displayEndColumn - mapping.displayStartColumn
    // A run with no display column of its own would put both its boundaries on one x, leaving the
    // caret no side to stop on and the measured advance nothing to span.
    if (localStart < 0 || localEnd > text.length || localEnd <= localStart) continue

    const id = segment.render ? (segment.key ?? segment.id) : segment.id
    const styling = className === undefined ? {} : { className }
    if (render) widgets.push({ id, localStart, localEnd, render, ...styling })
    else if (className !== undefined) classes.push({ id, localStart, localEnd, className })
  }

  return { widgets, classes }
}

// Window boundaries expand around widgets so a replacement keeps one complete box.
function setInlineRunRowText(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  content: MeasuredText,
  startOffset: number,
  mapping: RowInlineMapping | null,
  runs: InlineRowRuns,
): void {
  const { text } = content
  const window = inlineRowWindow(view, content, runs.widgets)
  const placements = runs.widgets
    .filter((run) => run.localStart < window.end && run.localEnd > window.start)
    .map((run) => inlineWidgetPlacement(view, run))
    .filter((placement) => placement !== null)
  if (view.disposed) return
  const classes = inlineClassesInWindow(runs.classes, window)
  const leftWidth =
    textPixelsBeforeColumn(view, content, window.start) +
    inlineWidgetAdvanceDelta(view, content, runs.widgets, window.start)
  setLeftSpacerWidth(row, Math.round(leftWidth))
  const chunk = row.chunks[0]
  if (chunk && reusesInlineRunRowText(row, chunk, text, placements, classes, window)) {
    syncRowChunkOffsets(row, startOffset, mapping)
    return
  }

  const rendered = createInlineRunParts(
    row.element.ownerDocument,
    text,
    characterWidth(view),
    placements,
    classes,
    bidiTextNodeLength(view, content),
    window,
  )
  if (rendered.oversizedGrapheme) {
    setUnmeasurableBidiRowText(row, text, startOffset, mapping, 'grapheme-length')
    return
  }

  row.element.replaceChildren(row.leftSpacerElement, ...rendered.nodes)
  setTextRenderMode(row, 'widget')
  updateMutableRowChunks(row, [
    {
      startOffset: offsetForLocalIndex(mapping, startOffset, window.start, 'before'),
      endOffset: offsetForLocalIndex(mapping, startOffset, window.end, 'after'),
      localStart: window.start,
      localEnd: window.end,
      text: sliceTextContent(text, window.start, window.end),
      element: null,
      textNode: rendered.textNode,
      parts: rendered.parts,
      mountedPaint: captureMountedPaint(rendered.parts),
    },
  ])
}

function inlineRowWindow(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  widgets: readonly InlineWidgetRun[],
  snapshot = view.virtualizer.getSnapshot(),
): HorizontalChunkWindow {
  if (!shouldChunkLine(view, content)) return { start: 0, end: content.text.length }
  measureUnobservedInlineWidgets(view, widgets)
  const window = horizontalChunkWindow(view, content, snapshot, widgets)
  let start = window.start
  let end = window.end
  for (const run of widgets) {
    if (run.localStart >= end || run.localEnd <= start) continue
    start = Math.min(start, run.localStart)
    end = Math.max(end, run.localEnd)
  }
  return { start, end }
}

function measureUnobservedInlineWidgets(
  view: VirtualizedTextViewInternal,
  widgets: readonly InlineWidgetRun[],
): void {
  const hosts = inlineWidgetsByView.get(view)?.hosts
  if (!hosts) return
  for (const widget of widgets) {
    const host = hosts.get(widget.id)
    if (!host || host.measuredWidth !== null || !host.element.isConnected) continue
    measureInlineWidget(view, host.element)
  }
}

function inlineWidgetAdvanceDelta(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  widgets: readonly InlineWidgetRun[],
  localOffset: number,
): number {
  let delta = 0
  for (const widget of widgets) {
    if (widget.localEnd > localOffset) break
    const width = inlineWidgetsByView.get(view)?.hosts.get(widget.id)?.measuredWidth
    if (width === null || width === undefined) continue
    const start = textPixelsBeforeColumn(view, content, widget.localStart)
    const end = textPixelsBeforeColumn(view, content, widget.localEnd)
    delta += width - (end - start)
  }
  return delta
}

function pixelsBeforeWidgetAdvances(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  widgets: readonly InlineWidgetRun[],
  pixels: number,
  bias: 'before' | 'after',
): number {
  let delta = 0
  for (const widget of widgets) {
    const width = inlineWidgetsByView.get(view)?.hosts.get(widget.id)?.measuredWidth
    if (width === null || width === undefined) continue
    const start = textPixelsBeforeColumn(view, content, widget.localStart)
    if (pixels < start + delta) break
    const end = textPixelsBeforeColumn(view, content, widget.localEnd)
    if (pixels <= start + delta + width) return bias === 'before' ? start : end
    delta += width - (end - start)
  }
  return pixels - delta
}

function columnBeforeWidgetAdvances(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  widgets: readonly InlineWidgetRun[],
  column: number,
  bias: 'before' | 'after',
): number {
  let delta = 0
  const cellWidth = characterWidth(view)
  for (const widget of widgets) {
    const width = inlineWidgetsByView.get(view)?.hosts.get(widget.id)?.measuredWidth
    if (width === null || width === undefined) continue
    const start = estimatedDisplayCellForColumn(content, widget.localStart, view.tabSize)
    if (column < start + delta) break
    const end = estimatedDisplayCellForColumn(content, widget.localEnd, view.tabSize)
    if (column <= start + delta + width / cellWidth) return bias === 'before' ? start : end
    delta += width / cellWidth - (end - start)
  }
  return column - delta
}

function inlineClassesInWindow(
  classes: readonly InlineClassRun[],
  window: HorizontalChunkWindow,
): InlineClassRun[] {
  return classes
    .filter((run) => run.localStart < window.end && run.localEnd > window.start)
    .map((run) => ({
      ...run,
      localStart: Math.max(window.start, run.localStart),
      localEnd: Math.min(window.end, run.localEnd),
    }))
}

/**
 * The row's text, with every styled run boxed in a span of its own. The parts still point at the
 * text nodes inside those boxes, so a column inside a run measures, hit-tests and paints exactly as
 * one outside it does — the box changes what the run looks like, not what it is.
 */
function createInlineRunParts(
  document: Document,
  text: TextContent,
  cellWidth: number,
  placements: readonly InlineWidgetPlacement[],
  classes: readonly InlineClassRun[],
  maxTextNodeLength: number,
  window: HorizontalChunkWindow,
): RenderedChunkParts {
  if (
    Number.isFinite(maxTextNodeLength) &&
    hasOversizedGrapheme(text.slice(window.start, window.end), maxTextNodeLength)
  ) {
    return {
      nodes: [],
      parts: [],
      textNode: document.createTextNode(''),
      oversizedGrapheme: true,
    }
  }

  const nodes: Node[] = []
  const parts: VirtualizedTextChunkPart[] = []
  let cursor = window.start

  for (const run of classes) {
    appendInlineRunSlice(
      document,
      nodes,
      parts,
      text,
      cursor,
      run.localStart,
      cellWidth,
      placements,
      maxTextNodeLength,
    )
    appendInlineClassRun(document, nodes, parts, text, run, cellWidth, maxTextNodeLength)
    cursor = run.localEnd
  }

  appendInlineRunSlice(
    document,
    nodes,
    parts,
    text,
    cursor,
    window.end,
    cellWidth,
    placements,
    maxTextNodeLength,
  )
  return {
    nodes,
    parts,
    textNode: firstRowTextNode(parts) ?? document.createTextNode(''),
    oversizedGrapheme: false,
  }
}

function appendInlineRunSlice(
  document: Document,
  nodes: Node[],
  parts: VirtualizedTextChunkPart[],
  text: TextContent,
  localStart: number,
  localEnd: number,
  cellWidth: number,
  placements: readonly InlineWidgetPlacement[],
  maxTextNodeLength: number,
): void {
  if (localEnd <= localStart) return

  const rendered = createRenderedChunkParts(
    document,
    sliceTextContent(text, localStart, localEnd),
    localStart,
    cellWidth,
    placements.filter(
      (placement) => placement.localStart >= localStart && placement.localEnd <= localEnd,
    ),
    maxTextNodeLength,
  )
  nodes.push(...rendered.nodes)
  parts.push(...rendered.parts)
}

function appendInlineClassRun(
  document: Document,
  nodes: Node[],
  parts: VirtualizedTextChunkPart[],
  text: TextContent,
  run: InlineClassRun,
  cellWidth: number,
  maxTextNodeLength: number,
): void {
  const boxed = createRenderedChunkParts(
    document,
    text.slice(run.localStart, run.localEnd),
    run.localStart,
    cellWidth,
    [],
    maxTextNodeLength,
  )
  const element = document.createElement('span')
  element.className = run.className
  element.dataset.editorInlineRun = run.id
  element.append(...boxed.nodes)

  nodes.push(element)
  parts.push(...boxed.parts)
}

function firstRowTextNode(parts: readonly VirtualizedTextChunkPart[]): Text | null {
  for (const part of parts) {
    if (part.kind === 'text') return part.node
  }

  return null
}

/**
 * Reuse is what keeps a widget out of the DOM churn a scroll frame otherwise causes, so it asks the
 * row itself rather than a key: the mounted nodes are still where this row put them, in the columns
 * these runs claim. A node another row has since taken fails on its parent.
 */
function reusesInlineRunRowText(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  text: TextContent,
  placements: readonly InlineWidgetPlacement[],
  classes: readonly InlineClassRun[],
  window: HorizontalChunkWindow,
): boolean {
  if (row.text !== text || row.textRenderMode !== 'widget' || row.chunks.length !== 1) return false
  if (chunk.localStart !== window.start || chunk.localEnd !== window.end) return false

  const mounted = chunk.parts.filter((part) => part.kind === 'widget')
  if (mounted.length !== placements.length) return false

  const reused = placements.every((placement, index) => {
    const part = mounted[index]
    if (!part || part.element !== placement.element) return false
    if (part.localStart !== placement.localStart || part.localEnd !== placement.localEnd)
      return false
    return part.element.parentNode === row.element
  })

  return reused && reusesInlineClassRuns(row, chunk, classes)
}

/**
 * A box is rebuilt rather than remounted, so all that has to still hold is which run it was built
 * for: everything else about it is the text the row has already been found to be painting.
 */
function reusesInlineClassRuns(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  classes: readonly InlineClassRun[],
): boolean {
  const boxes = inlineClassRunElements(row, chunk)
  if (boxes.length !== classes.length) return false

  return classes.every((run, index) => {
    const box = boxes[index]
    if (!box) return false
    return box.dataset.editorInlineRun === run.id && box.className === run.className
  })
}

/** The boxes the row's text parts sit in, in the order the row paints them. */
function inlineClassRunElements(
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
): readonly HTMLElement[] {
  const boxes: HTMLElement[] = []

  for (const part of chunk.parts) {
    if (part.kind !== 'text') continue
    const parent = part.node.parentElement
    if (!parent || parent === row.element) continue
    if (boxes.at(-1) !== parent) boxes.push(parent)
  }

  return boxes
}

/**
 * A replacement id owns its mount for as long as the replacement lives, across every row the run is
 * painted into. Re-rendering per row would tear the node down and build it again on every scroll
 * frame that recycles the row under it, which for anything stateful — a loading image, a spinner,
 * an input — is visible.
 */
function inlineWidgetPlacement(
  view: VirtualizedTextViewInternal,
  run: InlineWidgetRun,
): InlineWidgetPlacement | null {
  if (view.disposed) return null
  const widgets = inlineWidgets(view)
  const host = widgets.hosts.get(run.id) ?? mountInlineWidget(view, widgets, run)
  if (!host) return null
  applyInlineWidgetClass(host.element, run.className)
  return { localStart: run.localStart, localEnd: run.localEnd, element: host.element }
}

/** The run's own class rides alongside the mount's, and is re-read because the mount outlives it. */
function applyInlineWidgetClass(element: HTMLSpanElement, className: string | undefined): void {
  const next = className === undefined ? INLINE_WIDGET_CLASS : `${INLINE_WIDGET_CLASS} ${className}`
  if (element.className !== next) element.className = next
}

function inlineWidgets(view: VirtualizedTextViewInternal): InlineWidgets {
  const existing = inlineWidgetsByView.get(view)
  if (existing) return existing

  const widgets = { hosts: new Map<string, InlineWidgetHost>(), inlineMap: view.model.inlineMap }
  inlineWidgetsByView.set(view, widgets)
  return widgets
}

function mountInlineWidget(
  view: VirtualizedTextViewInternal,
  widgets: InlineWidgets,
  run: InlineWidgetRun,
): InlineWidgetHost | null {
  const element = view.scrollElement.ownerDocument.createElement('span')
  applyInlineWidgetClass(element, run.className)
  element.dataset.editorInlineWidget = run.id
  // Nothing in the row is editable, but a browser still finds caret positions inside any node it can
  // descend into, and the replacement is one indivisible stop.
  element.setAttribute('contenteditable', 'false')

  const mountDisposable = run.render(element) ?? null
  if (view.disposed) {
    try {
      mountDisposable?.dispose()
    } finally {
      element.remove()
    }
    return null
  }
  // The callback is only the signal that something moved: re-reading the element keeps a resize and
  // the measurement below on the same box, rather than the content box without its border. It is
  // also the first real width, since nothing has laid this node out until a row paints it in.
  const observer = createRowResizeObserver(() => measureInlineWidget(view, element))
  observer?.observe(element)

  const host: InlineWidgetHost = { element, mountDisposable, observer, measuredWidth: null }
  widgets.hosts.set(run.id, host)
  measureInlineWidget(view, element)
  return host
}

function measureInlineWidget(view: VirtualizedTextViewInternal, element: HTMLSpanElement): void {
  applyInlineWidgetWidth(view, element, elementMeasuredSize(element, 'width'))
}

function applyInlineWidgetWidth(
  view: VirtualizedTextViewInternal,
  element: HTMLSpanElement,
  width: number,
): void {
  // A node that measures nothing has not been laid out yet — off-screen, or a host that answers no
  // rects at all. The columns it stands on are a better guess than collapsing it to nothing.
  if (!Number.isFinite(width) || width <= 0) return
  const id = element.dataset.editorInlineWidget
  const host = id === undefined ? undefined : inlineWidgetsByView.get(view)?.hosts.get(id)
  if (host) host.measuredWidth = width
  if (!setInlineWidgetMeasuredWidth(element, width)) return

  // Row geometry is cached against the row's text and classes, none of which move when the node a
  // replacement rendered does. An image that finished loading would otherwise keep the columns
  // after it where they were laid out at its placeholder size.
  clearRowGeometryCaches(view)
  // Dropping the caches is only half of it. Every other place that drops them is inside a pass that
  // goes on to repaint; this one is reached from a resize delivery with nothing behind it, so the
  // caret and the horizontal extent would keep the numbers they were last painted with until the
  // next keystroke happened to ask for them again.
  scheduleInlineWidgetRepaint(view)
}

/**
 * Coalesced and deferred, because the width arrives either inside a resize delivery — where
 * repainting immediately re-enters the observer that is still running — or inside the row paint
 * that mounted the node, which would re-enter the render pass writing that row. A burst of
 * replacements settling together is one pass either way.
 */
function scheduleInlineWidgetRepaint(view: VirtualizedTextViewInternal): void {
  if (pendingInlineWidgetRepaints.has(view)) return

  const win = view.scrollElement.ownerDocument.defaultView
  if (!win) return

  /**
   * @justification Leaving the current frame is the entire content of this delay: it is what keeps
   * the repaint out of the resize delivery and out of the row paint that ask for it. The one
   * outstanding handle per view makes a second request in the same frame a no-op, and
   * `cancelInlineWidgetRepaint` withdraws it when the view goes away.
   */
  const handle = win.setTimeout(() => {
    pendingInlineWidgetRepaints.delete(view)
    resetContentWidthScan(view)
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
  }, 0)
  pendingInlineWidgetRepaints.set(view, () => win.clearTimeout(handle))
}

function cancelInlineWidgetRepaint(view: VirtualizedTextViewInternal): void {
  pendingInlineWidgetRepaints.get(view)?.()
  pendingInlineWidgetRepaints.delete(view)
}

/**
 * A mount lives as long as its replacement does, not as long as the row showing it: scrolling away
 * keeps it, and only the replacement leaving the map — dropped by its provider, or revealed under
 * the caret — takes it down.
 */
function retireInlineWidgets(view: VirtualizedTextViewInternal): void {
  const widgets = inlineWidgetsByView.get(view)
  if (!widgets || widgets.inlineMap === view.model.inlineMap) return

  widgets.inlineMap = view.model.inlineMap
  const live = new Set<string>()
  for (const replacements of view.model.inlineMap?.rowReplacements.values() ?? []) {
    for (const replacement of replacements) live.add(replacement.key ?? replacement.id)
  }

  const pending = Array.from(widgets.hosts).filter(([id]) => !live.has(id))
  for (const [id] of pending) widgets.hosts.delete(id)
  const cleanup = pending.map(([, host]) => captureInlineWidgetCleanup(host))
  disposeResourceSnapshot(cleanup, disposeInlineWidget)
}

export function takeInlineWidgets(view: VirtualizedTextViewInternal): () => void {
  cancelInlineWidgetRepaint(view)
  const widgets = inlineWidgetsByView.get(view)
  if (!widgets) return () => undefined

  const pending = Array.from(widgets.hosts.values(), captureInlineWidgetCleanup)
  widgets.hosts.clear()
  inlineWidgetsByView.delete(view)
  return () => disposeResourceSnapshot(pending, disposeInlineWidget)
}

function captureInlineWidgetCleanup(host: InlineWidgetHost): InlineWidgetCleanup {
  return {
    element: host.element,
    observer: host.observer,
    release: host.mountDisposable?.dispose.bind(host.mountDisposable) ?? null,
  }
}

function disposeInlineWidget(host: InlineWidgetCleanup): void {
  host.observer?.disconnect()
  try {
    host.release?.()
  } finally {
    host.element.remove()
  }
}

function setChunkedRowText(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  content: MeasuredText,
  startOffset: number,
  mapping: RowInlineMapping | null,
  snapshot: FixedRowVirtualizerSnapshot,
): void {
  const { text } = content
  const window = horizontalChunkWindow(view, content, snapshot)
  const leftSpacerWidth = Math.round(textPixelsBeforeColumn(view, content, window.start))
  setLeftSpacerWidth(row, leftSpacerWidth)
  if (reuseRowChunks(view, row, text, window, startOffset, mapping)) return

  const chunks = createRowChunks(view, text, window, startOffset, mapping)
  const elements = chunks
    .map((chunk) => chunk.element)
    .filter((element): element is HTMLSpanElement => element !== null)
  row.element.dataset.editorVirtualWindowStart = String(window.start)
  row.element.dataset.editorVirtualWindowEnd = String(window.end)
  row.element.replaceChildren(row.leftSpacerElement, ...elements)
  setTextRenderMode(row, 'chunked')
  updateMutableRowChunks(row, chunks)
}

function reuseRowChunks(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  text: TextContent,
  window: HorizontalChunkWindow,
  startOffset: number,
  mapping: RowInlineMapping | null,
): boolean {
  if (row.textRenderMode !== 'chunked') return false
  if (row.chunks[0]?.localStart !== window.start) return false
  if (row.chunks.at(-1)?.localEnd !== window.end) return false

  for (const chunk of row.chunks) {
    if (chunk.element === null) return false
    updateRowChunk(view, chunk, chunk.element, text, startOffset, mapping)
  }

  updateMutableRowChunks(row, row.chunks)
  return true
}

function updateRowChunk(
  view: VirtualizedTextViewInternal,
  chunk: VirtualizedTextChunk,
  element: HTMLSpanElement,
  text: TextContent,
  startOffset: number,
  mapping: RowInlineMapping | null,
): void {
  const mutableChunk = chunk as {
    startOffset: number
    endOffset: number
    text: string
    parts: readonly VirtualizedTextChunkPart[]
    textNode: Text
    mountedPaint: EditorMountedChunkPaintJSON
  }
  mutableChunk.startOffset = offsetForLocalIndex(mapping, startOffset, chunk.localStart, 'before')
  mutableChunk.endOffset = offsetForLocalIndex(mapping, startOffset, chunk.localEnd, 'after')
  const chunkText = text.slice(chunk.localStart, chunk.localEnd)
  if (chunkText === chunk.text) {
    refreshChunkControlWidths(view, chunk)
    return
  }

  const paint = patchSimpleChunkText(chunk, chunkText)
  mutableChunk.text = chunkText
  if (paint !== null) {
    mutableChunk.mountedPaint = paint
    return
  }

  const rendered = createRowChunkParts(view, chunkText, chunk.localStart)
  element.replaceChildren(...rendered.nodes)
  mutableChunk.parts = rendered.parts
  mutableChunk.textNode = rendered.textNode
  mutableChunk.mountedPaint = captureMountedPaint(rendered.parts)
}

function refreshChunkControlWidths(
  view: VirtualizedTextViewInternal,
  chunk: VirtualizedTextChunk,
): void {
  for (const part of chunk.parts) {
    if (part.kind !== 'control') continue
    setStyleValue(part.element, 'width', `${part.widthCells * characterWidth(view)}px`)
  }
}

function patchSimpleChunkText(
  chunk: VirtualizedTextChunk,
  text: string,
): EditorMountedChunkPaintJSON | null {
  if (!isSimpleRowText(chunk.text) || !isSimpleRowText(text)) return null
  const paint = chunk.mountedPaint
  if (paint.kind !== 'replayable') return null

  let changedPaint: (typeof paint.parts)[number][] | null = null
  for (let index = 0; index < chunk.parts.length; index += 1) {
    const part = chunk.parts[index]!
    if (part.kind !== 'text') return null
    const partText = text.slice(
      part.localStart - chunk.localStart,
      part.localEnd - chunk.localStart,
    )
    if (part.node.data === partText) continue

    part.node.data = partText
    changedPaint ??= paint.parts.slice()
    changedPaint[index] = { kind: 'text', text: partText }
  }

  return changedPaint === null ? paint : { kind: 'replayable', parts: changedPaint }
}

function createRowChunks(
  view: VirtualizedTextViewInternal,
  text: TextContent,
  window: HorizontalChunkWindow,
  startOffset: number,
  mapping: RowInlineMapping | null,
): VirtualizedTextChunk[] {
  const chunks: VirtualizedTextChunk[] = []
  const simple = isSimpleRowText(text)
  let localStart = window.start
  while (localStart < window.end) {
    const targetEnd = Math.min(localStart + view.longLineChunkSize, window.end)
    const localEnd = simple ? targetEnd : graphemeChunkEnd(text, targetEnd)
    chunks.push(createRowChunk(view, text, localStart, localEnd, startOffset, mapping))
    localStart = localEnd
  }
  return chunks
}

function graphemeChunkEnd(text: TextContent, target: number): number {
  if (target >= text.length) return text.length
  const start = previousGraphemeBoundary(text, target)
  return nextGraphemeBoundary(text, start)
}

function createRowChunk(
  view: VirtualizedTextViewInternal,
  text: TextContent,
  localStart: number,
  localEnd: number,
  startOffset: number,
  mapping: RowInlineMapping | null,
): VirtualizedTextChunk {
  const element = view.scrollElement.ownerDocument.createElement('span')
  const chunkText = text.slice(localStart, localEnd)
  const rendered = createRowChunkParts(view, chunkText, localStart)

  element.className = 'editor-virtualized-row-chunk'
  element.dataset.editorVirtualChunkStart = String(localStart)
  element.dataset.editorVirtualChunkEnd = String(localEnd)
  element.append(...rendered.nodes)

  return {
    startOffset: offsetForLocalIndex(mapping, startOffset, localStart, 'before'),
    endOffset: offsetForLocalIndex(mapping, startOffset, localEnd, 'after'),
    localStart,
    localEnd,
    text: chunkText,
    element,
    textNode: rendered.textNode,
    parts: rendered.parts,
    mountedPaint: captureMountedPaint(rendered.parts),
  }
}

function createRowChunkParts(
  view: VirtualizedTextViewInternal,
  text: string,
  localStart: number,
): RenderedChunkParts {
  return createSplitTextChunkParts(
    view.scrollElement.ownerDocument,
    text,
    localStart,
    characterWidth(view),
  )
}

// Bound browser text-node scans without splitting grapheme clusters.
function createSplitTextChunkParts(
  document: Document,
  text: string,
  localStart: number,
  characterWidth: number,
): RenderedChunkParts {
  if (!isSimpleRowText(text))
    return createRenderedChunkParts(document, text, localStart, characterWidth)

  const nodeCount = Math.max(1, Math.ceil(text.length / MAX_ROW_TEXT_NODE_LENGTH))
  const nodes: Text[] = []
  const parts: VirtualizedTextChunkPart[] = []

  for (let index = 0; index < nodeCount; index += 1) {
    const start = index * MAX_ROW_TEXT_NODE_LENGTH
    const end = Math.min(start + MAX_ROW_TEXT_NODE_LENGTH, text.length)
    const node = document.createTextNode(text.slice(start, end))
    nodes.push(node)
    parts.push({
      kind: 'text',
      localStart: localStart + start,
      localEnd: localStart + end,
      node,
    })
  }

  return { nodes, parts, textNode: nodes[0]!, oversizedGrapheme: false }
}

function shouldChunkLine(view: VirtualizedTextViewInternal, content: MeasuredText): boolean {
  const { text } = content
  if (typeof text !== 'string') return !memoizedContainsRTL(view, content)
  if (view.wrapEnabled) return false
  if (text.length <= view.longLineChunkThreshold) return false
  return !memoizedContainsRTL(view, content)
}

function bidiTextNodeLength(view: VirtualizedTextViewInternal, content: MeasuredText): number {
  if (memoizedContainsRTL(view, content)) return MAX_ROW_TEXT_NODE_LENGTH
  return Number.POSITIVE_INFINITY
}

function bidiMeasurementRefusal(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
): BidiMeasurementRefusal | null {
  const { text } = content
  if (text.length <= MAX_ROW_TEXT_NODE_LENGTH) return null
  if (!memoizedContainsRTL(view, content)) return null
  if (text.length >= BIDI_LINE_MEASUREMENT_CEILING) return 'line-length'
  return null
}

function hasOversizedGrapheme(text: string, maxLength: number): boolean {
  if (!Number.isFinite(maxLength)) return false

  for (const segment of segmentGraphemes(text)) {
    if (segment.segment.length > maxLength) return true
  }
  return false
}

function setUnmeasurableBidiRowText(
  row: MountedVirtualizedTextRow,
  text: TextContent,
  startOffset: number,
  mapping: RowInlineMapping | null,
  refusal: BidiMeasurementRefusal,
): void {
  const document = row.element.ownerDocument
  const element = document.createElement('span')
  const startEndpoint = document.createElement('span')
  const endEndpoint = document.createElement('span')
  element.className = 'editor-virtualized-bidi-ceiling'
  element.dataset.editorBidiLineLength = String(text.length)
  element.dataset.editorBidiMeasurementRefusal = refusal
  startEndpoint.dataset.editorBidiEndpoint = 'start'
  startEndpoint.textContent = '…'
  endEndpoint.dataset.editorBidiEndpoint = 'end'
  endEndpoint.textContent = bidiMeasurementRefusalLabel(refusal)
  element.append(startEndpoint, endEndpoint)
  setLeftSpacerWidth(row, 0)
  row.element.replaceChildren(element)
  setTextRenderMode(row, 'widget')
  syncDirectRowChunk(
    row,
    text,
    startOffset,
    mapping,
    [
      {
        kind: 'widget',
        localStart: 0,
        localEnd: 0,
        element: startEndpoint,
      },
      {
        kind: 'widget',
        localStart: text.length,
        localEnd: text.length,
        element: endEndpoint,
      },
    ],
    document.createTextNode(''),
    {
      kind: 'replayable',
      parts: [
        { kind: 'refusal', text: startEndpoint.textContent ?? '' },
        { kind: 'refusal', text: endEndpoint.textContent ?? '' },
      ],
    },
  )
  setCoreBidiRefusal(row, true)
}

function bidiMeasurementRefusalLabel(refusal: BidiMeasurementRefusal): string {
  if (refusal === 'grapheme-length') {
    return ` BiDi grapheme exceeds the ${MAX_ROW_TEXT_NODE_LENGTH}-unit geometry ceiling`
  }
  return ` BiDi line exceeds the ${BIDI_LINE_MEASUREMENT_CEILING}-unit geometry ceiling`
}

function rowChunkKey(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  snapshot = view.virtualizer.getSnapshot(),
  mapping: RowInlineMapping | null = null,
): string {
  if (!shouldChunkLine(view, content)) return 'direct'

  // Only the aligned window bounds describe what the row rendered. Folding the raw scroll position
  // or viewport width in would invalidate the row — and the geometry measured for it — on every
  // pixel of horizontal scroll, even though the mounted chunks are identical.
  const widgets = inlineRowRuns(mapping, content.text).widgets
  const window = inlineRowWindow(view, content, widgets, snapshot)
  return `${window.start}:${window.end}`
}

/** How far along the row its text reaches by `column`: measured advances in a proportional face. */
function textPixelsBeforeColumn(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  column: number,
): number {
  if (view.glyphs) return pixelsBeforeColumn(content.text, column, view.glyphs, view.tabSize)
  return estimatedDisplayCellForColumn(content, column, view.tabSize) * characterWidth(view)
}

function horizontalChunkWindow(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  snapshot = view.virtualizer.getSnapshot(),
  widgets: readonly InlineWidgetRun[] = [],
): HorizontalChunkWindow {
  if (view.glyphs) {
    return proportionalChunkWindow(view, content, snapshot, view.glyphs, widgets)
  }
  const { text } = content
  const viewportColumns = horizontalViewportColumns(view, snapshot.viewportWidth)
  const leftColumn = Math.max(
    0,
    Math.floor(horizontalTextScrollLeft(view, snapshot.scrollLeft) / characterWidth(view)),
  )
  const startColumn = Math.max(0, leftColumn - view.horizontalOverscanColumns)
  const endColumn = leftColumn + viewportColumns + view.horizontalOverscanColumns
  const startBufferColumn = bufferColumnForEstimatedColumn(
    content,
    columnBeforeWidgetAdvances(view, content, widgets, startColumn, 'before'),
    'before',
    view.tabSize,
  )
  const endBufferColumn = bufferColumnForEstimatedColumn(
    content,
    columnBeforeWidgetAdvances(view, content, widgets, endColumn, 'after'),
    'after',
    view.tabSize,
  )
  const start = alignChunkStart(startBufferColumn, view.longLineChunkSize)
  const end = alignChunkEnd(Math.min(text.length, endBufferColumn), view.longLineChunkSize)

  const clampedEnd = clamp(end, start, text.length)
  if (isSimpleRowText(content)) return { start, end: clampedEnd }
  return {
    start: start === 0 ? 0 : previousGraphemeBoundary(text, start + 1),
    end: graphemeChunkEnd(text, clampedEnd),
  }
}

/**
 * The window a scroll offset reaches along a row in a proportional face, found from measured
 * advances: column arithmetic would mount text far from where the spacer puts the viewport.
 */
function proportionalChunkWindow(
  view: VirtualizedTextViewInternal,
  content: MeasuredText,
  snapshot: FixedRowVirtualizerSnapshot,
  glyphs: GlyphAdvances,
  widgets: readonly InlineWidgetRun[],
): HorizontalChunkWindow {
  const { text } = content
  const left = horizontalTextScrollLeft(view, snapshot.scrollLeft)
  const overscan = view.horizontalOverscanColumns * characterWidth(view)
  const right = left + Math.max(0, snapshot.viewportWidth - gutterWidth(view)) + overscan
  const startPixels = pixelsBeforeWidgetAdvances(view, content, widgets, left - overscan, 'before')
  const endPixels = pixelsBeforeWidgetAdvances(view, content, widgets, right, 'after')
  const startColumn = columnAtPixels(text, startPixels, glyphs, view.tabSize, 'before')
  const endColumn = columnAtPixels(text, endPixels, glyphs, view.tabSize, 'after')
  const start = alignChunkStart(startColumn, view.longLineChunkSize)
  const end = clamp(alignChunkEnd(endColumn, view.longLineChunkSize), start, text.length)
  if (isSimpleRowText(content)) return { start, end }
  return {
    start: start === 0 ? 0 : previousGraphemeBoundary(text, start + 1),
    end: graphemeChunkEnd(text, end),
  }
}

function bufferColumnForEstimatedColumn(
  content: MeasuredText,
  visualColumn: number,
  bias: 'before' | 'after',
  tabSize: number,
): number {
  if (isSimpleRowText(content))
    return visualColumnToBufferColumn(content, visualColumn, bias, tabSize)
  return estimatedColumnToBufferColumn(content, visualColumn, bias, tabSize)
}

export function horizontalViewportColumns(
  view: VirtualizedTextViewInternal,
  viewportWidth = view.virtualizer.getSnapshot().viewportWidth,
): number {
  if (viewportWidth === 0) return view.model.wrapColumn ?? 1

  const width = Math.max(0, viewportWidth - gutterWidth(view))
  return Math.max(1, Math.ceil(width / characterWidth(view)))
}

function horizontalTextScrollLeft(
  view: VirtualizedTextViewInternal,
  scrollLeft = view.virtualizer.getSnapshot().scrollLeft,
): number {
  return Math.max(0, scrollLeft - gutterWidth(view))
}

function horizontalWindowKey(
  view: VirtualizedTextViewInternal,
  items: readonly FixedRowVirtualItem[],
  snapshot: FixedRowVirtualizerSnapshot,
): string {
  // Same reasoning as `rowChunkKey`: the render pass only has work to do once a chunked row's
  // window actually shifts, so the key is the windows themselves rather than the scroll offset
  // they were derived from. Rows that are not chunked contribute nothing — horizontal scroll never
  // changes what they render.
  let key = ''
  for (const item of items) {
    const content = lineContent(view, item.index)
    if (!shouldChunkLine(view, content)) continue

    const mapping = rowInlineMappingForDisplayRow(view.model.projection.getRow(item.index))
    const widgets = inlineRowRuns(mapping, content.text).widgets
    const window = inlineRowWindow(view, content, widgets, snapshot)
    key += `${item.index}:${window.start}:${window.end}|`
  }

  return key === '' ? 'direct' : key
}

function updateRowFoldPresentation(
  row: MountedVirtualizedTextRow,
  marker: VirtualizedFoldMarker | null,
): void {
  updateFoldPlaceholder(row, marker)
}

function updateFoldPlaceholder(
  row: MountedVirtualizedTextRow,
  marker: VirtualizedFoldMarker | null,
): void {
  const show = marker?.collapsed === true
  if (!show) {
    hideFoldPlaceholder(row.foldPlaceholderElement)
    return
  }

  showFoldPlaceholder(row.foldPlaceholderElement, marker.key)
  if (row.foldPlaceholderElement.isConnected) return
  row.element.appendChild(row.foldPlaceholderElement)
}

function updateGutterRowElement(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  state: RowUpdateState,
): void {
  updateMountedGutterFacts(view, row, state)
  if (view.gutterContributions.length === 0) return

  if (row.index !== item.index) {
    row.gutterElement.dataset.editorVirtualGutterRow = String(item.index)
  }
  if (row.top !== item.start) {
    positionRowElement(view, row.gutterElement, item.start)
  }

  updateGutterContributionCells(view, row, state)
}

function updateMountedGutterFacts(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  state: RowUpdateState,
): void {
  const mutable = row as {
    gutterNumberCursorLine: boolean
    gutterCursorLineBackgroundLaneIds: readonly string[]
  }
  mutable.gutterNumberCursorLine = state.cursorLine && view.cursorLineHighlight.gutterNumber
  setCursorLineGutterBand(
    row.gutterElement,
    state.cursorLine &&
      view.currentGutterLeadingInset > 0 &&
      view.cursorLineHighlight.gutterBackground === true,
  )
  if (!state.cursorLine) {
    mutable.gutterCursorLineBackgroundLaneIds = []
    return
  }

  mutable.gutterCursorLineBackgroundLaneIds = view.gutterContributions
    .filter((contribution) => cursorLineGutterBackgroundEnabled(view, contribution.id))
    .map((contribution) => contribution.id)
}

function positionRowElement(
  view: VirtualizedTextViewInternal,
  element: HTMLElement,
  top: number,
): void {
  const paintTop = top + view.viewport.paintOffsetY
  if (view.rowPositioning === 'top') {
    element.style.transform = ''
    element.style.top = `${paintTop}px`
    return
  }

  element.style.top = '0px'
  element.style.transform = `translateY(${paintTop}px)`
}

function updateGutterContributionCells(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  state: RowUpdateState,
): void {
  const contributions = view.gutterContributions
  const cells = row.gutterCellList

  for (let index = 0; index < contributions.length; index += 1) {
    const contribution = contributions[index]!
    const cell = cells[index] ?? row.gutterCells.get(contribution.id)
    if (!cell) continue

    contribution.updateCell(cell, state)
    if (view.disposed) return
    updateCursorLineGutterCellClass(view, cell, contribution.id, state.cursorLine)
  }
}

function setCachedGutterCellWidth(
  view: VirtualizedTextViewInternal,
  cell: HTMLElement,
  contributionId: string,
): void {
  const width = view.gutterContributionWidths.get(contributionId)
  if (width === undefined) return

  setStyleValue(cell, 'width', `${width}px`)
}

export function cursorLineBufferRow(view: VirtualizedTextViewInternal): number | null {
  if (!hasCollapsedSelection(view)) return null

  return bufferRowForOffset(view, view.selectionHead!)
}

export function cursorLineVirtualRow(view: VirtualizedTextViewInternal): number | null {
  const selection = view.selections[0]
  if (!selection || selection.start !== selection.end) return null

  return rowForCaretPosition(view, selection.head, selection.affinity)
}

function hasCollapsedSelection(view: VirtualizedTextViewInternal): boolean {
  if (view.selectionHead === null) return false
  if (view.selectionStart === null || view.selectionEnd === null) return false

  return view.selectionStart === view.selectionEnd
}

export function refreshCursorLineRows(
  view: VirtualizedTextViewInternal,
  previousBufferRow: number | null,
  previousVirtualRow: number | null,
): void {
  const nextBufferRow = cursorLineBufferRow(view)
  const nextVirtualRow = cursorLineVirtualRow(view)
  if (previousBufferRow === nextBufferRow && previousVirtualRow === nextVirtualRow) return

  const rows = [...view.rowElements.values()].filter((row) =>
    shouldRefreshCursorLineRow(
      row,
      previousBufferRow,
      nextBufferRow,
      previousVirtualRow,
      nextVirtualRow,
    ),
  )
  const updatePass = createRowUpdatePass(view, rows)
  for (const row of rows) {
    updateCursorLineContentClass(view, row, row.index === nextVirtualRow)
    refreshCursorLineGutterCells(view, row, updatePass)
  }
}

function shouldRefreshCursorLineRow(
  row: MountedVirtualizedTextRow,
  previousBufferRow: number | null,
  nextBufferRow: number | null,
  previousVirtualRow: number | null,
  nextVirtualRow: number | null,
): boolean {
  if (row.index === previousVirtualRow || row.index === nextVirtualRow) return true

  return row.bufferRow === previousBufferRow || row.bufferRow === nextBufferRow
}

function refreshCursorLineGutterCells(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  updatePass: RowUpdatePass,
): void {
  const state = mountedRowUpdateState(view, row, updatePass)
  updateMountedGutterFacts(view, row, state)
  if (view.gutterContributions.length === 0) return

  updateGutterContributionCells(view, row, state)
}

function updateCursorLineContentClass(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  active: boolean,
): void {
  const enabled = view.cursorLineHighlight.rowBackground && active
  if (row.cursorLineContentActive === enabled) return

  setCursorLineContentActive(row, enabled)
  row.element.classList.toggle(CURSOR_LINE_ROW_CLASS, enabled)
}

function updateCursorLineGutterCellClass(
  view: VirtualizedTextViewInternal,
  element: HTMLElement,
  contributionId: string,
  active: boolean,
): void {
  const enabled = active && cursorLineGutterBackgroundEnabled(view, contributionId)
  if ((gutterCursorLineStates.get(element) ?? false) === enabled) return

  gutterCursorLineStates.set(element, enabled)
  element.classList.toggle(CURSOR_LINE_GUTTER_CLASS, enabled)
}

function setCursorLineGutterBand(element: HTMLElement, enabled: boolean): void {
  if ((gutterCursorLineBandStates.get(element) ?? false) === enabled) return
  gutterCursorLineBandStates.set(element, enabled)
  element.classList.toggle(CURSOR_LINE_GUTTER_BAND_CLASS, enabled)
}

function cursorLineGutterBackgroundEnabled(
  view: VirtualizedTextViewInternal,
  contributionId: string,
): boolean {
  const setting = view.cursorLineHighlight.gutterBackground
  if (typeof setting === 'boolean') return setting

  return setting.includes(contributionId)
}

function isPrimaryTextRow(view: VirtualizedTextViewInternal, row: number): boolean {
  const displayRow = view.model.projection.getRow(row)
  if (!isDocumentTextDisplayRow(displayRow)) return false
  return displayRow.sourceStartColumn === 0
}

function isRowCurrent(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  item: FixedRowVirtualItem,
  snapshot: FixedRowVirtualizerSnapshot,
  updatePass: RowUpdatePass,
): boolean {
  if (row.index !== item.index) return false
  if (row.top !== item.start) return false
  if (row.height !== item.size) return false
  if (row.textRevision !== view.textRevision) return false

  const bufferRow = bufferRowForVirtualRow(view, item.index)
  if (row.bufferRow !== bufferRow) return false

  const displayRow = view.model.projection.getRow(item.index)
  if (row.source !== displayRowSource(displayRow)) return false
  if (row.injectedTextRowId !== injectedTextRowId(displayRow)) return false
  if (row.metadata !== displayRowMetadata(displayRow)) return false

  const text = lineText(view, item.index)
  if (row.text !== text) return false
  // Display text alone does not say what is behind it: a run that changed only how it paints — the
  // box it asks for, the node it renders — leaves every column of the row exactly where it was.
  if (row.inlineMapping?.line !== inlineRowForDisplayRow(displayRow)) return false
  if (
    row.chunkKey !==
    rowChunkKey(view, lineContent(view, item.index), snapshot, row.inlineMapping ?? null)
  )
    return false
  if (row.rowDecorationKey !== rowDecorationKey(view, item.index)) return false

  const primaryText = isDocumentTextDisplayRow(displayRow) && displayRow.sourceStartColumn === 0
  const foldMarker = primaryText ? updatePass.foldMarkers.get(bufferRow) : undefined
  if (row.foldMarkerKey !== (foldMarker?.key ?? '')) return false
  return row.foldCollapsed === (foldMarker?.collapsed ?? false)
}

function applyRowDecoration(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  virtualRow: number,
): void {
  const decoration = rowDecorationForVirtualRow(view, virtualRow)
  ;(row as { rowDecorationSnapshotStyle: boolean }).rowDecorationSnapshotStyle =
    decoration?.snapshotStyle === 'colors'
  if (!decoration) {
    clearRowDecoration(row)
    return
  }

  setRowDecorationClass(row, decoration.className ?? '')
  setRowDecorationGutterClass(row, decoration.gutterClassName ?? '')
  setRowDecorationKey(row, rowDecorationKeyForDecoration(decoration))
}

function rowDecorationKey(view: VirtualizedTextViewInternal, virtualRow: number): string {
  return rowDecorationKeyForDecoration(rowDecorationForVirtualRow(view, virtualRow))
}

function rowDecorationForVirtualRow(
  view: VirtualizedTextViewInternal,
  virtualRow: number,
): VirtualizedTextRowDecoration | undefined {
  const displayRow = view.model.projection.getRow(virtualRow)
  if (isInjectedTextDisplayRow(displayRow)) return injectedRowDecoration(displayRow)

  const bufferRow = bufferRowForVirtualRow(view, virtualRow)
  if (bufferRow === null) return undefined
  return view.rowDecorations.get(bufferRow)
}

function injectedRowDecoration(
  row: DisplayInjectedTextRow,
): VirtualizedTextRowDecoration | undefined {
  if (!row.className && !row.gutterClassName) return undefined

  return {
    className: row.className,
    gutterClassName: row.gutterClassName,
  }
}

function rowDecorationKeyForDecoration(
  decoration: VirtualizedTextRowDecoration | undefined,
): string {
  if (!decoration) return ''

  return `${decoration.className ?? ''}|${decoration.gutterClassName ?? ''}|${decoration.snapshotStyle ?? ''}`
}

function clearRowDecoration(row: MountedVirtualizedTextRow): void {
  if (row.rowDecorationKey === '') return

  setRowDecorationClass(row, '')
  setRowDecorationGutterClass(row, '')
  setRowDecorationKey(row, '')
}

function setRowDecorationClass(row: MountedVirtualizedTextRow, className: string): void {
  if (row.rowDecorationClassName === className) return

  removeClassNames(row.element, row.rowDecorationClassName)
  addClassNames(row.element, className)
  setRowDecorationClassName(row, className)
}

function setRowDecorationGutterClass(row: MountedVirtualizedTextRow, className: string): void {
  if (row.rowDecorationGutterClassName === className) return

  removeClassNames(row.gutterElement, row.rowDecorationGutterClassName)
  addClassNames(row.gutterElement, className)
  setRowDecorationGutterClassName(row, className)
}

function setGutterCellList(
  row: MountedVirtualizedTextRow,
  gutterCellList: readonly HTMLElement[],
): void {
  const mutable = row as { gutterCellList: readonly HTMLElement[] }
  mutable.gutterCellList = gutterCellList
}

function setTextRenderMode(
  row: MountedVirtualizedTextRow,
  textRenderMode: VirtualizedTextRenderMode,
): void {
  const wasChunked = row.textRenderMode === 'chunked'
  const mutable = row as { textRenderMode: VirtualizedTextRenderMode }
  mutable.textRenderMode = textRenderMode
  if (!wasChunked || textRenderMode === 'chunked') return
  delete row.element.dataset.editorVirtualWindowStart
  delete row.element.dataset.editorVirtualWindowEnd
}

function setLeftSpacerWidth(row: MountedVirtualizedTextRow, width: number): void {
  const mutable = row as { leftSpacerWidth: number }
  mutable.leftSpacerWidth = width
  row.leftSpacerElement.style.width = `${width}px`
}

function setCoreBidiRefusal(row: MountedVirtualizedTextRow, active: boolean): void {
  const mutable = row as { coreBidiRefusal: boolean }
  mutable.coreBidiRefusal = active
}

function updateMountedRowPaintFacts(row: MountedVirtualizedTextRow, state: RowUpdateState): void {
  const unsupportedClass =
    row.inlineKindsClassName.length > 0 ||
    (!row.rowDecorationSnapshotStyle &&
      (row.rowDecorationClassName.length > 0 || row.rowDecorationGutterClassName.length > 0))
  const unsupportedWidget = row.textRenderMode === 'widget' && !row.coreBidiRefusal
  const mutable = row as {
    primaryText: boolean
    foldMarker: VirtualizedFoldMarker | null
    mountedPaintSupport: MountedVirtualizedTextRow['mountedPaintSupport']
  }
  mutable.primaryText = state.primaryText
  mutable.foldMarker = state.foldMarker
  mutable.mountedPaintSupport =
    unsupportedClass || unsupportedWidget ? 'unreplayable-plugin-css' : 'replayable'
}

function setCursorLineContentActive(
  row: MountedVirtualizedTextRow,
  cursorLineContentActive: boolean,
): void {
  const mutable = row as { cursorLineContentActive: boolean }
  mutable.cursorLineContentActive = cursorLineContentActive
}

function setRowDecorationClassName(
  row: MountedVirtualizedTextRow,
  rowDecorationClassName: string,
): void {
  const mutable = row as { rowDecorationClassName: string }
  mutable.rowDecorationClassName = rowDecorationClassName
}

function setRowDecorationGutterClassName(
  row: MountedVirtualizedTextRow,
  rowDecorationGutterClassName: string,
): void {
  const mutable = row as { rowDecorationGutterClassName: string }
  mutable.rowDecorationGutterClassName = rowDecorationGutterClassName
}

function setRowDecorationKey(row: MountedVirtualizedTextRow, rowDecorationKey: string): void {
  const mutable = row as { rowDecorationKey: string }
  mutable.rowDecorationKey = rowDecorationKey
}

/** Class names may only be built from kinds that are safe as CSS class fragments. */
const CLASS_SAFE_REPLACEMENT_KIND = /^[a-z0-9-]+$/

/**
 * Mirrors the row's inline replacement kinds onto its element as `editor-inline-<kind>` classes, so
 * a replacement provider's stylesheet can restyle whole rows — a markdown heading row turning bold
 * and larger — without the editor knowing any provider's vocabulary. Reveal drops the row's
 * replacements, which drops the classes with them, so a revealed heading renders as plain source.
 */
function updateRowInlineKindClasses(
  row: MountedVirtualizedTextRow,
  mapping: RowInlineMapping | null,
): void {
  const nextClassName = inlineKindClassNames(mapping)
  if (nextClassName === row.inlineKindsClassName) return

  removeClassNames(row.element, row.inlineKindsClassName)
  addClassNames(row.element, nextClassName)
  const mutable = row as { inlineKindsClassName: string }
  mutable.inlineKindsClassName = nextClassName
}

function inlineKindClassNames(mapping: RowInlineMapping | null): string {
  if (!mapping) return ''

  const names = new Set<string>()
  for (const segment of mapping.line.segments) {
    if (segment.kind !== 'replacement') continue
    const replacementKind = segment.replacementKind
    if (!replacementKind || !CLASS_SAFE_REPLACEMENT_KIND.test(replacementKind)) continue
    names.add(`editor-inline-${replacementKind}`)
  }

  return [...names].join(' ')
}

function addClassNames(element: HTMLElement, className: string): void {
  const names = splitClassNames(className)
  if (names.length === 0) return

  element.classList.add(...names)
}

function removeClassNames(element: HTMLElement, className: string): void {
  const names = splitClassNames(className)
  if (names.length === 0) return

  element.classList.remove(...names)
}

function splitClassNames(className: string): string[] {
  return className.split(/\s+/).filter(Boolean)
}

function releaseRowsOutside(
  view: VirtualizedTextViewInternal,
  items: readonly FixedRowVirtualItem[],
): MountedVirtualizedTextRow[] {
  const start = items[0]?.index ?? 0
  const end = (items[items.length - 1]?.index ?? -1) + 1
  const reusableRows: MountedVirtualizedTextRow[] = []
  for (const [index, row] of view.rowElements) {
    if (index >= start && index < end) continue
    invalidateRowPresentations(row.element)
    view.rowElements.delete(index)
    markRowRetired(row)
    reusableRows.push(row)
  }

  return reusableRows
}

function removeReusableRows(
  view: VirtualizedTextViewInternal,
  rows: readonly MountedVirtualizedTextRow[],
  onRemoveSlot: (rowSlotId: number) => void,
): void {
  if (rows.length === 0) return

  for (const row of rows) {
    onRemoveSlot(row.tokenHighlightSlotId)
    view.rowTokenSignatures.delete(row.tokenHighlightSlotId)
    clearHiddenCharactersForRow(row)
  }

  retireRowElements(rows)
  view.rowPool.push(...rows)
}

export function resetContentWidthScan(view: VirtualizedTextViewInternal): void {
  view.contentWidth = 0
  view.maxVisualColumnsSeen = 0
  view.lastWidthScanStart = 0
  view.lastWidthScanEnd = -1
}

export function updateGutterWidthIfNeeded(view: VirtualizedTextViewInternal): void {
  if (!view.gutterWidthDirty) return

  view.gutterWidthDirty = false
  applyGutterWidth(view)
}

function applyGutterWidth(view: VirtualizedTextViewInternal): void {
  const widths = gutterContributionWidthMap(view)
  if (view.disposed) return
  const laneWidth = fixedGutterWidth(view) + totalGutterContributionWidth(widths)
  if (view.disposed) return
  const leadingInset = laneWidth > 0 ? view.gutterLeadingInset : 0
  const nextWidth = leadingInset + laneWidth
  view.currentGutterLeadingInset = leadingInset
  if (view.provisional) {
    view.gutterContributionWidths = widths
    view.currentGutterWidth = nextWidth
    return
  }
  updateGutterContributionWidths(view, widths)

  setGutterLeadingInsetProperty(view, leadingInset)
  setStyleValue(view.scrollElement, '--editor-gutter-width', `${nextWidth}px`)
  if (nextWidth === view.currentGutterWidth) return

  view.currentGutterWidth = nextWidth
  applySpacerWidth(view)
}

/** Left unset at zero, so an editor without an inset carries no trace of the option. */
export function setGutterLeadingInsetProperty(
  view: VirtualizedTextViewInternal,
  inset: number,
): void {
  if (inset > 0) {
    setStyleValue(view.scrollElement, '--editor-gutter-inset', `${inset}px`)
    return
  }
  if (view.scrollElement.style.getPropertyValue('--editor-gutter-inset') === '') return
  view.scrollElement.style.removeProperty('--editor-gutter-inset')
}

function fixedGutterWidth(view: VirtualizedTextViewInternal): number {
  const width = view.gutterWidthProvider?.(gutterWidthContext(view)) ?? 0
  if (!Number.isFinite(width) || width <= 0) return 0
  return Math.ceil(width)
}

function gutterContributionWidthMap(
  view: VirtualizedTextViewInternal,
): ReadonlyMap<string, number> {
  const widths = new Map<string, number>()
  if (view.gutterContributions.length === 0) return widths

  const context = gutterWidthContext(view)
  for (const contribution of view.gutterContributions) {
    widths.set(contribution.id, gutterContributionWidth(contribution, context))
    if (view.disposed) break
  }
  return widths
}

function updateGutterContributionWidths(
  view: VirtualizedTextViewInternal,
  widths: ReadonlyMap<string, number>,
): void {
  if (sameGutterContributionWidths(view.gutterContributionWidths, widths)) return

  view.gutterContributionWidths = widths
  applyGutterContributionWidths(view)
}

function sameGutterContributionWidths(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  if (left.size !== right.size) return false

  for (const [id, width] of right) {
    if (left.get(id) !== width) return false
  }
  return true
}

function applyGutterContributionWidths(view: VirtualizedTextViewInternal): void {
  for (const row of allRows(view)) {
    for (const [id, cell] of row.gutterCells) setCachedGutterCellWidth(view, cell, id)
  }
}

function totalGutterContributionWidth(widths: ReadonlyMap<string, number>): number {
  let total = 0
  for (const width of widths.values()) total += width
  return total
}

function gutterContributionWidth(
  contribution: EditorGutterContribution,
  context: ReturnType<typeof gutterWidthContext>,
): number {
  const width = contribution.width(context)
  if (!Number.isFinite(width) || width <= 0) return 0
  return Math.ceil(width)
}

function gutterWidthContext(view: VirtualizedTextViewInternal): EditorGutterWidthContext {
  return {
    lineCount: view.model.lineCount,
    metrics: view.metrics,
  }
}

export function updateContentWidth(
  view: VirtualizedTextViewInternal,
  items: readonly FixedRowVirtualItem[],
): void {
  const first = items[0]
  const last = items.at(-1)
  if (!first || !last) {
    applyContentWidth(view, view.maxVisualColumnsSeen)
    return
  }

  scanVisualWidthRange(view, first.index, last.index)
  applyContentWidth(view, view.maxVisualColumnsSeen)
}

function scanVisualWidthRange(
  view: VirtualizedTextViewInternal,
  startIndex: number,
  endIndex: number,
): void {
  const overlapsLastScan = rangesIntersectInclusive(
    startIndex,
    endIndex,
    view.lastWidthScanStart,
    view.lastWidthScanEnd,
  )
  if (!overlapsLastScan) {
    scanVisualColumns(view, startIndex, endIndex)
    view.lastWidthScanStart = startIndex
    view.lastWidthScanEnd = endIndex
    return
  }

  if (startIndex < view.lastWidthScanStart) {
    scanVisualColumns(view, startIndex, view.lastWidthScanStart - 1)
  }
  if (endIndex > view.lastWidthScanEnd) {
    scanVisualColumns(view, view.lastWidthScanEnd + 1, endIndex)
  }

  view.lastWidthScanStart = startIndex
  view.lastWidthScanEnd = endIndex
}

function scanVisualColumns(
  view: VirtualizedTextViewInternal,
  startIndex: number,
  endIndex: number,
): void {
  for (let row = startIndex; row <= endIndex; row += 1) {
    view.maxVisualColumnsSeen = Math.max(
      view.maxVisualColumnsSeen,
      estimatedDisplayRowColumns(view, row),
    )
  }
}

// Only document text contributes to the horizontal extent; injected rows are measured for real
// once they mount. A proportional row counts in average-width columns of its measured advances.
function estimatedDisplayRowColumns(view: VirtualizedTextViewInternal, rowIndex: number): number {
  const displayRow = view.model.projection.getRow(rowIndex)
  if (!isDocumentTextDisplayRow(displayRow)) return 0
  const glyphs = view.glyphs
  if (!glyphs) return visualColumnLength(displayRow, view.tabSize)
  const { text } = displayRow
  return pixelsBeforeColumn(text, text.length, glyphs, view.tabSize) / characterWidth(view)
}

function applyContentWidth(view: VirtualizedTextViewInternal, visualColumns: number): void {
  const charWidth = characterWidth(view)
  const width = Math.ceil(Math.max(charWidth, visualColumns * charWidth))
  if (width !== view.contentWidth) view.contentWidth = width

  applySpacerWidth(view)
}

function applySpacerWidth(
  view: VirtualizedTextViewInternal,
  viewportWidth = view.virtualizer.getSnapshot().viewportWidth,
): void {
  view.viewport.setDocumentWidth(spacerWidth(view, viewportWidth))
}

export function updateSpacerWidth(view: VirtualizedTextViewInternal, viewportWidth?: number): void {
  if (view.provisional) return
  applySpacerWidth(view, viewportWidth)
}

export function updateSpacerHeight(
  view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
): void {
  if (view.provisional) return
  applyTotalHeight(view, snapshot)
}

export function spacerWidth(view: VirtualizedTextViewInternal, viewportWidth: number): number {
  return Math.max(viewportWidth, view.contentWidth + gutterWidth(view) + characterWidth(view))
}

export function applyRowHeight(view: VirtualizedTextViewInternal, rowHeight: number): void {
  setStyleValue(view.scrollElement, '--editor-row-height', `${rowHeight}px`)
}

function applyTotalHeight(
  view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
): void {
  const originChanged = view.viewport.setDocumentHeight(
    snapshot.nativeScrollHeight,
    snapshot.nativeScrollTop - snapshot.scrollTop,
    snapshot.scrollTop,
  )
  if (!originChanged) return

  for (const row of view.rowElements.values()) {
    positionRowElement(view, row.element, row.top)
    positionRowElement(view, row.gutterElement, row.top)
  }
  view.lastRenderedRowsKey = ''
}

export function getMountedRows(
  view: VirtualizedTextViewInternal,
): readonly MountedVirtualizedTextRow[] {
  return Array.from(view.rowElements.values()).toSorted((a, b) => a.index - b.index)
}

export function textOffsetFromDomBoundary(
  view: VirtualizedTextViewInternal,
  node: Node,
  offset: number,
): number | null {
  const row = rowFromDomBoundary(view, node)
  if (!row) return null
  if (row.source === 'injected') return null
  const mapped = offsetFromDomBoundary(row, node, offset)
  if (mapped !== null) return mapped
  if (!row.element.contains(node)) return null
  return row.endOffset
}

function rowFromDomBoundary(
  view: VirtualizedTextViewInternal,
  node: Node,
): MountedVirtualizedTextRow | null {
  const element = rowElementFromNode(node, view.scrollElement)
  if (!element) return null

  const rowIndex = Number(element.dataset.editorVirtualRow)
  if (!Number.isInteger(rowIndex)) return null
  return view.rowElements.get(rowIndex) ?? null
}

export function ensureOffsetMounted(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity?: SelectionAffinity,
): void {
  if (resolveMountedOffset(view, offset, affinity)) return

  const row = rowForOptionalAffinity(view, offset, affinity)
  scrollToRow(view, row)
  if (resolveMountedOffset(view, offset, affinity)) return

  scrollHorizontallyToOffset(view, row, offset, affinity)
  syncVirtualizerMetricsFromScrollElement(view)
}

function scrollHorizontallyToOffset(
  view: VirtualizedTextViewInternal,
  row: number,
  offset: number,
  affinity?: SelectionAffinity,
): void {
  const content = lineContent(view, row)
  if (!shouldChunkLine(view, content)) return

  const snapshot = view.virtualizer.getSnapshot()
  const targetLeft = gutterWidth(view) + rowTextLeftForOffset(view, row, offset, affinity)
  const viewportRight = snapshot.scrollLeft + snapshot.viewportWidth
  if (targetLeft >= snapshot.scrollLeft && targetLeft <= viewportRight) return

  view.scrollElement.scrollLeft = Math.max(0, targetLeft - gutterWidth(view))
}

/**
 * Moves the hidden input under the caret.
 *
 * An IME anchors its candidate window on the box of the element being typed into, not on the text
 * the reader can see, so an input parked in a corner of the viewport takes the candidate list there
 * with it — as do the accent and emoji pickers, which never announce themselves through a
 * composition event at all. A caret nobody can see has no box worth pointing at, and an input moved
 * outside the viewport invites the browser to scroll it back into view, so the corner stands in.
 */
export function positionInputAtCaret(
  view: VirtualizedTextViewInternal,
  knownPosition?: VirtualizedCaretPosition | null,
): void {
  if (view.provisional) return
  // The virtualizer's copy of the scroll offsets, never the element's: this runs inside the render
  // pass, where reading scroll back off the DOM is what forces the layout it has just written.
  const snapshot = view.virtualizer.getSnapshot()
  const caret = visibleCaretPosition(view, snapshot, knownPosition)
  // The input hangs off the scroll element rather than the spacer, so it does not come with the
  // offset the spacer is translated by on a document taller than the browser will scroll.
  const spacerOffset = snapshot.nativeScrollTop - snapshot.scrollTop

  const top = caret ? caret.top + spacerOffset : snapshot.nativeScrollTop
  const left = caret ? caret.left : snapshot.scrollLeft
  // Keep caret placement from invalidating layout after the input content was measured.
  setStyleValue(view.inputElement, 'transform', `translate(${left}px, ${top}px)`)
}

/** Null for a caret outside the rows that are mounted, or behind the gutter or the right edge. */
function visibleCaretPosition(
  view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
  knownPosition?: VirtualizedCaretPosition | null,
): { readonly left: number; readonly top: number } | null {
  const position = knownPosition === undefined ? primaryCaretPosition(view) : knownPosition
  if (!position) return null
  if (position.left < snapshot.scrollLeft + gutterWidth(view)) return null
  if (position.left > snapshot.scrollLeft + snapshot.viewportWidth) return null

  return position
}

function primaryCaretPosition(view: VirtualizedTextViewInternal): VirtualizedCaretPosition | null {
  const selection = view.selections[0]
  if (!selection) return null
  return caretPosition(view, selection.head, selection.affinity)?.[0] ?? null
}

export function restoreScrollPosition(
  view: VirtualizedTextViewInternal,
  scrollTop: number,
  scrollLeft: number,
): void {
  if (view.scrollElement.scrollTop === scrollTop && view.scrollElement.scrollLeft === scrollLeft)
    return

  view.scrollElement.scrollTop = scrollTop
  view.scrollElement.scrollLeft = scrollLeft
  syncVirtualizerMetricsFromScrollElement(view)
}

function syncVirtualizerMetricsFromScrollElement(view: VirtualizedTextViewInternal): void {
  const snapshot = view.virtualizer.getSnapshot()
  view.virtualizer.setScrollMetrics({
    scrollTop: view.scrollElement.scrollTop,
    scrollLeft: view.scrollElement.scrollLeft,
    borderBoxHeight: snapshot.borderBoxHeight,
    borderBoxWidth: snapshot.borderBoxWidth,
    viewportHeight: snapshot.viewportHeight,
    viewportWidth: snapshot.viewportWidth,
  })
}

export function scrollOffsetIntoView(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity?: SelectionAffinity,
): void {
  const snapshot = view.virtualizer.getSnapshot()
  const row = rowForOptionalAffinity(view, offset, affinity)
  const top = rowTop(view, row)
  const bottom = top + getRowHeight(view)
  const scrollTop = scrollTopForVisibleRow(view, top, bottom, snapshot)
  const scrollLeft = scrollLeftForVisibleOffset(view, row, offset, snapshot, affinity)
  if (scrollTop === snapshot.scrollTop && scrollLeft === snapshot.scrollLeft) return

  view.scrollElement.scrollTop = scrollTop
  view.scrollElement.scrollLeft = scrollLeft
  syncVirtualizerMetricsFromScrollElement(view)
}

/** The block a reveal acts on, once a conditional one has looked at the viewport. */
export function settledRevealBlock(
  view: VirtualizedTextViewInternal,
  offset: number,
  block: RevealBlock,
  affinity?: SelectionAffinity,
): 'nearest' | 'center' | 'end' {
  if (block !== 'center-if-outside') return block
  // On screen already: 'nearest' still scrolls sideways to a column out of view.
  return offsetRowIsInsideViewport(view, offset, affinity) ? 'nearest' : 'center'
}

/** Whether the row holding the offset is wholly on screen, top to bottom. */
function offsetRowIsInsideViewport(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity?: SelectionAffinity,
): boolean {
  const snapshot = view.virtualizer.getSnapshot()
  const top = rowTop(view, rowForOptionalAffinity(view, offset, affinity))
  return (
    top >= snapshot.scrollTop &&
    top + getRowHeight(view) <= snapshot.scrollTop + snapshot.viewportHeight
  )
}

export function scrollOffsetToViewportBlock(
  view: VirtualizedTextViewInternal,
  offset: number,
  block: 'center' | 'end',
  affinity?: SelectionAffinity,
): void {
  const row = rowForOptionalAffinity(view, offset, affinity)
  let snapshot = view.virtualizer.getSnapshot()
  const space = snapshot.viewportHeight - getRowHeight(view)
  const alignmentOffset = block === 'center' ? space / 2 : space
  const maxScrollTop = Math.max(0, snapshot.totalSize - snapshot.viewportHeight)
  const scrollTop = clamp(rowTop(view, row) - alignmentOffset, 0, maxScrollTop)
  if (scrollTop !== snapshot.scrollTop) {
    view.scrollElement.scrollTop = scrollTop
    syncVirtualizerMetricsFromScrollElement(view)
    snapshot = view.virtualizer.getSnapshot()
  }

  const scrollLeft = scrollLeftForVisibleOffset(view, row, offset, snapshot, affinity)
  if (scrollLeft === snapshot.scrollLeft) return
  view.scrollElement.scrollLeft = scrollLeft
  syncVirtualizerMetricsFromScrollElement(view)
}

function scrollTopForVisibleRow(
  view: VirtualizedTextViewInternal,
  rowTopValue: number,
  rowBottom: number,
  snapshot: FixedRowVirtualizerSnapshot,
): number {
  const viewportTop = snapshot.scrollTop
  const viewportBottom = viewportTop + snapshot.viewportHeight
  const maxScrollTop = Math.max(0, scrollableHeight(view, snapshot) - snapshot.viewportHeight)

  if (rowTopValue < viewportTop) return clamp(rowTopValue, 0, maxScrollTop)
  if (rowBottom > viewportBottom) return clamp(rowBottom - snapshot.viewportHeight, 0, maxScrollTop)
  return viewportTop
}

function scrollLeftForVisibleOffset(
  view: VirtualizedTextViewInternal,
  row: number,
  offset: number,
  snapshot: FixedRowVirtualizerSnapshot,
  affinity?: SelectionAffinity,
): number {
  const caretLeft = gutterWidth(view) + rowTextLeftForOffset(view, row, offset, affinity)
  const caretRight = caretLeft + characterWidth(view)
  const viewportLeft = snapshot.scrollLeft + gutterWidth(view)
  const viewportRight = snapshot.scrollLeft + snapshot.viewportWidth
  if (caretLeft < viewportLeft) return Math.max(0, caretLeft - gutterWidth(view))
  if (caretRight > viewportRight) return Math.max(0, Math.ceil(caretRight - snapshot.viewportWidth))
  return snapshot.scrollLeft
}

function rowTextLeftForOffset(
  view: VirtualizedTextViewInternal,
  rowIndex: number,
  offset: number,
  affinity?: SelectionAffinity,
): number {
  const mounted = view.rowElements.get(rowIndex)
  if (mounted?.kind === 'text' && affinity) {
    return boundaryPositionXsForAffinity(view, mounted, offset, affinity)[0]!
  }
  if (mounted?.kind === 'text') return offsetToX(view, mounted, offset)

  const content = lineContent(view, rowIndex)
  const { text } = content
  const localOffset = clamp(offset - lineStartOffset(view, rowIndex), 0, text.length)
  const column = isSimpleRowText(content)
    ? bufferColumnToVisualColumn(content, localOffset, view.tabSize)
    : estimatedDisplayCellForColumn(content, localOffset, view.tabSize)
  return column * characterWidth(view)
}

export function resolveMountedOffset(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity?: SelectionAffinity,
): { readonly node: Node; readonly offset: number } | null {
  const clamped = clamp(offset, 0, view.model.textLength)
  const targetRow = rowForOptionalAffinity(view, clamped, affinity)
  for (const row of getMountedRows(view)) {
    if (row.index !== targetRow) continue
    const rowOffset = clamp(clamped, row.startOffset, row.endOffset)
    return domBoundaryForOffset(row, rowOffset)
  }

  return null
}

function rowForOptionalAffinity(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity | undefined,
): number {
  if (!affinity) return rowForOffset(view, offset)
  return rowForCaretPosition(view, offset, affinity)
}

export function viewportPointMetrics(
  view: VirtualizedTextViewInternal,
  clientX: number,
  clientY: number,
): {
  readonly x: number
  readonly y: number
  readonly clientX: number
  readonly clientY: number
  readonly verticalDirection: number
  readonly scale: number
} {
  const { left, top, right, bottom, scale } = pointViewport(view.scrollElement)

  return {
    x: viewportTextX(
      view,
      clientX / scale,
      left / scale,
      right / scale,
      view.scrollElement.scrollLeft,
    ),
    y: (clamp(clientY, top, Math.max(top, bottom - 1)) - top) / scale,
    scale,
    clientX,
    clientY,
    verticalDirection: pointVerticalDirection(clientY, top, bottom),
  }
}

function viewportTextX(
  view: VirtualizedTextViewInternal,
  clientX: number,
  left: number,
  right: number,
  scrollLeft: number,
): number {
  const viewportX = clamp(clientX, left, right) - left
  const scrolledX = viewportX + scrollLeft
  return Math.max(0, scrolledX - gutterWidth(view))
}

function pointVerticalDirection(clientY: number, top: number, bottom: number): number {
  if (clientY < top) return -1
  if (clientY >= bottom) return 1
  return 0
}

export function scrollToRow(view: VirtualizedTextViewInternal, row: number): void {
  const target = clamp(Math.floor(row), 0, visibleLineCount(view) - 1)
  view.scrollElement.scrollTop = rowTop(view, target)
  syncVirtualizerMetricsFromScrollElement(view)
}

function characterWidth(view: VirtualizedTextViewInternal): number {
  return Math.max(1, view.metrics.characterWidth)
}

export function gutterWidth(view: VirtualizedTextViewInternal): number {
  return view.currentGutterWidth
}

export function caretPosition(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity,
): VirtualizedCaretPositions | null {
  const rowIndex = rowForCaretPosition(view, offset, affinity)
  const row = view.rowElements.get(rowIndex)
  if (!row) return null

  const xs = boundaryPositionXsForAffinity(view, row, offset, affinity)
  const primary = caretPositionAtX(view, row, xs[0] ?? offsetToX(view, row, offset))
  const secondaryX = xs[1]
  if (secondaryX === undefined) return [primary]
  return [primary, caretPositionAtX(view, row, secondaryX)]
}

function caretPositionAtX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
): VirtualizedCaretPosition {
  return {
    left: gutterWidth(view) + x,
    top: row.top,
    height: row.height,
  }
}

export function pageRowDelta(view: VirtualizedTextViewInternal): number {
  const { viewportHeight } = view.virtualizer.getSnapshot()
  return Math.max(1, Math.floor(viewportHeight / rowStride(view)) - 1)
}

function rowStride(view: VirtualizedTextViewInternal): number {
  return getRowHeight(view) + view.rowGap
}

/** The row pool owns these nodes; provisional slots never enter the document row map. */
export function paintProvisionalRows(
  view: VirtualizedTextViewInternal,
  paint: SavedPaint,
): (() => void) | null {
  const slots: MountedVirtualizedTextRow[] = []
  for (const row of view.rowElements.values()) {
    invalidateRowPresentations(row.element)
    markRowRetired(row)
    row.element.remove()
    row.gutterElement.remove()
    view.rowPool.push(row)
  }
  view.rowElements.clear()
  for (const row of paint.rows) {
    const slot = view.rowPool.pop() ?? createRow(view)
    if (slot) slots.push(slot)
    if (slot && paintProvisionalRow(view, slot, row, paint)) continue
    for (const created of slots) releaseProvisionalSlot(view, created)
    return null
  }
  const rectangles = paint.layers.flatMap((layer) =>
    layer.rectangles.map((rectangle) => {
      const element = view.scrollElement.ownerDocument.createElement('div')
      element.dataset.editorSavedPaintLayer = layer.id
      element.style.zIndex = '1'
      Object.assign(element.style, {
        position: 'absolute',
        pointerEvents: 'none',
        left: `${rectangle.left}px`,
        top: `${rectangle.top}px`,
        width: `${rectangle.width}px`,
        height: `${rectangle.height}px`,
        backgroundColor: rectangle.backgroundColor,
      })
      view.spacer.appendChild(element)
      return element
    }),
  )
  return () => {
    for (const rectangle of rectangles) rectangle.remove()
    for (const slot of slots) releaseProvisionalSlot(view, slot)
  }
}

function paintProvisionalRow(
  view: VirtualizedTextViewInternal,
  slot: MountedVirtualizedTextRow,
  row: SavedPaintRow,
  paint: SavedPaint,
): boolean {
  slot.element.className = 'editor-virtualized-row'
  slot.gutterElement.className = 'editor-virtualized-gutter-row'
  gutterCursorLineBandStates.delete(slot.gutterElement)
  delete slot.element.dataset.editorVirtualWindowStart
  delete slot.element.dataset.editorVirtualWindowEnd
  slot.element.classList.toggle('editor-virtualized-cursor-line-row', row.cursor)
  slot.element.removeAttribute('data-editor-virtual-row')
  slot.element.dataset.editorProvisionalRow = ''
  Object.assign(slot.element.style, {
    top: `${row.top}px`,
    backgroundColor: row.backgroundColor,
    color: row.color,
    transform: '',
    height: `${row.height}px`,
    lineHeight: `${row.height}px`,
    left: `${paint.gutterWidth}px`,
    minWidth: `${Math.max(0, paint.scrollWidth - paint.gutterWidth)}px`,
  })
  slot.element.replaceChildren()
  if (row.left > 0) {
    slot.leftSpacerElement.style.width = `${row.left}px`
    slot.element.appendChild(slot.leftSpacerElement)
  }
  for (const segment of row.segments) {
    const span = view.scrollElement.ownerDocument.createElement('span')
    span.textContent = segment.text
    span.style.position = 'relative'
    span.style.zIndex = '2'
    if (segment.kind === 'control') span.className = 'editor-virtualized-control-character'
    if (segment.kind === 'refusal') span.className = 'editor-virtualized-bidi-ceiling'
    if (segment.width > 0) span.style.width = `${segment.width}px`
    Object.assign(span.style, {
      color: segment.color,
      backgroundColor: segment.backgroundColor,
      textDecoration: segment.textDecoration,
    })
    slot.element.appendChild(span)
  }
  if (row.fold === 'collapsed') {
    slot.foldPlaceholderElement.hidden = false
    slot.element.appendChild(slot.foldPlaceholderElement)
  }
  if (!paintProvisionalGutter(view, slot, row, paint)) return false
  view.spacer.appendChild(slot.element)
  return true
}

function paintProvisionalGutter(
  view: VirtualizedTextViewInternal,
  slot: MountedVirtualizedTextRow,
  row: SavedPaintRow,
  paint: SavedPaint,
): boolean {
  slot.gutterElement.removeAttribute('data-editor-virtual-gutter-row')
  Object.assign(slot.gutterElement.style, {
    top: `${row.top}px`,
    transform: '',
    height: `${row.height}px`,
  })
  for (const lane of paint.gutterLayout.lanes) {
    const cell = slot.gutterCells.get(lane.id)
    if (!cell) return false
    cell.style.width = `${lane.width}px`
    cell.classList.toggle(
      'editor-virtualized-cursor-line-gutter',
      row.activeLanes.includes(lane.id),
    )
    const renderer = view.gutterContributions.find(
      (contribution) => contribution.id === lane.id,
    )?.snapshotRenderer
    const savedCell = row.gutterCells.find((saved) => saved.id === lane.id)
    if (!renderer || !savedCell || !restoreSavedGutter(renderer, cell, savedCell.paint))
      return false
  }
  setCursorLineGutterBand(
    slot.gutterElement,
    paint.gutterLayout.leadingInset > 0 &&
      view.cursorLineHighlight.gutterBackground === true &&
      row.activeLanes.length > 0,
  )
  slot.gutterElement.style.backgroundColor = row.gutterBackgroundColor
  view.gutterElement.appendChild(slot.gutterElement)
  return true
}

function restoreSavedGutter(
  renderer: NonNullable<EditorGutterContribution['snapshotRenderer']>,
  cell: HTMLElement,
  paint: string,
): boolean {
  try {
    return renderer.restore(cell, paint)
  } catch {
    return false
  }
}

function releaseProvisionalSlot(
  view: VirtualizedTextViewInternal,
  slot: MountedVirtualizedTextRow,
): void {
  slot.element.remove()
  slot.gutterElement.remove()
  slot.element.removeAttribute('data-editor-provisional-row')
  slot.element.removeAttribute('style')
  slot.gutterElement.removeAttribute('style')
  slot.element.className = 'editor-virtualized-row'
  slot.gutterElement.className = 'editor-virtualized-gutter-row'
  gutterCursorLineBandStates.delete(slot.gutterElement)
  delete slot.element.dataset.editorVirtualWindowStart
  delete slot.element.dataset.editorVirtualWindowEnd
  slot.textNode.data = ''
  slot.element.replaceChildren(slot.textNode)
  slot.foldPlaceholderElement.hidden = true
  Object.assign(slot, {
    index: -1,
    textRevision: -1,
    text: '',
    inlineMapping: null,
    chunks: [],
    chunkKey: '',
    geometryCache: null,
    top: Number.NaN,
    height: Number.NaN,
    leftSpacerWidth: 0,
    textRenderMode: 'simple',
    cursorLineContentActive: false,
    gutterNumberCursorLine: false,
    gutterCursorLineBackgroundLaneIds: [],
    selectionLayerKey: '',
    hiddenCharactersKey: '',
    foldMarkerKey: '',
    foldCollapsed: false,
    rowDecorationClassName: '',
    rowDecorationGutterClassName: '',
    rowDecorationKey: '',
    rowDecorationSnapshotStyle: false,
    inlineKindsClassName: '',
  })
  view.rowPool.push(slot)
}

export function captureGutterPaint(
  view: VirtualizedTextViewInternal,
): readonly SavedPaintRow['gutterCells'][] | null {
  const captured: SavedPaintRow['gutterCells'][] = []
  for (const row of getMountedRows(view)) {
    const cells = captureRowGutterPaint(view, row)
    if (cells === null) return null
    captured.push(cells)
  }
  return captured
}

function captureRowGutterPaint(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): SavedPaintRow['gutterCells'] | null {
  const cells: { id: string; paint: string }[] = []
  for (const contribution of view.gutterContributions) {
    const cell = row.gutterCells.get(contribution.id)
    const paint = cell && contribution.snapshotRenderer?.capture(cell)
    if (paint === undefined || paint === null) return null
    cells.push({ id: contribution.id, paint })
  }
  return cells
}
