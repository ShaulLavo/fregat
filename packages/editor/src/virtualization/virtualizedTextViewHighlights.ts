import {
  type HighlightOverlay,
  type HighlightOverlayRange,
  buildHighlightOverlayMask,
  splitHighlightOverlay,
  overlayColorStyle,
  validateHighlightOverlay,
} from './highlightOverlay'
import { EditorTokenStore, toEditorTokenStore, type EditorTokenInput } from '../syntax/tokenStore'
import type { EditorTokenStyle } from '../tokens'
import type { SelectionAffinity } from '../selections'
import {
  editorPerformanceDiagnosticsEnabled,
  recordEditorPerformanceDiagnostic,
} from '../editor/performanceDiagnostics'
import { scheduleFrame } from '../editor/scheduleFrame'
import { tokenProjectionLiveRangeStatus } from '../editor/tokenProjection'
import { clamp, normalizeTokenStyle, serializeTokenStyle } from '../style-utils'
import { lowerBound, upperBound } from './rowHeightIndex'
import { getSharedTokenHighlights, SHARED_TOKEN_HIGHLIGHT_PREFIX } from './sharedTokenHighlights'
import { rowLocalIndexForOffset } from './virtualizedTextViewInlineMapping'
import { reregisterHighlights, scheduleHighlightRepaintNudge } from './geckoHighlightRepaint'
import {
  addTokenRangeToChunk,
  appendTokenRange,
  appendTokenSegmentForChunk,
  getOrCreateTokenSegments,
  setElementHidden,
  setStyleValue,
  type TokenSegmentAppendResult,
  tokenRowSignature,
} from './virtualizedTextViewHelpers'
import {
  caretPosition,
  cursorLineBufferRow,
  cursorLineVirtualRow,
  getMountedRows,
  positionInputAtCaret,
  refreshCursorLineRows,
} from './virtualizedTextViewRows'
import { renderHiddenCharacters } from './virtualizedTextViewHiddenCharacters'
import { clearSelectionLayer, renderSelectionLayer } from './virtualizedTextViewSelectionLayer'
import { createDomRangeForChunkRange } from './virtualizedTextViewGeometry'
import type {
  MountedVirtualizedTextRow,
  TokenGroup,
  TokenRowSegment,
  HighlightRegistry,
  VirtualizedTextChunk,
  VirtualizedCaretPosition,
} from './virtualizedTextViewTypes'
import type {
  SameLineTokenEdit,
  VirtualizedTextHighlightGroup,
  VirtualizedTextHighlightRange,
  VirtualizedTextHighlightStyle,
  VirtualizedStoredSelection,
  VirtualizedTextSelection,
  VirtualizedTextViewInternal,
} from './virtualizedTextViewInternals'

type OverlayPaintGroup = VirtualizedTextHighlightGroup & { ranges: VirtualizedTextHighlightRange[] }

type TokenRenderStyle = {
  readonly style: EditorTokenStyle
  readonly styleKey: string
}

type TokenSegmentBuildStats = {
  addedSegmentCount: number
  adjacentMergedSegmentCount: number
  chunkCount: number
  gapMergedSegmentCount: number
  mergedSegmentCount: number
  rawSegmentCount: number
  readonly rowCount: number
  tokenScanCount: number
}

type TokenRangeAddResult = {
  readonly addedRangeCount: number
  readonly liveRangeCount: number
  readonly staticRangeCount: number
  readonly styleRulesDirty: boolean
}

type TokenRangeReconcileStats = {
  addedRangeCount: number
  deletedRangeCount: number
  liveRangeCount: number
  readonly mountedRowCount: number
  rebuiltRowCount: number
  skippedRowCount: number
  staticRangeCount: number
  readonly tokenPaletteDirty: boolean
}

type RangeHighlightIndex = {
  readonly fingerprint: number
  /**
   * Running maximum of `end`. A range nested inside an earlier one leaves the raw ends out of
   * order even where the starts are sorted, and a bisection needs a key that only ever grows.
   */
  readonly maxEnds: readonly number[]
}

const SIGNATURE_HASH_PRIME = 0x01000193
const SIGNATURE_HASH_SEED = 0x811c9dc5

/**
 * Keyed by the range array rather than by the group, because a group holds one such array for as
 * long as the set it was given stays current — so identity is already the invalidation rule, and a
 * retired set takes its index with it.
 */
const rangeHighlightIndexes = new WeakMap<
  readonly VirtualizedTextHighlightRange[],
  RangeHighlightIndex
>()

export function setTokens(view: VirtualizedTextViewInternal, tokens: EditorTokenInput): void {
  adoptTokens(view, toEditorTokenStore(tokens))
}

export function adoptTokens(view: VirtualizedTextViewInternal, tokens: EditorTokenStore): void {
  if (view.highlightOverlaySnapshot && view.highlightOverlaySnapshot !== view.model.textSnapshot) {
    installTokens(view, tokens)
    view.sameLineTokenEdit = null
    view.tokenProjectionDirtyStartRow = null
    refreshHighlightOverlayMask(view)
    return
  }
  const projectionStatus = tokenProjectionLiveRangeStatus(view.tokens, tokens)
  if (projectionStatus === true && !view.sameLineTokenEdit) {
    installTokens(view, tokens)
    if (view.rowTokenRanges.size === 0 && tokens.length > 0) renderTokenHighlights(view)
    return
  }

  if (canKeepLiveTokenRanges(view, tokens, projectionStatus)) {
    installTokens(view, tokens)
    reconcileTokenHighlightsAfterSameLineEdit(view)
    return
  }

  if (view.tokens === tokens) {
    if (view.rowTokenRanges.size === 0 && tokens.length > 0) renderTokenHighlights(view)
    return
  }

  if (projectionStatus !== null) {
    adoptChangedTokens(view, tokens)
    return
  }

  view.tokenProjectionDirtyStartRow = null
  if (view.tokens.equals(tokens)) {
    view.sameLineTokenEdit = null
    installTokens(view, tokens)
    renderTokenHighlights(view)
    return
  }

  adoptChangedTokens(view, tokens)
}

function adoptChangedTokens(view: VirtualizedTextViewInternal, tokens: EditorTokenStore): void {
  const pendingEdit = takeSameLineTokenEdit(view)
  const dirtyStartRow = view.tokenProjectionDirtyStartRow
  installTokens(view, tokens)
  if (pendingEdit) {
    reconcileTokenHighlightsFromRow(
      view,
      dirtyTokenProjectionStartRow(dirtyStartRow, pendingEdit.rowIndex),
      dirtyStartRow !== null,
    )
    return
  }

  view.tokenProjectionDirtyStartRow = null
  renderTokenHighlights(view)
}

// A palette only changes by growing or being replaced, so its identity says when groups are stale.
function installTokens(view: VirtualizedTextViewInternal, tokens: EditorTokenStore): void {
  if (view.tokens.styles !== tokens.styles) view.tokenPaletteDirty = true
  view.tokens = tokens
}

export function setSelection(
  view: VirtualizedTextViewInternal,
  anchorOffset: number,
  headOffset: number,
  affinity: SelectionAffinity = 'after',
): void {
  setSelections(view, [{ anchorOffset, headOffset, affinity }])
}

export function setSelections(
  view: VirtualizedTextViewInternal,
  selections: readonly VirtualizedTextSelection[],
): void {
  const previousCursorLine = cursorLineBufferRow(view)
  const previousCursorRow = cursorLineVirtualRow(view)
  const stored = selections.map((selection) => clampSelection(view, selection))
  view.selections = stored
  setPrimarySelection(view, stored[0] ?? null)
  renderSelectionHighlight(view)
  renderHiddenCharacters(view)
  refreshCursorLineRows(view, previousCursorLine, previousCursorRow)
}

export function clearSelection(view: VirtualizedTextViewInternal): void {
  const previousCursorLine = cursorLineBufferRow(view)
  const previousCursorRow = cursorLineVirtualRow(view)
  view.selectionStart = null
  view.selectionEnd = null
  view.selectionHead = null
  view.selections = []
  clearSelectionHighlight(view)
  renderHiddenCharacters(view)
  renderCaret(view)
  refreshCursorLineRows(view, previousCursorLine, previousCursorRow)
}

export function renderSelectionHighlight(view: VirtualizedTextViewInternal): void {
  if (view.provisional) return
  renderCaret(view)
  if (!hasSelectionRanges(view.selections)) {
    clearSelectionHighlight(view)
    return
  }
  renderSelectionLayer(view)
}

export function clearSelectionHighlight(view: VirtualizedTextViewInternal): void {
  clearSelectionLayer(view)
  view.lastSelectionHighlightSignature = ''
  if (!view.selectionHighlightRegistered || !view.highlightRegistry) return

  view.highlightRegistry.delete(view.selectionHighlightName)
  view.selectionHighlightRegistered = false
}

export function setRangeHighlight(
  view: VirtualizedTextViewInternal,
  name: string,
  ranges: readonly VirtualizedTextHighlightRange[],
  style: VirtualizedTextHighlightStyle,
): void {
  validateRangeHighlightStyle(style)
  if (ranges.length === 0) {
    emptyRangeHighlight(view, name)
    return
  }

  const previousOverlay = view.rangeHighlightGroups.get(name)?.style.overlay
  const nextRanges = sortedRangeHighlights(view, ranges)
  const group = getOrCreateRangeHighlightGroup(view, name, style)
  // Equal-priority highlights paint in registry order, which we cannot keep stable across mount
  // cycles, so the declared stacking is mirrored onto the Highlight itself.
  group.highlight.priority = (style.zIndex ?? 0) - (style.color ? 0 : 100)
  if (canSkipRangeHighlightUpdate(view, group, nextRanges, style)) return

  if (!sameHighlightStyle(group.style, style)) view.rangeHighlightRuleVersion += 1
  group.ranges = nextRanges
  group.style = style
  group.signature = staleRangeHighlightSignature()
  if (style.overlay || previousOverlay) {
    refreshHighlightOverlayMask(view)
    return
  }
  prepareRangeHighlightTwins(view, group)
  renderRangeHighlight(view, name)
  rebuildStyleRules(view)
}

// An emptied group keeps its rule, so only a style change rewrites the view's <style>. Occurrence
// highlights empty and refill every few keys; dropping the rule restyled every mounted row each time.
function emptyRangeHighlight(view: VirtualizedTextViewInternal, name: string): void {
  const group = view.rangeHighlightGroups.get(name)
  if (!group || group.ranges.length === 0) return

  group.ranges = []
  group.signature = staleRangeHighlightSignature()
  if (group.style.overlay) {
    refreshHighlightOverlayMask(view)
    return
  }
  prepareRangeHighlightTwins(view, group)
  renderRangeHighlight(view, name)
  rebuildStyleRules(view)
}

export function renderRangeHighlight(view: VirtualizedTextViewInternal, name: string): void {
  if (view.provisional) return
  const group = view.rangeHighlightGroups.get(name)
  if (!group || !view.highlightRegistry) return
  if (group.style.overlay) {
    for (const base of view.overlayBaseGroups.values()) renderPaintGroup(view, base)
    return
  }
  renderPaintGroup(view, group)
  for (const twin of group.twins?.values() ?? []) renderPaintGroup(view, twin)
}

function renderPaintGroup(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  const signature = rangeHighlightSignature(view, group)
  if (signature === group.signature) return

  group.signature = signature
  group.highlight.clear()
  addMountedRangeHighlightRanges(view, group)
  // Find/diagnostic range highlights swap StaticRanges over recycled rows the
  // same way token highlights do, so they need the same Gecko repaint nudge.
  scheduleHighlightRepaintNudge(view.highlightRegistry)
  // A group whose ranges have all scrolled out stays registered with an empty Highlight. Dropping
  // it and re-registering on the way back would move it to the end of the registry, which is
  // where paint order comes from once priorities tie.
  ensureRangeHighlightRegistered(view, group)
}

export function clearRangeHighlight(view: VirtualizedTextViewInternal, name: string): void {
  const group = view.rangeHighlightGroups.get(name)
  if (!group) return

  clearPaintGroup(view, group)
  view.rangeHighlightGroups.delete(name)
  view.rangeHighlightRuleVersion += 1
  if (group.style.overlay) refreshHighlightOverlayMask(view)
  rebuildStyleRules(view)
  scheduleHighlightRepaintNudge(view.highlightRegistry)
}

function renderCaret(view: VirtualizedTextViewInternal): void {
  if (view.selections.length > 0 && !viewHoldsFocus(view)) {
    deferCaret(view)
    return
  }
  cancelDeferredCaret(view)
  renderCaretNow(view)
}

// Caret geometry reads row layout. An editor without focus positions its caret in the next frame,
// after every write of the open or render that asked for it, so opening one forces no layout.
function deferCaret(view: VirtualizedTextViewInternal): void {
  if (view.deferredCaret) return
  view.deferredCaret = scheduleFrame(() => {
    view.deferredCaret = null
    if (view.provisional) return
    renderCaretNow(view)
  })
}

export function cancelDeferredCaret(view: VirtualizedTextViewInternal): void {
  view.deferredCaret?.cancel()
  view.deferredCaret = null
}

export function flushDeferredCaret(view: VirtualizedTextViewInternal): void {
  if (!view.deferredCaret) return
  cancelDeferredCaret(view)
  renderCaretNow(view)
}

function viewHoldsFocus(view: VirtualizedTextViewInternal): boolean {
  return view.inputElement.matches(':focus')
}

function renderCaretNow(view: VirtualizedTextViewInternal): void {
  const selections = view.selections
  if (selections.length === 0) {
    hideCaretElement(view.caretElement)
    hideSecondaryCaretElements(view, 0)
    return
  }

  const primary = selections[0]!
  const primaryPositions = caretPosition(view, primary.head, primary.affinity)
  renderCaretElement(view.caretElement, primaryPositions?.[0] ?? null, false)

  let secondaryIndex = 0
  const primaryOther = primaryPositions?.[1]
  if (primaryOther) secondaryIndex = renderPooledCaret(view, secondaryIndex, primaryOther, true)
  for (let selectionIndex = 1; selectionIndex < selections.length; selectionIndex += 1) {
    const selection = selections[selectionIndex]!
    const positions = caretPosition(view, selection.head, selection.affinity) ?? []
    const position = positions[0]
    if (position) secondaryIndex = renderPooledCaret(view, secondaryIndex, position, false)
    const other = positions[1]
    if (other) secondaryIndex = renderPooledCaret(view, secondaryIndex, other, true)
  }
  hideSecondaryCaretElements(view, secondaryIndex)
  // Whatever the OS is about to anchor on the input — a candidate window, an accent picker — belongs
  // over the caret the reader is watching, and this is where that caret stops moving.
  positionInputAtCaret(view, primaryPositions?.[0] ?? null)
}

function renderPooledCaret(
  view: VirtualizedTextViewInternal,
  index: number,
  position: VirtualizedCaretPosition,
  bidiSecondary: boolean,
): number {
  renderCaretElement(secondaryCaretElementAt(view, index), position, bidiSecondary)
  return index + 1
}

function renderCaretElement(
  element: HTMLElement,
  position: VirtualizedCaretPosition | null,
  bidiSecondary: boolean,
): void {
  if (!position) {
    hideCaretElement(element)
    return
  }

  setElementHidden(element, false)
  element.classList.toggle('editor-virtualized-caret-bidi-secondary', bidiSecondary)
  const height = bidiSecondary ? position.height * 0.85 : position.height
  setStyleValue(element, 'height', `${height}px`)
  setStyleValue(element, 'transform', `translate(${position.left}px, ${position.top}px)`)
}

export function clampStoredSelection(view: VirtualizedTextViewInternal): void {
  if (view.selections.length === 0) return

  view.selections = view.selections.map((selection) => clampStoredSelectionRange(view, selection))
  setPrimarySelection(view, view.selections[0] ?? null)
}

export function renderTokenHighlights(view: VirtualizedTextViewInternal): void {
  if (view.provisional) return
  if (view.highlightOverlaySnapshot && view.highlightOverlaySnapshot !== view.model.textSnapshot) {
    refreshHighlightOverlayMask(view)
    return
  }
  const pendingEdit = view.sameLineTokenEdit
  if (
    !view.highlightRegistry ||
    view.tokens.length === 0 ||
    view.model.textLength === 0 ||
    view.rowElements.size === 0
  ) {
    clearTokenHighlights(view)
    return
  }

  if (pendingEdit) return

  // TODO: Smooth first syntax paint without forcing CSS Highlight API color animation.
  // Highlight pseudo styles do not reliably animate color, so this likely needs a
  // separate transition/overlay strategy that preserves the current range model.
  const mountedRows = getMountedRows(view)
  const reconcileStats = createTokenRangeReconcileStats(view, mountedRows)
  const reconcileStartedAt = reconcileStats ? performanceNow() : 0
  const segmentsByRow = tokenSegmentsForRows(view, mountedRows)
  let styleRulesDirty = false
  for (const row of mountedRows) {
    styleRulesDirty =
      reconcileTokenHighlightsForRow(
        view,
        row,
        segmentsByRow.get(row.tokenHighlightSlotId) ?? [],
        shouldForceTokenRowRebuild(row, null),
        reconcileStats,
      ) || styleRulesDirty
  }
  recordTokenRangeReconcileStats(reconcileStats, reconcileStartedAt)
  if (styleRulesDirty) rebuildStyleRules(view)
}

function reconcileTokenHighlightsForRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  segments: readonly TokenRowSegment[],
  force = false,
  stats: TokenRangeReconcileStats | null = null,
): boolean {
  const signature = tokenRowSignature(row, segments)
  const previousSignature = view.rowTokenSignatures.get(row.tokenHighlightSlotId)
  if (!force && previousSignature === signature) {
    if (stats) stats.skippedRowCount += 1
    return false
  }

  const deletedRangeCount = deleteTokenRangesForRow(view, row.tokenHighlightSlotId)
  if (stats) {
    stats.rebuiltRowCount += 1
    stats.deletedRangeCount += deletedRangeCount
  }

  const result = addTokenSegmentsForRow(view, row, segments)
  if (stats) {
    stats.addedRangeCount += result.addedRangeCount
    stats.liveRangeCount += result.liveRangeCount
    stats.staticRangeCount += result.staticRangeCount
  }
  view.rowTokenSignatures.set(row.tokenHighlightSlotId, signature)
  scheduleHighlightRepaintNudge(view.highlightRegistry)
  return result.styleRulesDirty
}

function reconcileTokenHighlightsAfterSameLineEdit(view: VirtualizedTextViewInternal): void {
  const edit = takeSameLineTokenEdit(view)
  if (!edit) return

  reconcileTokenHighlightsAfterEdit(view, edit)
}

function reconcileTokenHighlightsAfterEdit(
  view: VirtualizedTextViewInternal,
  edit: SameLineTokenEdit,
): void {
  if (edit.kind === 'multi-line') {
    reconcileTokenHighlightsFromRow(view, edit.rowIndex)
    view.tokenProjectionDirtyStartRow = null
    return
  }

  reconcileSameLineTokenRows(view, edit)
}

function reconcileSameLineTokenRows(
  view: VirtualizedTextViewInternal,
  edit: SameLineTokenEdit,
): void {
  const rows = rowsNeedingSameLineProjectionReconcile(view, edit)
  if (rows.length === 0) return

  const segmentsByRow = tokenSegmentsForRows(view, rows)
  let styleRulesDirty = false
  for (const row of rows) {
    styleRulesDirty =
      reconcileTokenHighlightsForRow(
        view,
        row,
        segmentsByRow.get(row.tokenHighlightSlotId) ?? [],
        true,
      ) || styleRulesDirty
  }
  if (styleRulesDirty) rebuildStyleRules(view)
}

function reconcileTokenHighlightsFromRow(
  view: VirtualizedTextViewInternal,
  startRow: number,
  force = false,
): void {
  const rows = getMountedRows(view).filter((row) => row.index >= startRow)
  if (rows.length === 0) return

  const segmentsByRow = tokenSegmentsForRows(view, rows)
  let styleRulesDirty = false
  for (const row of rows) {
    styleRulesDirty =
      reconcileTokenHighlightsForRow(
        view,
        row,
        segmentsByRow.get(row.tokenHighlightSlotId) ?? [],
        force,
      ) || styleRulesDirty
  }
  if (styleRulesDirty) rebuildStyleRules(view)
}

function takeSameLineTokenEdit(view: VirtualizedTextViewInternal): SameLineTokenEdit | null {
  const edit = view.sameLineTokenEdit
  view.sameLineTokenEdit = null
  return edit
}

function dirtyTokenProjectionStartRow(current: number | null, row: number): number {
  if (current === null) return row
  return Math.min(current, row)
}

function rowsNeedingSameLineProjectionReconcile(
  view: VirtualizedTextViewInternal,
  edit: SameLineTokenEdit,
): readonly MountedVirtualizedTextRow[] {
  const rows = getMountedRows(view)
  const needed: MountedVirtualizedTextRow[] = []
  const seen = new Set<number>()

  const editedRow = rows.find((row) => row.index === edit.rowIndex)
  if (editedRow) {
    needed.push(editedRow)
    seen.add(editedRow.tokenHighlightSlotId)
  }

  for (const row of rows) {
    if (seen.has(row.tokenHighlightSlotId)) continue
    if (view.rowTokenSignatures.has(row.tokenHighlightSlotId)) continue

    needed.push(row)
    seen.add(row.tokenHighlightSlotId)
  }

  return needed
}

function shouldForceTokenRowRebuild(
  row: MountedVirtualizedTextRow,
  edit: SameLineTokenEdit | null,
): boolean {
  if (!edit) return false
  if (edit.kind === 'multi-line') return row.index >= edit.rowIndex
  if (edit.editedRowPatchedInPlace) return false
  return row.index === edit.rowIndex
}

export function clearTokenHighlightsFromRow(
  view: VirtualizedTextViewInternal,
  startRow: number,
): void {
  for (const row of getMountedRows(view)) {
    if (row.index < startRow) continue

    deleteTokenRangesForRow(view, row.tokenHighlightSlotId)
    view.rowTokenSignatures.delete(row.tokenHighlightSlotId)
  }
  scheduleHighlightRepaintNudge(view.highlightRegistry)
}

export function restoreHighlightsAfterBrowserResume(view: VirtualizedTextViewInternal): void {
  const registry = view.highlightRegistry
  if (!registry) return
  if (!view.scrollElement.isConnected) return

  const restoredTokenHighlights = restoreTokenHighlightGroups(view, registry)
  const restoredRangeHighlights = restoreRangeHighlightGroups(view, registry)
  restoreStyleRuleElements(view)
  if (!restoredTokenHighlights && !restoredRangeHighlights) return

  reregisterHighlights(registry)
}

function restoreTokenHighlightGroups(
  view: VirtualizedTextViewInternal,
  registry: HighlightRegistry,
): boolean {
  let restored = false
  for (const group of view.tokenGroups.values()) {
    registry.set(group.name, group.highlight)
    restored = true
  }

  return restored
}

function restoreRangeHighlightGroups(
  view: VirtualizedTextViewInternal,
  registry: HighlightRegistry,
): boolean {
  let restored = false
  for (const base of view.overlayBaseGroups.values())
    restored = restorePaintGroup(registry, base) || restored
  for (const group of view.rangeHighlightGroups.values()) {
    restored = restorePaintGroup(registry, group) || restored
    for (const twin of group.twins?.values() ?? [])
      restored = restorePaintGroup(registry, twin) || restored
  }
  return restored
}

function restorePaintGroup(
  registry: HighlightRegistry,
  group: VirtualizedTextHighlightGroup,
): boolean {
  if (!group.registered) return false
  registry.set(group.name, group.highlight)
  return true
}

function restoreStyleRuleElements(view: VirtualizedTextViewInternal): void {
  getSharedTokenHighlights(view.scrollElement.ownerDocument, view.highlightRegistry)?.restore()
  syncStyleElementConnection(view, view.styleEl.textContent ?? '')
}

// Groups follow the palette, which is a few dozen styles however long the document is.
function syncTokenGroupsToPalette(view: VirtualizedTextViewInternal): void {
  if (!view.tokenPaletteDirty) return

  const styles = new Map<string, EditorTokenStyle>()
  for (const style of view.tokens.styles) {
    const renderStyle = tokenRenderStyle(style)
    if (renderStyle) styles.set(renderStyle.styleKey, renderStyle.style)
  }
  retainOverlayTokenStyles(view, styles)
  syncTokenGroupsToStyles(view, styles)
  view.tokenPaletteDirty = false
}

function retainOverlayTokenStyles(
  view: VirtualizedTextViewInternal,
  styles: Map<string, EditorTokenStyle>,
): void {
  if (view.highlightOverlayMask.length === 0) return
  const overlays = new Map(
    view.highlightOverlayMask.map((range) => [JSON.stringify(range.overlay), range.overlay]),
  )
  for (const style of [...styles.values()]) {
    for (const overlay of overlays.values()) {
      const twin = overlayColorStyle(style, overlay)
      const key = serializeTokenStyle(twin)
      if (view.tokenGroups.has(key)) styles.set(key, twin)
    }
  }
}

// Keyed by the palette's style object, which every store derived from one answer shares.
const tokenRenderStyles = new WeakMap<EditorTokenStyle, TokenRenderStyle | null>()

function tokenRenderStyle(source: EditorTokenStyle): TokenRenderStyle | null {
  const cached = tokenRenderStyles.get(source)
  if (cached !== undefined) return cached

  const style = normalizeTokenStyle(source)
  const renderStyle = style ? { style, styleKey: serializeTokenStyle(style) } : null
  tokenRenderStyles.set(source, renderStyle)
  return renderStyle
}

function firstStartingAtOrAfter(
  spans: readonly { readonly start: number }[],
  offset: number,
): number {
  return lowerBound(spans.length, (index) => spans[index]!.start, offset)
}

function firstEndingAfter(maxEnds: readonly number[], offset: number, endIndex: number): number {
  return upperBound(endIndex, (index) => maxEnds[index] ?? 0, offset)
}

function tokenSegmentsForRows(
  view: VirtualizedTextViewInternal,
  rows: readonly MountedVirtualizedTextRow[],
): Map<number, TokenRowSegment[]> {
  const segmentsByRow = new Map<number, TokenRowSegment[]>()
  const stats = createTokenSegmentBuildStats(rows)
  const startedAt = stats ? performanceNow() : 0

  syncTokenGroupsToPalette(view)
  for (const row of rows) appendTokenSegmentsForMountedRow(view, segmentsByRow, row, stats)
  recordTokenSegmentBuildStats(stats, segmentsByRow, startedAt)
  return segmentsByRow
}

function appendTokenSegmentsForMountedRow(
  view: VirtualizedTextViewInternal,
  segmentsByRow: Map<number, TokenRowSegment[]>,
  row: MountedVirtualizedTextRow,
  stats: TokenSegmentBuildStats | null,
): void {
  if (row.kind !== 'text') return

  for (const chunk of row.chunks) {
    appendTokenSegmentsForChunk(view, segmentsByRow, row, chunk, stats)
  }
}

function appendTokenSegmentsForChunk(
  view: VirtualizedTextViewInternal,
  segmentsByRow: Map<number, TokenRowSegment[]>,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  stats: TokenSegmentBuildStats | null,
): void {
  if (chunk.endOffset <= chunk.startOffset) return
  if (stats) stats.chunkCount += 1

  const tokens = view.tokens
  const endIndex = tokens.firstStartingAtOrAfter(chunk.endOffset)
  const startIndex = tokens.firstEndingAfter(chunk.startOffset, endIndex)
  if (startIndex >= endIndex) return

  const textLength = view.model.textLength
  const segments = getOrCreateTokenSegments(segmentsByRow, row.tokenHighlightSlotId)
  tokens.forEachInRange(startIndex, endIndex, (tokenStart, tokenEnd, styleId) => {
    if (stats) stats.tokenScanCount += 1

    const renderStyle = tokenRenderStyle(tokens.styles[styleId]!)
    if (!renderStyle) return
    const start = clamp(tokenStart, 0, textLength)
    const end = clamp(tokenEnd, start, textLength)
    if (end <= start || end <= chunk.startOffset) return

    if (view.highlightOverlayMask.length > 0) {
      appendOverlayTokenSegments(view, segments, row, chunk, start, end, renderStyle, stats)
      return
    }
    const result = appendTokenSegmentForChunk(
      segments,
      row,
      chunk,
      { start, end },
      renderStyle.style,
      renderStyle.styleKey,
    )
    recordTokenSegmentAppend(stats, result)
  })
}

function createTokenSegmentBuildStats(
  rows: readonly MountedVirtualizedTextRow[],
): TokenSegmentBuildStats | null {
  if (!editorPerformanceDiagnosticsEnabled()) return null

  return {
    addedSegmentCount: 0,
    adjacentMergedSegmentCount: 0,
    chunkCount: 0,
    gapMergedSegmentCount: 0,
    mergedSegmentCount: 0,
    rawSegmentCount: 0,
    rowCount: rows.length,
    tokenScanCount: 0,
  }
}

function recordTokenSegmentAppend(
  stats: TokenSegmentBuildStats | null,
  result: TokenSegmentAppendResult,
): void {
  if (!stats) return
  if (result === 'skipped') return

  stats.rawSegmentCount += 1
  if (result === 'merged-adjacent') {
    stats.adjacentMergedSegmentCount += 1
    stats.mergedSegmentCount += 1
    return
  }

  if (result === 'merged-gap') {
    stats.gapMergedSegmentCount += 1
    stats.mergedSegmentCount += 1
    return
  }

  stats.addedSegmentCount += 1
}

function recordTokenSegmentBuildStats(
  stats: TokenSegmentBuildStats | null,
  segmentsByRow: ReadonlyMap<number, readonly TokenRowSegment[]>,
  startedAt: number,
): void {
  if (!stats) return

  const finalSegmentCount = tokenSegmentCount(segmentsByRow)
  recordEditorPerformanceDiagnostic(
    'editor.tokenHighlights.segments',
    {
      addedSegmentCount: stats.addedSegmentCount,
      adjacentMergedSegmentCount: stats.adjacentMergedSegmentCount,
      chunkCount: stats.chunkCount,
      finalSegmentCount,
      gapMergedSegmentCount: stats.gapMergedSegmentCount,
      mergedSegmentCount: stats.mergedSegmentCount,
      rawSegmentCount: stats.rawSegmentCount,
      rowCount: stats.rowCount,
      rowSlotCount: segmentsByRow.size,
      tokenScanCount: stats.tokenScanCount,
    },
    performanceNow() - startedAt,
  )
}

function tokenSegmentCount(segmentsByRow: ReadonlyMap<number, readonly TokenRowSegment[]>): number {
  let count = 0
  for (const segments of segmentsByRow.values()) count += segments.length
  return count
}

function performanceNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function createTokenRangeReconcileStats(
  view: VirtualizedTextViewInternal,
  mountedRows: readonly MountedVirtualizedTextRow[],
): TokenRangeReconcileStats | null {
  if (!editorPerformanceDiagnosticsEnabled()) return null

  return {
    addedRangeCount: 0,
    deletedRangeCount: 0,
    liveRangeCount: 0,
    mountedRowCount: mountedRows.length,
    rebuiltRowCount: 0,
    skippedRowCount: 0,
    staticRangeCount: 0,
    tokenPaletteDirty: view.tokenPaletteDirty,
  }
}

function recordTokenRangeReconcileStats(
  stats: TokenRangeReconcileStats | null,
  startedAt: number,
): void {
  if (!stats) return

  recordEditorPerformanceDiagnostic(
    'editor.tokenHighlights.ranges',
    {
      addedRangeCount: stats.addedRangeCount,
      deletedRangeCount: stats.deletedRangeCount,
      liveRangeCount: stats.liveRangeCount,
      mountedRowCount: stats.mountedRowCount,
      rebuiltRowCount: stats.rebuiltRowCount,
      skippedRowCount: stats.skippedRowCount,
      staticRangeCount: stats.staticRangeCount,
      tokenPaletteDirty: stats.tokenPaletteDirty,
    },
    performanceNow() - startedAt,
  )
}

function addTokenSegmentsForRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  segments: readonly TokenRowSegment[],
): TokenRangeAddResult {
  const rangesByStyle = new Map<string, AbstractRange[]>()
  const document = view.scrollElement.ownerDocument
  let addedRangeCount = 0
  let liveRangeCount = 0
  let staticRangeCount = 0
  let styleRulesDirty = false
  for (const segment of segments) {
    const result = ensureTokenGroup(view, segment.styleKey, segment.style)
    const group = result.group
    if (!group) continue

    const range = addTokenRangeToChunk(
      document,
      group.highlight,
      row,
      segment.chunk,
      segment.start,
      segment.end,
    )
    if (!range) continue

    addedRangeCount += 1
    if (isLiveRange(document, range)) liveRangeCount += 1
    else staticRangeCount += 1
    styleRulesDirty = styleRulesDirty || result.created
    appendTokenRange(rangesByStyle, segment.styleKey, range)
  }

  if (rangesByStyle.size > 0) {
    view.rowTokenRanges.set(row.tokenHighlightSlotId, rangesByStyle)
  }

  return { addedRangeCount, liveRangeCount, staticRangeCount, styleRulesDirty }
}

function isLiveRange(document: Document, range: AbstractRange): boolean {
  const RangeConstructor = document.defaultView?.Range
  return RangeConstructor ? range instanceof RangeConstructor : false
}

function ensureTokenGroup(
  view: VirtualizedTextViewInternal,
  styleKey: string,
  style: EditorTokenStyle,
): { readonly group: TokenGroup | null; readonly created: boolean } {
  const existing = view.tokenGroups.get(styleKey)
  if (existing) return { group: existing, created: false }

  const shared = getSharedTokenHighlights(view.scrollElement.ownerDocument, view.highlightRegistry)
  if (!shared) return { group: null, created: false }

  const handle = shared.acquire(styleKey, style)
  const group = {
    name: handle.name,
    highlight: handle.highlight,
    style,
    styleKey,
  }
  view.tokenGroups.set(styleKey, group)
  return { group, created: true }
}

export function clearTokenHighlights(view: VirtualizedTextViewInternal): void {
  if (view.tokenGroups.size === 0 && view.rowTokenRanges.size === 0) return

  // Deletes this view's ranges out of the (shared) Highlight objects via tokenGroups,
  // so it must run before tokenGroups is cleared.
  clearRowTokenState(view)

  const shared = getSharedTokenHighlights(view.scrollElement.ownerDocument, view.highlightRegistry)
  for (const group of view.tokenGroups.values()) shared?.release(group.styleKey)

  view.tokenGroups.clear()
  rebuildStyleRules(view)
}

function syncTokenGroupsToStyles(
  view: VirtualizedTextViewInternal,
  styles: ReadonlyMap<string, EditorTokenStyle>,
): void {
  const requiresTokenHighlightClear = [view.model.textLength === 0, styles.size === 0].some(Boolean)
  if (requiresTokenHighlightClear) {
    clearTokenHighlights(view)
    return
  }

  const added = ensureTokenGroupsForStyles(view, styles)
  const removed = removeUnusedTokenGroups(view, new Set(styles.keys()))
  if (added || removed) rebuildStyleRules(view)
}

function ensureTokenGroupsForStyles(
  view: VirtualizedTextViewInternal,
  styles: ReadonlyMap<string, EditorTokenStyle>,
): boolean {
  let added = false
  for (const [styleKey, style] of styles) {
    const result = ensureTokenGroup(view, styleKey, style)
    added = added || result.created
  }

  return added
}

function removeUnusedTokenGroups(
  view: VirtualizedTextViewInternal,
  styleKeys: ReadonlySet<string>,
): boolean {
  const shared = getSharedTokenHighlights(view.scrollElement.ownerDocument, view.highlightRegistry)
  let removed = false
  for (const [key, group] of view.tokenGroups) {
    if (styleKeys.has(key)) continue

    deleteViewTokenRangesForStyle(view, key, group.highlight)
    shared?.release(key)
    view.tokenGroups.delete(key)
    removed = true
  }

  if (!removed) return false

  clearRowTokenState(view)
  return true
}

function deleteViewTokenRangesForStyle(
  view: VirtualizedTextViewInternal,
  styleKey: string,
  highlight: Highlight,
): void {
  for (const rangesByStyle of view.rowTokenRanges.values()) {
    const ranges = rangesByStyle.get(styleKey)
    if (!ranges) continue

    for (const range of ranges) highlight.delete(range)
    rangesByStyle.delete(styleKey)
  }
}

function canKeepLiveTokenRanges(
  view: VirtualizedTextViewInternal,
  tokens: EditorTokenStore,
  projectionStatus: boolean | null,
): boolean {
  if (!view.sameLineTokenEdit) return false
  if (projectionStatus !== null) return projectionStatus
  return view.tokens.stylesEqual(tokens)
}

export function deleteTokenRangesForRow(
  view: VirtualizedTextViewInternal,
  rowSlotId: number,
): number {
  const rangesByStyle = view.rowTokenRanges.get(rowSlotId)
  if (!rangesByStyle) return 0

  let deletedRangeCount = 0
  for (const [styleKey, capturedRanges] of rangesByStyle) {
    const group = view.tokenGroups.get(styleKey)
    if (!group) continue

    for (const range of capturedRanges) {
      group.highlight.delete(range)
    }
    deletedRangeCount += capturedRanges.length
  }

  view.rowTokenRanges.delete(rowSlotId)
  // Covers release-only paths (fold collapse, viewport shrink) where rows are
  // dropped without any row rebuild scheduling the nudge.
  if (deletedRangeCount > 0) {
    scheduleHighlightRepaintNudge(view.highlightRegistry)
  }
  return deletedRangeCount
}

export function clearRowTokenState(view: VirtualizedTextViewInternal): void {
  for (const rowSlotId of view.rowTokenRanges.keys()) {
    deleteTokenRangesForRow(view, rowSlotId)
  }

  view.rowTokenSignatures.clear()
  view.rowTokenRanges.clear()
}

function getOrCreateRangeHighlightGroup(
  view: VirtualizedTextViewInternal,
  name: string,
  style: VirtualizedTextHighlightStyle,
): VirtualizedTextHighlightGroup {
  const existing = view.rangeHighlightGroups.get(name)
  if (existing) return existing

  const group: VirtualizedTextHighlightGroup = {
    name,
    highlight: new Highlight(),
    ranges: [],
    style,
    registered: false,
    signature: '',
  }
  view.rangeHighlightGroups.set(name, group)
  view.rangeHighlightRuleVersion += 1
  return group
}

function canSkipRangeHighlightUpdate(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
  ranges: readonly VirtualizedTextHighlightRange[],
  style: VirtualizedTextHighlightStyle,
): boolean {
  if (!sameRangeHighlight(group, ranges, style)) return false

  return rangeHighlightSignature(view, group) === group.signature
}

function sameRangeHighlight(
  group: VirtualizedTextHighlightGroup,
  ranges: readonly VirtualizedTextHighlightRange[],
  style: VirtualizedTextHighlightStyle,
): boolean {
  if (!sameHighlightStyle(group.style, style)) return false
  if (group.ranges.length !== ranges.length) return false

  return group.ranges.every((range, index) => {
    const next = ranges[index]
    return next ? sameHighlightRange(range, next) : false
  })
}

function sameHighlightStyle(
  left: VirtualizedTextHighlightStyle,
  right: VirtualizedTextHighlightStyle,
): boolean {
  if (left.backgroundColor !== right.backgroundColor) return false
  if (left.color !== right.color) return false
  if (left.zIndex !== right.zIndex) return false
  if (left.dimmable !== right.dimmable) return false
  if (left.overlay?.dim !== right.overlay?.dim) return false
  if (left.overlay?.textDecoration !== right.overlay?.textDecoration) return false
  if (Boolean(left.overlay) !== Boolean(right.overlay)) return false

  return left.textDecoration === right.textDecoration
}

function sameHighlightRange(
  left: VirtualizedTextHighlightRange,
  right: VirtualizedTextHighlightRange,
): boolean {
  if (left.start !== right.start) return false

  return left.end === right.end
}

/**
 * Painting seeks into this array once per mounted row, so it has to be ordered, and a caller on
 * the far side of the plugin boundary hands its ranges over in whatever order it produced them.
 * Ordering costs a sort per set rather than a scan per frame, and a set can be large: a search for
 * a common letter in a big file arrives as tens of thousands of ranges.
 */
function sortedRangeHighlights(
  view: VirtualizedTextViewInternal,
  ranges: readonly VirtualizedTextHighlightRange[],
): readonly VirtualizedTextHighlightRange[] {
  const clamped = ranges.map((range) => ({
    start: clamp(range.start, 0, view.model.textLength),
    end: clamp(range.end, 0, view.model.textLength),
  }))

  return clamped.sort(compareRangeHighlights)
}

function compareRangeHighlights(
  left: VirtualizedTextHighlightRange,
  right: VirtualizedTextHighlightRange,
): number {
  return left.start - right.start || left.end - right.end
}

function rangeHighlightIndex(
  ranges: readonly VirtualizedTextHighlightRange[],
): RangeHighlightIndex {
  const cached = rangeHighlightIndexes.get(ranges)
  if (cached) return cached

  const maxEnds: number[] = []
  let maxEnd = 0
  let fingerprint = SIGNATURE_HASH_SEED
  for (const range of ranges) {
    maxEnd = Math.max(maxEnd, range.end)
    maxEnds.push(maxEnd)
    fingerprint = mixSignatureHash(mixSignatureHash(fingerprint, range.start), range.end)
  }

  const index: RangeHighlightIndex = { fingerprint, maxEnds }
  rangeHighlightIndexes.set(ranges, index)
  return index
}

function addMountedRangeHighlightRanges(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  const ranges = group.paintRanges ?? group.ranges
  const index = rangeHighlightIndex(ranges)
  for (const row of getMountedRows(view)) {
    addMountedRangeHighlightRangesForRow(view, group, row, index, ranges)
  }
}

function addMountedRangeHighlightRangesForRow(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
  row: MountedVirtualizedTextRow,
  index: RangeHighlightIndex,
  ranges: readonly VirtualizedTextHighlightRange[],
): void {
  const endIndex = firstStartingAtOrAfter(ranges, row.endOffset)
  const startIndex = firstEndingAfter(index.maxEnds, row.startOffset, endIndex)
  for (let position = startIndex; position < endIndex; position += 1) {
    addMountedRangeHighlightRange(view, group, row, ranges[position]!)
  }
}

function addMountedRangeHighlightRange(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
  row: MountedVirtualizedTextRow,
  range: VirtualizedTextHighlightRange,
): void {
  if (range.start === range.end) return
  if (range.end <= row.startOffset || range.start >= row.endOffset) return

  for (const chunk of row.chunks) {
    addRangeHighlightToChunk(view, group, row, chunk, range)
  }
}

function addRangeHighlightToChunk(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  range: VirtualizedTextHighlightRange,
): void {
  const domRange = createDomRangeForChunkRange(
    view.scrollElement.ownerDocument,
    row,
    chunk,
    range.start,
    range.end,
  )
  if (!domRange) return

  group.highlight.add(domRange)
}

function ensureRangeHighlightRegistered(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  if (group.registered) return
  if (!view.highlightRegistry) return

  view.highlightRegistry.set(group.name, group.highlight)
  group.registered = true
}

function unregisterRangeHighlight(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  if (!group.registered) return

  view.highlightRegistry?.delete(group.name)
  group.registered = false
}

function staleRangeHighlightSignature(): string {
  return '\0'
}

/**
 * Guards the repaint, so it has to tell apart any two viewports that would paint differently
 * without costing what the repaint costs: the ranges the mounted window reaches fold into one
 * number, and the set as a whole rides along as the fingerprint the index already carries.
 */
function rangeHighlightSignature(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): string {
  const index = rangeHighlightIndex(group.ranges)
  let hash = index.fingerprint
  for (const row of getMountedRows(view)) {
    hash = mixRangeHighlightRowSignature(hash, row, group, index)
  }

  return String(hash)
}

function mixRangeHighlightRowSignature(
  hash: number,
  row: MountedVirtualizedTextRow,
  group: VirtualizedTextHighlightGroup,
  index: RangeHighlightIndex,
): number {
  const endIndex = firstStartingAtOrAfter(group.ranges, row.endOffset)
  const startIndex = firstEndingAfter(index.maxEnds, row.startOffset, endIndex)
  let mixed = hash
  for (let position = startIndex; position < endIndex; position += 1) {
    mixed = mixRangeHighlightRangeSignature(mixed, row, group.ranges[position]!)
  }

  return mixed
}

function mixRangeHighlightRangeSignature(
  hash: number,
  row: MountedVirtualizedTextRow,
  range: VirtualizedTextHighlightRange,
): number {
  if (range.start === range.end) return hash
  if (range.end <= row.startOffset || range.start >= row.endOffset) return hash

  let mixed = hash
  for (const chunk of row.chunks) {
    mixed = mixRangeHighlightChunkSignature(mixed, row, chunk, range.start, range.end)
  }

  return mixed
}

function clampSelection(
  view: VirtualizedTextViewInternal,
  selection: VirtualizedTextSelection,
): VirtualizedStoredSelection {
  const anchor = clamp(selection.anchorOffset, 0, view.model.textLength)
  const head = clamp(selection.headOffset, 0, view.model.textLength)
  return {
    start: Math.min(anchor, head),
    end: Math.max(anchor, head),
    head,
    affinity: selection.affinity ?? 'after',
  }
}

function clampStoredSelectionRange(
  view: VirtualizedTextViewInternal,
  selection: VirtualizedStoredSelection,
): VirtualizedStoredSelection {
  const start = clamp(selection.start, 0, view.model.textLength)
  return {
    start,
    end: clamp(selection.end, start, view.model.textLength),
    head: clamp(selection.head, 0, view.model.textLength),
    affinity: selection.affinity,
  }
}

function setPrimarySelection(
  view: VirtualizedTextViewInternal,
  selection: VirtualizedStoredSelection | null,
): void {
  view.selectionStart = selection?.start ?? null
  view.selectionEnd = selection?.end ?? null
  view.selectionHead = selection?.head ?? null
}

function hasSelectionRanges(selections: readonly VirtualizedStoredSelection[]): boolean {
  return selections.some((selection) => selection.start !== selection.end)
}

function secondaryCaretElementAt(view: VirtualizedTextViewInternal, index: number): HTMLDivElement {
  const existing = view.secondaryCaretElements[index]
  if (existing) return existing

  const created = createSecondaryCaretElement(view)
  view.secondaryCaretElements.push(created)
  return created
}

function createSecondaryCaretElement(view: VirtualizedTextViewInternal): HTMLDivElement {
  const element = view.scrollElement.ownerDocument.createElement('div')
  element.className = 'editor-virtualized-caret editor-virtualized-caret-secondary'
  element.hidden = true
  view.caretLayerElement.appendChild(element)
  return element
}

function hideCaretElement(element: HTMLElement): void {
  setElementHidden(element, true)
}

function hideSecondaryCaretElements(view: VirtualizedTextViewInternal, startIndex: number): void {
  for (let index = startIndex; index < view.secondaryCaretElements.length; index += 1) {
    hideCaretElement(view.secondaryCaretElements[index]!)
  }
}

export function rebuildStyleRules(view: VirtualizedTextViewInternal): void {
  if (view.provisional) return
  orderRangeHighlights(view)
  // Token highlight rules live in the shared per-document stylesheet
  // (sharedTokenHighlights), written once here per batch. The per-view style element only
  // carries range/decoration highlight rules, which are specific to this view's ranges.
  getSharedTokenHighlights(view.scrollElement.ownerDocument, view.highlightRegistry)?.flush()

  // A range rule reads only a group's name and its style, so a call that moved ranges around cannot
  // have changed any of them. Without this, a repaint that pushes N groups rebuilds every rule N
  // times to arrive at the same string — quadratic in the live group count, on the keystroke path.
  //
  // Measured rather than assumed, because it was assumed once and the number was wrong: ablating
  // these two lines moves the semantic layer's own repaint benchmark by less than its noise at the
  // live group count of sixteen. N² template-string constructions are cheap, and 16² of them is
  // about 1% of a keystroke. It is kept because it is free and correct — not because it is
  // load-bearing, and no benchmark here can witness it.
  //
  // The element's connection is only ever toggled by the rule set going empty or non-empty, which
  // is itself a version change, so skipping the sync along with the rebuild is safe. That the
  // version moves whenever a group is added, removed or restyled is what `editor.test.ts`'s
  // "updates semantic range highlights in place" covers.
  if (view.rangeHighlightRuleVersion === view.renderedRangeHighlightRuleVersion) return
  view.renderedRangeHighlightRuleVersion = view.rangeHighlightRuleVersion

  const rules: string[] = []
  for (const group of view.rangeHighlightGroups.values()) {
    const rule = rangeHighlightRule(view.highlightScope, group.name, group.style)
    if (rule) rules.push(rule)
    for (const twin of group.twins?.values() ?? []) appendPaintRule(rules, view, twin)
  }
  for (const base of view.overlayBaseGroups.values()) appendPaintRule(rules, view, base)

  const nextRules = rules.join('\n')
  if (view.styleEl.textContent === nextRules) {
    syncStyleElementConnection(view, nextRules)
    return
  }

  view.styleEl.textContent = nextRules
  syncStyleElementConnection(view, nextRules)
}

function syncStyleElementConnection(view: VirtualizedTextViewInternal, rules: string): void {
  if (rules.length === 0) {
    view.styleEl.remove()
    return
  }

  if (view.styleEl.isConnected) return

  view.scrollElement.ownerDocument.head.appendChild(view.styleEl)
}

function rangeHighlightRule(
  scope: string,
  name: string,
  style: VirtualizedTextHighlightStyle,
): string | null {
  const declarations = []
  if (style.backgroundColor) declarations.push(`background-color: ${style.backgroundColor};`)
  if (style.color) declarations.push(`color: ${style.color};`)
  if (style.textDecoration) declarations.push(`text-decoration: ${style.textDecoration};`)
  if (declarations.length === 0) return null

  // Mounting one excerpt must not invalidate highlights in every other editor.
  return `[data-editor-highlight-scope="${scope}"] .editor-virtualized-row::highlight(${name}) { ${declarations.join(' ')} }`
}

function mixRangeHighlightChunkSignature(
  hash: number,
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
): number {
  if (end <= chunk.startOffset || start >= chunk.endOffset) return hash

  const localStart = clamp(
    rowLocalIndexForOffset(row, start, 'before') - chunk.localStart,
    0,
    chunk.text.length,
  )
  const localEnd = clamp(
    rowLocalIndexForOffset(row, end, 'after') - chunk.localStart,
    0,
    chunk.text.length,
  )
  let mixed = mixSignatureHash(hash, row.index)
  mixed = mixSignatureHash(mixed, chunk.localStart)
  mixed = mixSignatureHash(mixed, chunk.startOffset)
  mixed = mixSignatureHash(mixed, localStart)
  return mixSignatureHash(mixed, localEnd)
}

function mixSignatureHash(hash: number, value: number): number {
  return Math.imul(hash ^ (value | 0), SIGNATURE_HASH_PRIME) >>> 0
}

function validateRangeHighlightStyle(style: VirtualizedTextHighlightStyle): void {
  if (!style.overlay) return
  if (Object.keys(style).some((key) => key !== 'overlay'))
    throw new TypeError('Highlight overlays cannot include ordinary paint fields')
  validateHighlightOverlay(style.overlay)
}

function clearPaintGroup(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  for (const twin of group.twins?.values() ?? []) {
    twin.highlight.clear()
    unregisterRangeHighlight(view, twin)
  }
  group.twins?.clear()
  group.highlight.clear()
  unregisterRangeHighlight(view, group)
}

function refreshHighlightOverlayMask(view: VirtualizedTextViewInternal): void {
  const ranges = [...view.rangeHighlightGroups.values()].flatMap((group) =>
    group.style.overlay
      ? group.ranges.map((range) => ({ ...range, overlay: group.style.overlay! }))
      : [],
  )
  const snapshot = view.model.textSnapshot
  view.highlightOverlaySnapshot = ranges.length ? snapshot : null
  view.highlightOverlayMask = buildHighlightOverlayMask(ranges, snapshot.length, (offset) =>
    snapshot.readRange(offset, offset + 1).charCodeAt(0),
  )
  syncOverlayBaseGroups(view)
  for (const group of view.rangeHighlightGroups.values()) {
    group.signature = staleRangeHighlightSignature()
    if (group.style.overlay) {
      clearPaintGroup(view, group)
      continue
    }
    prepareRangeHighlightTwins(view, group)
  }
  view.rangeHighlightRuleVersion++
  view.tokenPaletteDirty = true
  renderTokenHighlights(view)
  for (const group of view.rangeHighlightGroups.values()) renderRangeHighlight(view, group.name)
  rebuildStyleRules(view)
}

// One base group per distinct overlay, reused across edits, so the registry grows with the
// overlay kinds in play and a keystroke re-fills Highlights instead of re-registering them.
function syncOverlayBaseGroups(view: VirtualizedTextViewInternal): void {
  const rangesByKey = new Map<string, HighlightOverlayRange[]>()
  for (const range of view.highlightOverlayMask) {
    const key = overlayKey(range.overlay)
    const ranges = rangesByKey.get(key)
    if (ranges) ranges.push(range)
    else rangesByKey.set(key, [range])
  }
  for (const [key, base] of view.overlayBaseGroups) {
    if (rangesByKey.has(key)) continue
    clearPaintGroup(view, base)
    view.overlayBaseGroups.delete(key)
    view.rangeHighlightRuleVersion++
  }
  for (const [key, ranges] of rangesByKey) {
    const existing = view.overlayBaseGroups.get(key)
    if (existing) {
      existing.ranges = ranges
      existing.signature = staleRangeHighlightSignature()
      continue
    }
    const style = { ...overlayColorStyle({}, ranges[0]!.overlay), zIndex: -1 }
    view.overlayBaseGroups.set(
      key,
      createOverlayPaintGroup(nextOverlayBaseName(view), ranges, style),
    )
    view.rangeHighlightRuleVersion++
  }
}

function overlayKey(overlay: HighlightOverlay): string {
  return `${overlay.dim ?? 1}|${overlay.textDecoration ?? ''}`
}

function nextOverlayBaseName(view: VirtualizedTextViewInternal): string {
  const names = new Set([...view.overlayBaseGroups.values()].map((group) => group.name))
  for (let index = 0; ; index++) {
    const name = `${view.highlightScope}-overlay-base-${index}`
    if (!names.has(name)) return name
  }
}

function createOverlayPaintGroup(
  name: string,
  ranges: readonly VirtualizedTextHighlightRange[],
  style: VirtualizedTextHighlightStyle,
): OverlayPaintGroup {
  const highlight = new Highlight()
  highlight.priority = style.zIndex ?? 0
  return {
    name,
    ranges: [...ranges],
    style,
    highlight,
    registered: false,
    signature: staleRangeHighlightSignature(),
  }
}

function prepareRangeHighlightTwins(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  const hadTwins = Boolean(group.twins?.size)
  for (const twin of group.twins?.values() ?? []) clearPaintGroup(view, twin)
  group.twins?.clear()
  group.paintRanges = undefined
  if (hadTwins) view.rangeHighlightRuleVersion++
  if (!group.style.color || group.style.overlay || view.highlightOverlayMask.length === 0) return
  const ordinary: VirtualizedTextHighlightRange[] = []
  const twins = new Map<string, OverlayPaintGroup>()
  for (const range of group.ranges) {
    for (const part of splitHighlightOverlay(range.start, range.end, view.highlightOverlayMask)) {
      appendRangeOverlayPart(group, part, ordinary, twins)
    }
  }
  group.paintRanges = ordinary
  group.twins = twins
  view.rangeHighlightRuleVersion++
}

function appendRangeOverlayPart(
  group: VirtualizedTextHighlightGroup,
  part: ReturnType<typeof splitHighlightOverlay>[number],
  ordinary: VirtualizedTextHighlightRange[],
  twins: Map<string, OverlayPaintGroup>,
): void {
  if (!part.overlay) {
    ordinary.push(part)
    return
  }
  const style = overlayColorStyle(group.style, part.overlay, group.style.dimmable !== false)
  if (style.color === group.style.color && style.textDecoration === group.style.textDecoration) {
    ordinary.push(part)
    return
  }
  const key = JSON.stringify(style)
  const existing = twins.get(key)
  if (existing) {
    existing.ranges.push(part)
    return
  }
  twins.set(key, createOverlayPaintGroup(`${group.name}-overlay-${twins.size}`, [part], style))
}

function appendOverlayTokenSegments(
  view: VirtualizedTextViewInternal,
  segments: TokenRowSegment[],
  row: MountedVirtualizedTextRow,
  chunk: VirtualizedTextChunk,
  start: number,
  end: number,
  renderStyle: TokenRenderStyle,
  stats: TokenSegmentBuildStats | null,
): void {
  for (const part of splitHighlightOverlay(
    Math.max(start, chunk.startOffset),
    Math.min(end, chunk.endOffset),
    view.highlightOverlayMask,
  )) {
    const style = part.overlay
      ? overlayColorStyle(renderStyle.style, part.overlay)
      : renderStyle.style
    const key = part.overlay ? serializeTokenStyle(style) : renderStyle.styleKey
    recordTokenSegmentAppend(
      stats,
      appendTokenSegmentForChunk(segments, row, chunk, part, style, key),
    )
  }
}

function orderRangeHighlights(view: VirtualizedTextViewInternal): void {
  if (view.highlightOverlayMask.length === 0 || !view.highlightRegistry) return
  const groups = orderedPaintGroups(view)
  if (rangeHighlightsInOrder(view.highlightRegistry, groups)) return
  for (const group of groups) reregisterPaintGroup(view, group)
}

function orderedPaintGroups(view: VirtualizedTextViewInternal): VirtualizedTextHighlightGroup[] {
  const groups: VirtualizedTextHighlightGroup[] = []
  for (const group of view.rangeHighlightGroups.values()) {
    if (group.style.overlay) continue
    if (group.registered) groups.push(group)
    for (const twin of group.twins?.values() ?? []) if (twin.registered) groups.push(twin)
  }
  return groups
}

// Re-registering repaints every highlight, so it only runs when a token group or a range group
// was registered out of order since the last check.
function rangeHighlightsInOrder(
  registry: HighlightRegistry,
  groups: readonly VirtualizedTextHighlightGroup[],
): boolean {
  if (!registry.entries) return false
  const positions = new Map(groups.map((group, index) => [group.name, index]))
  let next = 0
  for (const [name] of registry.entries()) {
    const position = positions.get(name)
    if (position === undefined) {
      if (next > 0 && name.startsWith(SHARED_TOKEN_HIGHLIGHT_PREFIX)) return false
      continue
    }
    if (position !== next) return false
    next++
  }
  return next === groups.length
}

function reregisterPaintGroup(
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  if (!group.registered) return
  view.highlightRegistry?.delete(group.name)
  view.highlightRegistry?.set(group.name, group.highlight)
}

function appendPaintRule(
  rules: string[],
  view: VirtualizedTextViewInternal,
  group: VirtualizedTextHighlightGroup,
): void {
  const rule = rangeHighlightRule(view.highlightScope, group.name, group.style)
  if (rule) rules.push(rule)
}
