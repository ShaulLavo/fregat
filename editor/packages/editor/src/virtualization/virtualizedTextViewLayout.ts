import type { TextContent } from '../textContent'
import type { MeasuredText } from '../textMeasurements'
import type { FoldMap } from '../foldMap'
import {
  bufferColumnToVisualColumn,
  isDocumentTextDisplayRow,
  visualColumnToBufferColumn,
  type InjectedTextRow,
} from '../displayTransforms'
import { getPieceTreeSnapshot, type TextSnapshot } from '../documentTextSnapshot'
import { updateInlineMapForEdit } from '../inlineMap'
import type { SelectionAffinity } from '../selections'
import type { TextEdit } from '../tokens'
import type { TextEditBatch } from '../textEditBatch'
import type { DisplayProjectionTransition, WrapAdvance } from './displayProjectionTypes'
import { PROPORTIONAL_WRAP_MARGIN_PX } from './glyphAdvances'
import { clamp } from '../style-utils'
import {
  foldMapMatchesText,
  foldMarkersEqual,
  inlineMapMatchesText,
  indexFoldMarkersByKey,
  indexFoldMarkersByStartRow,
  normalizeFoldMarkers,
  normalizeRowHeight,
} from './virtualizedTextViewHelpers'
import type { FixedRowVirtualizerSnapshot } from './fixedRowVirtualizer'
import type {
  MultiLineEditPatch,
  SameLineEditPatch,
  VirtualizedFoldMarker,
} from './virtualizedTextViewTypes'
import type { VirtualizedTextViewInternal } from './virtualizedTextViewInternals'
import {
  localIndexForOffset,
  offsetForLocalIndex,
  rowInlineMappingForDisplayRow,
} from './virtualizedTextViewInlineMapping'

export type FoldStateUpdate = {
  readonly foldMapChanged: boolean
  readonly foldMarkersChanged: boolean
  readonly changed: boolean
}

export function setTextLayoutState(
  view: VirtualizedTextViewInternal,
  textSnapshot: TextSnapshot,
  preparedLineStarts?: readonly number[],
): { readonly lineCountChanged: boolean } {
  if (preparedLineStarts) assertPreparedLineStarts(textSnapshot.length, preparedLineStarts)
  return setTextSnapshotLayoutState(view, textSnapshot)
}

function assertPreparedLineStarts(snapshotLength: number, lineStarts: readonly number[]): void {
  const environment = (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } })
    .env
  if (!environment?.DEV) return

  if (preparedLineStartsAreValid(snapshotLength, lineStarts)) return

  throw new RangeError('Prepared line starts do not match the attached document')
}

function preparedLineStartsAreValid(
  snapshotLength: number,
  lineStarts: readonly number[],
): boolean {
  if (lineStarts[0] !== 0) return false

  let previous = -1
  for (const lineStart of lineStarts) {
    if (!Number.isSafeInteger(lineStart)) return false
    if (lineStart <= previous) return false
    previous = lineStart
  }
  return previous <= snapshotLength
}

function setTextSnapshotLayoutState(
  view: VirtualizedTextViewInternal,
  textSnapshot: TextSnapshot,
): { readonly lineCountChanged: boolean } {
  const previousLineCount = view.model.lineCount
  view.model.textSnapshot = textSnapshot
  view.model.textLength = textSnapshot.length
  view.textRevision += 1
  view.model.lineCount = textSnapshot.lineCount
  view.model.foldMap = foldMapMatchesText(view.model.foldMap, textSnapshot.length)
    ? view.model.foldMap
    : null
  view.model.inlineMap = inlineMapMatchesText(view.model.inlineMap, textSnapshot.length)
    ? view.model.inlineMap
    : null
  return { lineCountChanged: previousLineCount !== textSnapshot.lineCount }
}

export function applyTextLayoutTransition(
  view: VirtualizedTextViewInternal,
  transition: DisplayProjectionTransition | TextEditBatch,
): void {
  const { after: textSnapshot, edits } = transition
  const base = view.inlineMapBase
  const renderedInlineMap = view.model.inlineMap
  view.model.projection.update(transition)
  view.model.textSnapshot = textSnapshot
  view.model.textLength = textSnapshot.length
  view.model.lineCount = textSnapshot.lineCount
  view.model.visibleLineCount = view.model.projection.rowCount
  view.model.foldMap = view.model.projection.config.foldMap
  view.model.inlineMap = view.model.projection.config.inlineMap
  const snapshot = getPieceTreeSnapshot(textSnapshot)
  const edit = edits[0]
  if (base === renderedInlineMap) view.inlineMapBase = view.model.inlineMap
  if (base !== renderedInlineMap && base) {
    view.inlineMapBase = snapshot && edit ? updateInlineMapForEdit(base, edit, snapshot).map : null
  }
  view.model.injectedTextRows = view.model.projection.config.injectedTextRows
  view.textRevision += 1
  view.displayProjectionRevision += 1
}

export function setFoldStateLayout(
  view: VirtualizedTextViewInternal,
  markers: readonly VirtualizedFoldMarker[],
  foldMap: FoldMap | null,
): FoldStateUpdate {
  const nextFoldMap = foldMapMatchesText(foldMap, view.model.textLength) ? foldMap : null
  const foldMapChanged = view.model.foldMap !== nextFoldMap
  if (
    !foldMapChanged &&
    view.foldMarkerSource === null &&
    markers.length === 0 &&
    view.foldMarkerByStartRow.size === 0
  ) {
    return { foldMapChanged: false, foldMarkersChanged: false, changed: false }
  }

  const nextFoldMarkers = normalizeFoldMarkers(markers, view.model.textLength)
  const foldMarkersChanged =
    view.foldMarkerSource !== null || !foldMarkersEqual(view.foldMarkers, nextFoldMarkers)
  if (!foldMapChanged && !foldMarkersChanged) {
    return { foldMapChanged: false, foldMarkersChanged: false, changed: false }
  }

  if (foldMarkersChanged) {
    view.foldMarkerSource = null
    view.foldMarkers = nextFoldMarkers
    view.foldMarkerByStartRow = indexFoldMarkersByStartRow(nextFoldMarkers)
    view.foldMarkerByKey = indexFoldMarkersByKey(nextFoldMarkers)
  }

  view.model.foldMap = nextFoldMap
  return { foldMapChanged, foldMarkersChanged, changed: true }
}

export function refreshDisplayProjection(
  view: VirtualizedTextViewInternal,
  viewportColumns: number | null,
  viewportWidth = view.virtualizer.getSnapshot().viewportWidth,
): void {
  view.wrapAdvance = proportionalWrapAdvance(view, viewportWidth)
  view.model.projection.reconfigure({
    textSnapshot: view.model.textSnapshot,
    foldMap: view.model.foldMap,
    inlineMap: view.model.inlineMap,
    injectedTextRows: view.model.injectedTextRows,
    wrapColumn: view.wrapEnabled ? viewportColumns : null,
    wrapBreak: view.wrapBreak,
    wrapAdvance: view.wrapAdvance,
    tabSize: view.tabSize,
  })
  view.model.wrapColumn = view.wrapEnabled ? viewportColumns : null
  view.model.tabSize = view.tabSize
  view.model.visibleLineCount = view.model.projection.rowCount
  view.displayProjectionRevision += 1
}

export function refreshDisplayProjectionForWrapWidth(
  view: VirtualizedTextViewInternal,
  viewportColumns: number,
  viewportWidth: number,
): boolean {
  if (!view.wrapEnabled) return false
  const advance = proportionalWrapAdvance(view, viewportWidth)
  if (viewportColumns === view.model.wrapColumn && advance === view.wrapAdvance) return false

  refreshDisplayProjection(view, viewportColumns, viewportWidth)
  return true
}

/**
 * Wrap by measured advances once the face is not monospace, where columns place breaks a glyph or
 * more from the edge. The same object comes back while width and face hold, so the projection can
 * tell a real change by identity.
 */
function proportionalWrapAdvance(
  view: VirtualizedTextViewInternal,
  viewportWidth: number,
): WrapAdvance | null {
  const glyphs = view.glyphs
  if (!view.wrapEnabled || !glyphs || viewportWidth <= 0) return null
  const width = Math.max(1, viewportWidth - view.currentGutterWidth - PROPORTIONAL_WRAP_MARGIN_PX)
  const current = view.wrapAdvance
  if (current && current.width === width && current.glyphs === glyphs) return current

  return { width, glyphs, advance: (codePoint) => glyphs.advance(codePoint) }
}

export function setWrapEnabledLayout(
  view: VirtualizedTextViewInternal,
  enabled: boolean,
  viewportColumns: number | null,
): boolean {
  if (view.wrapEnabled === enabled) return false

  view.wrapEnabled = enabled
  view.model.wrapColumn = null
  refreshDisplayProjection(view, viewportColumns)
  return true
}

export function setInjectedTextRowsLayout(
  view: VirtualizedTextViewInternal,
  injectedTextRows: readonly InjectedTextRow[],
  viewportColumns: number | null,
): void {
  view.model.injectedTextRows = injectedTextRows
  refreshDisplayProjection(view, viewportColumns)
}

export function updateVirtualizerRows(view: VirtualizedTextViewInternal): void {
  const changed = view.virtualizer.updateOptions({
    count: visibleLineCount(view),
    rowGap: view.rowGap,
    rowHeight: getRowHeight(view),
  })
  if (!changed && view.lastRenderedRowsKey === '') view.virtualizer.refresh()
}

export function rowTop(view: VirtualizedTextViewInternal, row: number): number {
  return row * rowStride(view)
}

export function scrollableHeight(
  _view: VirtualizedTextViewInternal,
  snapshot: FixedRowVirtualizerSnapshot,
): number {
  return snapshot.scrollHeight
}

export function visualColumnForOffset(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity?: SelectionAffinity,
): number {
  const row = affinity ? rowForCaretPosition(view, offset, affinity) : rowForOffset(view, offset)
  return visualColumnForDisplayRowOffset(view, row, offset)
}

function visualColumnForDisplayRowOffset(
  view: VirtualizedTextViewInternal,
  row: number,
  offset: number,
): number {
  const displayRow = view.model.projection.getRow(row)
  if (!isDocumentTextDisplayRow(displayRow)) return 0

  const localOffset = clamp(
    localIndexForOffset(
      rowInlineMappingForDisplayRow(displayRow),
      lineStartOffset(view, row),
      offset,
    ),
    0,
    displayRow.text.length,
  )
  return bufferColumnToVisualColumn(displayRow, localOffset, view.tabSize)
}

export function offsetForViewportColumn(
  view: VirtualizedTextViewInternal,
  row: number,
  visualColumn: number,
): number {
  const displayRow = view.model.projection.getRow(row)
  if (!displayRow) return view.model.textLength
  const startOffset = lineStartOffset(view, row)
  if (!isDocumentTextDisplayRow(displayRow)) return startOffset

  const bufferColumn = visualColumnToBufferColumn(displayRow, visualColumn, 'nearest', view.tabSize)
  return offsetForLocalIndex(
    rowInlineMappingForDisplayRow(displayRow),
    startOffset,
    clamp(bufferColumn, 0, displayRow.text.length),
  )
}

export function lineStartOffset(view: VirtualizedTextViewInternal, row: number): number {
  return view.model.projection.getRowMetrics(row)?.startOffset ?? view.model.textLength
}

export function lineEndOffset(view: VirtualizedTextViewInternal, row: number): number {
  return view.model.projection.getRowMetrics(row)?.endOffset ?? view.model.textLength
}

export function bufferLineStartOffset(view: VirtualizedTextViewInternal, row: number): number {
  if (row < 0) return view.model.textLength
  return view.model.textSnapshot.lineStart(row)
}

export function lineText(view: VirtualizedTextViewInternal, row: number): TextContent {
  return view.model.projection.getRow(row)?.text ?? ''
}

const EMPTY_TEXT_CONTENT = { text: '' }
export function lineContent(view: VirtualizedTextViewInternal, row: number): MeasuredText {
  return view.model.projection.getRow(row) ?? EMPTY_TEXT_CONTENT
}

function lineBreakCount(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') count += 1
  }
  return count
}

export function sameLineEditPatch(
  view: VirtualizedTextViewInternal,
  edit: TextEdit,
): SameLineEditPatch | null {
  if (!view.model.projection.supportsIncrementalRowPatch) return null
  if (edit.from < 0 || edit.to < edit.from || edit.to > view.model.textLength) return null
  if (edit.text.includes('\n')) return null

  const rowIndex = bufferRowForOffset(view, edit.from)
  if (rowIndex !== bufferRowForOffset(view, edit.to)) return null
  return {
    rowIndex,
    localFrom: edit.from - lineStartOffset(view, rowIndex),
    deleteLength: edit.to - edit.from,
    text: edit.text,
  }
}

export function multiLineEditPatch(
  view: VirtualizedTextViewInternal,
  edit: TextEdit,
): MultiLineEditPatch | null {
  if (!view.model.projection.supportsIncrementalRowPatch) return null
  const patch = sourceEditPatch(view, edit)
  if (!patch) return null
  if (patch.insertedLineBreaks === 0 && patch.startRow === patch.endRow) return null
  return patch
}

export function sourceEditPatch(
  view: VirtualizedTextViewInternal,
  edit: TextEdit,
): MultiLineEditPatch | null {
  if (edit.from < 0 || edit.to < edit.from || edit.to > view.model.textLength) return null

  const startRow = bufferRowForOffset(view, edit.from)
  const endRow = bufferRowForOffset(view, edit.to)
  return {
    startRow,
    endRow,
    insertedLineBreaks: lineBreakCount(edit.text),
    delta: edit.text.length - (edit.to - edit.from),
  }
}

export function rowForOffset(view: VirtualizedTextViewInternal, offset: number): number {
  return view.model.projection.rowForOffset(offset, 'before')
}

export function rowForCaretPosition(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity,
): number {
  return view.model.projection.rowForOffset(offset, affinity)
}

export function bufferRowForOffset(view: VirtualizedTextViewInternal, offset: number): number {
  return view.model.textSnapshot.lineAt(offset)
}

export function rowForViewportY(view: VirtualizedTextViewInternal, y: number): number {
  return fixedRowForOffset(view, view.scrollElement.scrollTop + y)
}

export function visibleLineCount(view: VirtualizedTextViewInternal): number {
  return Math.max(1, view.model.visibleLineCount)
}

export function bufferRowForVirtualRow(
  view: VirtualizedTextViewInternal,
  row: number,
): number | null {
  return view.model.projection.bufferRowForRow(row)
}

export function virtualRowForBufferRow(view: VirtualizedTextViewInternal, row: number): number {
  return view.model.projection.rowForBufferRow(row)
}

export function getRowHeight(view: VirtualizedTextViewInternal): number {
  return normalizeRowHeight(view.metrics.rowHeight)
}

function rowStride(view: VirtualizedTextViewInternal): number {
  return getRowHeight(view) + view.rowGap
}

function fixedRowForOffset(view: VirtualizedTextViewInternal, offset: number): number {
  const rowHeight = getRowHeight(view)
  const stride = rowHeight + view.rowGap
  const row = clamp(Math.floor(offset / stride), 0, visibleLineCount(view) - 1)
  const rowBottom = row * stride + rowHeight
  if (offset < rowBottom) return row

  return Math.min(row + 1, visibleLineCount(view) - 1)
}
