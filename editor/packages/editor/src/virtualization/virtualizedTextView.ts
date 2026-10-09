import { isElementNode, isTextareaElement } from '../dom'
import {
  acquireRowPresentation,
  invalidateRowPresentations,
  type EditorRowPresentation,
} from '../rowPresentation'
import type { EditorPointHit, EditorMarkerHit } from '../pointQueries'
import { pointViewport } from './pointViewport'
import { markerAtRowX } from './virtualizedTextViewHiddenCharacters'
import { ScrollViewport } from './scrollViewport'
import type { FoldMarkerSource } from './foldMarkerSource'
import type { SavedPaint } from '../editor/paintSnapshot'
import type { TextContent } from '../textContent'
import type { FoldMap } from '../foldMap'
import { nextGraphemeBoundary, previousGraphemeBoundary } from '../graphemes'
import type { ResolvedSuspiciousCharactersOptions } from '../unicodeHighlight'
import { type AtomicRanges, atomicRangesForInlineMap } from '../atomicRanges'
import { glyphAdvancesFor, type GlyphAdvances } from './glyphAdvances'
import { type InlineMap, revealInlineMap } from '../inlineMap'
import type { TextOffsetRange } from '../textRanges'
import { normalizeTabSize, type InjectedTextRow } from '../displayTransforms'
import { createStringTextSnapshot, type TextSnapshot } from '../documentTextSnapshot'
import { firstBatchChangeEndingAtOrAfter, type TextEditBatch } from '../textEditBatch'
import type { EditorTheme } from '../theme'
import type {
  EditorGutterContribution,
  EditorGutterWidthContext,
  EditorViewportSnapshot,
} from '../plugins'
import type { SelectionAffinity, SelectionGoal } from '../selections'
import { EditorTokenStore, type EditorTokenInput } from '../syntax/tokenStore'
import type { TextEdit } from '../tokens'
import { applyEditorTheme } from '../theme'
import { measureBrowserTextFace, type BrowserTextMetrics } from './browserMetrics'
import {
  DEFAULT_MAX_SCROLL_HEIGHT,
  FixedRowVirtualizer,
  type FixedRowVirtualizerSnapshot,
} from './fixedRowVirtualizer'
import {
  DEFAULT_OVERSCAN,
  DEFAULT_SELECTION_HIGHLIGHT,
  countValidCaretChecks,
  countValidHitTestChecks,
  countValidSelectionChecks,
  createInputElement,
  createScrollElement,
  createVirtualizerOptions,
  foldMapMatchesText,
  getDefaultHighlightRegistry,
  hitTestBoundaryFromPoint,
  indexFoldMarkersByKey,
  indexFoldMarkersByStartRow,
  inlineMapMatchesText,
  normalizeChunkSize,
  normalizeChunkThreshold,
  normalizeHorizontalOverscan,
  normalizeGutterLeadingInset,
  normalizeRowGap,
  normalizeRowHeight,
  fontFamilyValue,
  fontSizeValue,
  setFontVariable,
  setStyleValue,
  normalizeScrollMode,
  invalidateScrollElementPadding,
  scrollElementPadding,
} from './virtualizedTextViewHelpers'
import {
  adoptTokens as adoptViewTokens,
  clampStoredSelection,
  clearRangeHighlight,
  clearRowTokenState,
  clearSelection,
  clearSelectionHighlight,
  cancelDeferredCaret,
  clearTokenHighlights,
  clearTokenHighlightsFromRow,
  deleteTokenRangesForRow,
  flushDeferredCaret,
  rebuildStyleRules,
  rebaseCaretPaint,
  renderRangeHighlight,
  renderSelectionHighlight,
  renderTokenHighlights,
  restoreHighlightsAfterBrowserResume,
  restoreHighlightsAfterPresentation,
  setRangeHighlight,
  setSelection,
  setSelections,
  setTokens as setViewTokens,
} from './virtualizedTextViewHighlights'
import {
  DEFAULT_SUSPICIOUS_SETTINGS,
  normalizeHiddenCharactersMode,
  renderHiddenCharacters,
  setSuspiciousCharacters,
} from './virtualizedTextViewHiddenCharacters'
import {
  compositionCharacterRects,
  refreshCompositionPreedit,
  setCompositionPreedit,
} from './virtualizedTextViewComposition'
import { attachEditContext, createEditContext, type EditorEditContext } from './editContext'
import { createVirtualizedTextViewModel } from './virtualizedTextViewModel'
import {
  applyTextLayoutTransition,
  lineEndOffset,
  lineStartOffset,
  offsetForViewportColumn,
  refreshDisplayProjection,
  refreshDisplayProjectionForWrapWidth,
  rowForCaretPosition,
  rowForOffset,
  rowForViewportY,
  rowTop,
  sameLineEditPatch,
  setFoldStateLayout,
  setInjectedTextRowsLayout,
  multiLineEditPatch,
  sourceEditPatch,
  setTextLayoutState,
  setWrapEnabledLayout,
  updateVirtualizerRows,
  visualColumnForOffset,
} from './virtualizedTextViewLayout'
import { LineStartsView } from './lineStartIndex'
import { projectRowDecorationMapThroughEdits } from './rowDecorationProjection'
import {
  boundaryAffinityForX,
  boundaryPositionXs,
  boundaryPositionXsForAffinity,
  clearRowGeometryCaches,
  homogeneousRtlCaretAtRowEdge,
  homogeneousRtlCaretMoveInRow,
  isBidiMeasurementRefusalRow,
  knownRowScrollWidth,
  measureRowScrollWidth,
  offsetFromDomBoundary,
  rowLocalXFromClientPoint,
  rowHasOnlyBidiControls,
  rowMightContainRTL,
  rowTextExtent,
  unitRectForOffset,
  visualCaretAtRowEdge,
  visualCaretMoveInRow,
  xToOffset,
  type VisualCaretTarget,
  type VisualRowCaretMove,
} from './virtualizedTextViewGeometry'
import { rowLocalIndexForOffset, rowOffsetForLocalIndex } from './virtualizedTextViewInlineMapping'
import { BIDI_CONTROL_CODE_POINTS, isSimpleRowText } from '../textCharacters'
import {
  applyRowHeight,
  captureGutterPaint,
  takeGutterCells,
  takeInlineWidgets,
  ensureOffsetMounted,
  getMountedRows,
  gutterWidth,
  visibleGutterWidth,
  setGutterLeadingInsetProperty,
  horizontalViewportColumns,
  pageRowDelta,
  paintProvisionalRows,
  positionInputAtCaret,
  renderRows,
  resetContentWidthScan,
  resolveMountedOffset,
  restoreScrollPosition,
  rowsKey,
  scrollOffsetIntoView,
  scrollOffsetToViewportBlock,
  settledRevealBlock,
  scrollToRow,
  spacerWidth,
  textOffsetFromDomBoundary,
  updateContentWidth,
  updateGutterContributions,
  updateGutterWidthIfNeeded,
  updateMountedRowsAfterSameLineEdit,
  updateMountedFoldMarkers,
  updateSpacerHeight,
  updateSpacerWidth,
  viewportPointMetrics,
} from './virtualizedTextViewRows'
import type {
  CreateRangeOptions,
  RevealBlock,
  VirtualizedTextHighlightRange,
  VirtualizedTextHighlightStyle,
  VirtualizedTextSelection,
  VirtualizedTextViewInternal,
} from './virtualizedTextViewInternals'
import type {
  EditorCursorLineHighlightOptions,
  HiddenCharactersMode,
  MultiLineEditPatch,
  NativeGeometryValidation,
  SameLineEditPatch,
  VirtualizedFoldMarker,
  VirtualizedTextRowDecoration,
  VirtualizedTextViewOptions,
  VirtualizedTextViewScrollMode,
  VirtualizedTextViewState,
  DocumentWithCaretHitTesting,
  MountedVirtualizedTextRow,
  VirtualizedBidiSelectionAnchor,
  VirtualizedTextHitPosition,
} from './virtualizedTextViewTypes'

type VerticalSelectionGoal = Exclude<SelectionGoal, { readonly kind: 'none' }>

type BidiExtremalBoundaryCache = {
  readonly geometry: unknown
  readonly left: number
  readonly right: number
}

type BidiVisualOrientationCache = {
  readonly geometry: unknown
  readonly startOnLeft: boolean
}

const bidiExtremalBoundaryCaches = new WeakMap<HTMLElement, BidiExtremalBoundaryCache>()
let nextHighlightScope = 0
const bidiVisualOrientationCaches = new WeakMap<HTMLElement, BidiVisualOrientationCache>()
const BIDI_WINDOWED_VISUAL_MOVE_MIN_TEXT_LENGTH = 64
const BIDI_VISUAL_MOVE_EPSILON = 0.9
const BIDI_VISUAL_PROBE_INITIAL_DELTA = 0.5
const BIDI_VISUAL_PROBE_MAX_STEPS = 24
const BIDI_VISUAL_PROBE_REFINEMENTS = 4
const BIDI_VISUAL_PROBE_VIEWPORT_INSET = 2
const AUXILIARY_CARET_HIT_SELECTOR = [
  '.editor-virtualized-caret',
  '.editor-virtualized-caret-layer',
  '.editor-virtualized-selection-layer',
  '.editor-virtualized-hidden-character-layer',
  '.editor-virtualized-fold-placeholder',
].join(',')

type HiddenCaretHitElement = {
  readonly element: HTMLElement
  readonly visibility: string
}

type BidiVisualProbeContext = {
  readonly view: VirtualizedTextViewInternal
  readonly row: MountedVirtualizedTextRow
  readonly positionsByOffset: Map<number, readonly number[]>
  readonly originOffset: number
  readonly originX: number
  readonly direction: 'left' | 'right'
}

type BidiVisualProbe = {
  readonly target: VisualCaretTarget
  readonly x: number
}

export type {
  HiddenCharactersMode,
  NativeGeometryValidation,
  VirtualizedFoldMarker,
  VirtualizedTextRowDecoration,
  VirtualizedTextViewOptions,
  VirtualizedTextViewScrollMode,
  VirtualizedTextViewState,
} from './virtualizedTextViewTypes'

const DEFAULT_CURSOR_LINE_HIGHLIGHT: Required<EditorCursorLineHighlightOptions> = {
  gutterNumber: false,
  gutterBackground: true,
  rowBackground: true,
}

function normalizeGutterWidthProvider(
  gutterWidth: VirtualizedTextViewOptions['gutterWidth'],
): ((context: EditorGutterWidthContext) => number) | null {
  if (typeof gutterWidth === 'function') return gutterWidth
  if (gutterWidth === undefined) return null

  return () => gutterWidth
}

function selectionOffsetRanges(
  view: VirtualizedTextViewInternal,
): readonly { readonly start: number; readonly end: number }[] {
  return view.selections.map((selection) => ({ start: selection.start, end: selection.end }))
}

function setScrollModeAttribute(
  element: HTMLElement,
  scrollMode: VirtualizedTextViewScrollMode,
): void {
  element.dataset.editorScrollMode = scrollMode
}

/** Host-given metrics are taken as they are, monospace included; otherwise the font is measured. */
function measuredTextFace(
  element: HTMLElement,
  textMetrics: BrowserTextMetrics | null,
): { readonly metrics: BrowserTextMetrics; readonly monospace: boolean } {
  if (textMetrics) return { metrics: textMetrics, monospace: true }
  const face = measureBrowserTextFace(element)
  return { metrics: face, monospace: face.monospace }
}

export class VirtualizedTextView {
  public readonly scrollElement: HTMLDivElement
  public readonly contentElement: HTMLDivElement
  public readonly inputElement: HTMLElement
  /** Set when typed text arrives through EditContext rather than the textarea. */
  public readonly editContext: EditorEditContext | null
  private readonly view: VirtualizedTextViewInternal
  private measuredMaxScrollHeight: number | undefined
  private readonly disposeForegroundHighlightRestore: () => void
  private cancelContentWidthMeasurement: (() => void) | null = null
  private provisionalPaint: { readonly paint: SavedPaint; readonly release: () => void } | null =
    null
  private pendingOverlayWidths: Map<'left' | 'right', number> | null = null
  private viewportVisible = false
  private atomicRenderDepth = 0
  private atomicRenderPending = false
  private flushingAtomicRender = false
  private applyingEdit = false
  private contentHeight = -1
  private readonly onContentHeightChange: ((height: number) => void) | null
  private pendingReveal: {
    readonly offset: number
    readonly block: RevealBlock
    readonly affinity?: SelectionAffinity
  } | null = null

  public constructor(container: HTMLElement, options: VirtualizedTextViewOptions = {}) {
    this.onContentHeightChange = options.onContentHeightChange ?? null
    const overscan = options.overscan ?? DEFAULT_OVERSCAN
    const gutterContributions = options.gutterContributions ?? []
    const gutterWidthProvider = normalizeGutterWidthProvider(options.gutterWidth)

    const styleEl = container.ownerDocument.createElement('style')
    const scrollElement = createScrollElement(container, options.className)
    const highlightScope = `editor-highlight-${nextHighlightScope++}`
    scrollElement.setAttribute('data-editor-highlight-scope', highlightScope)
    // Before the first measurement, so the metrics are read from the face the host asked for.
    setFontVariable(scrollElement, '--editor-font-size', fontSizeValue(options.fontSize))
    setFontVariable(scrollElement, '--editor-font-family', fontFamilyValue(options.fontFamily))
    const textMetrics = options.textMetrics ?? null
    const measuredFace = measuredTextFace(scrollElement, textMetrics)
    const measuredMetrics = measuredFace.metrics
    const lineHeightOverride = options.lineHeight ?? options.rowHeight ?? null
    const rowHeight = normalizeRowHeight(lineHeightOverride ?? measuredMetrics.rowHeight)
    const rowGap = normalizeRowGap(options.rowGap)
    const scrollMode = normalizeScrollMode(options.scrollMode)
    const rowPositioning = options.rowPositioning ?? 'transform'
    const inputElement = createInputElement(
      container,
      options.inputRoute ?? 'textarea',
      options.inputLabel,
      options.inputKind,
    )
    const viewport = new ScrollViewport(scrollElement)
    viewport.gutterScroll = options.gutterScroll ?? 'fixed'
    const contentElement = viewport.textContent
    const spacer = viewport.textSpacer
    const gutterElement = container.ownerDocument.createElement('div')
    const caretLayerElement = container.ownerDocument.createElement('div')
    const caretElement = container.ownerDocument.createElement('div')
    const longLineChunkSize = normalizeChunkSize(options.longLineChunkSize)
    const longLineChunkThreshold = normalizeChunkThreshold(
      options.longLineChunkThreshold,
      longLineChunkSize,
    )
    const tabSize = normalizeTabSize(options.tabSize)
    const virtualizer = new FixedRowVirtualizer({
      ...createVirtualizerOptions(rowHeight, overscan, rowGap, scrollMode, options.scrollPastEnd),
    })
    const initialTextSnapshot = createStringTextSnapshot('')
    const initialInjectedTextRows = options.injectedTextRows ?? []
    const initialModel = createVirtualizedTextViewModel({
      textSnapshot: initialTextSnapshot,
      foldMap: null,
      inlineMap: null,
      injectedTextRows: initialInjectedTextRows,
      wrapColumn: null,
      tabSize,
    })

    this.scrollElement = scrollElement
    this.contentElement = contentElement
    this.inputElement = inputElement
    this.editContext = isTextareaElement(inputElement) ? null : createEditContext(inputElement)
    this.view = {
      disposed: false,
      provisional: false,
      scrollElement,
      viewport,
      contentElement,
      inputElement,
      spacer,
      gutterElement,
      gutterContributions,
      gutterWidthProvider,
      gutterLeadingInset: normalizeGutterLeadingInset(options.gutterLeadingInset),
      caretLayerElement,
      caretElement,
      deferredCaret: null,
      secondaryCaretElements: [],
      styleEl,
      highlightScope,
      rangeHighlightRuleVersion: 0,
      // Behind the live version, so the first rebuild always writes.
      renderedRangeHighlightRuleVersion: -1,
      virtualizer,
      scrollMode,
      rowPositioning,
      longLineChunkSize,
      longLineChunkThreshold,
      horizontalOverscanColumns: normalizeHorizontalOverscan(options.horizontalOverscanColumns),
      onFoldToggle: options.onFoldToggle ?? null,
      onViewportChange: options.onViewportChange ?? null,
      cursorLineHighlight: normalizeCursorLineHighlight(options.cursorLineHighlight),
      rowElements: new Map(),
      rowPool: [],
      highlightRegistry: options.highlightRegistry ?? getDefaultHighlightRegistry(),
      selectionHighlightName: options.selectionHighlightName ?? DEFAULT_SELECTION_HIGHLIGHT,
      selectionHighlight: null,
      rangeHighlightGroups: new Map(),
      highlightOverlaySnapshot: null,
      highlightOverlayMask: [],
      overlayBaseGroups: new Map(),
      selectionHighlightRegistered: false,
      model: initialModel,
      textRevision: 0,
      displayProjectionRevision: 0,
      tokens: EditorTokenStore.empty(),
      tokenPaletteDirty: true,
      foldMarkers: [],
      foldMarkerSource: null,
      rowDecorations: new Map(),
      foldMarkerByStartRow: new Map(),
      foldMarkerByKey: new Map(),
      wrapEnabled: options.wrap ?? false,
      wrapBreak: options.wrapBreak ?? 'character',
      wrapAdvance: null,
      glyphs: measuredFace.monospace ? null : glyphAdvancesFor(scrollElement),
      tabSize,
      tokenGroups: new Map(),
      rowTokenSignatures: new Map(),
      rowTokenRanges: new Map(),
      tokenProjectionDirtyStartRow: null,
      nextTokenHighlightSlotId: 0,
      selectionStart: null,
      selectionEnd: null,
      selectionHead: null,
      selections: [],
      inlineMapBase: null,
      lastSelectionHighlightSignature: '',
      lastRenderedRowsKey: '',
      gutterContributionWidths: new Map(),
      gutterWidthDirty: true,
      currentGutterWidth: 0,
      currentGutterLeadingInset: 0,
      contentWidth: 0,
      maxVisualColumnsSeen: 0,
      lastWidthScanStart: 0,
      lastWidthScanEnd: -1,
      sameLineTokenEdit: null,
      lineHeightOverride,
      rowGap,
      metrics: { ...measuredMetrics, rowHeight },
      monospace: measuredFace.monospace,
      textMetrics,
      hiddenCharacters: normalizeHiddenCharactersMode(options.hiddenCharacters),
      suspiciousCharacters: DEFAULT_SUSPICIOUS_SETTINGS,
    }

    scrollElement.style.setProperty('--editor-gutter-width', '0px')
    scrollElement.style.setProperty('--editor-tab-size', String(tabSize))
    setScrollModeAttribute(scrollElement, scrollMode)
    scrollElement.dataset.editorRowPositioning = rowPositioning
    applyRowHeight(this.view, rowHeight)
    gutterElement.className = 'editor-virtualized-gutter'
    caretLayerElement.className = 'editor-virtualized-caret-layer'
    caretElement.className = 'editor-virtualized-caret'
    caretElement.hidden = true
    caretLayerElement.appendChild(caretElement)
    if (gutterContributions.length > 0 || gutterWidthProvider) {
      viewport.gutterSpacer.appendChild(gutterElement)
    }
    spacer.appendChild(caretLayerElement)
    scrollElement.appendChild(inputElement)

    virtualizer.attachScrollElement(
      scrollElement,
      (snapshot) => {
        this.renderSnapshot(snapshot)
      },
      {
        readInitialScrollPosition: false,
        onScroll: () => {
          this.synchronizeScrollPaint(virtualizer.getViewportSnapshot())
          options.onViewportScroll?.()
        },
      },
    )
    this.disposeForegroundHighlightRestore = subscribeToForegroundHighlightRestore(this.view)
    rebuildStyleRules(this.view)
  }

  public dispose(): void {
    const view = this.view
    if (view.disposed) return
    view.disposed = true
    this.atomicRenderPending = false
    const rows = new Set(view.rowElements.values())
    for (const row of view.rowPool) rows.add(row)
    view.rowElements.clear()
    view.rowPool.length = 0
    const releaseWidgets = takeInlineWidgets(view)
    const releaseCells = takeGutterCells(view, rows)
    for (const row of rows) invalidateRowPresentations(row.element)
    this.releaseProvisionalPaint()
    this.pendingReveal = null
    this.cancelContentWidthMeasurement?.()
    this.cancelContentWidthMeasurement = null
    this.disposeForegroundHighlightRestore()
    cancelDeferredCaret(view)
    clearSelectionHighlight(view)
    for (const name of view.rangeHighlightGroups.keys()) clearRangeHighlight(view, name)
    clearTokenHighlights(view)
    view.virtualizer.dispose()
    this.scrollElement.remove()
    view.styleEl.remove()
    view.model.projection.dispose()
    view.model.textSnapshot = view.model.projection.textSnapshot
    view.model.textLength = 0
    view.model.lineCount = 1
    view.model.visibleLineCount = 0
    view.model.foldMap = null
    view.model.inlineMap = null
    view.model.injectedTextRows = []
    view.inlineMapBase = null
    view.foldMarkers = []
    view.foldMarkerSource = null
    view.foldMarkerByStartRow = new Map()
    view.foldMarkerByKey = new Map()
    let failure: { readonly error: unknown } | null = null
    try {
      releaseWidgets()
    } catch (error) {
      failure = { error }
    }
    try {
      releaseCells()
    } catch (error) {
      failure ??= { error }
    }
    if (failure) throw failure.error
  }

  /** The offset the next text replacement should render at, so a restore costs one pass, not two. */
  public requestScrollTop(value: number): void {
    this.pendingReveal = null
    this.view.virtualizer.requestScrollTop(value)
  }

  public paintConfiguration(): string {
    const view = this.view
    return JSON.stringify({
      rowGap: view.rowGap,
      gutterLeadingInset: view.gutterLeadingInset,
      gutterScroll: view.viewport.gutterScroll,
      rowPositioning: view.rowPositioning,
      scrollMode: view.scrollMode,
      hiddenCharacters: view.hiddenCharacters,
      suspiciousCharacters: view.suspiciousCharacters,
      cursorLineHighlight: view.cursorLineHighlight,
      // Overlay reservations depend on live document overflow. Saved paint owns
      // its geometry until takeover; an empty bootstrap has different reservations.
    })
  }

  public captureSelectionPaint() {
    const window = this.scrollElement.ownerDocument.defaultView
    const origin = this.view.spacer.getBoundingClientRect()
    const viewport = this.scrollElement.getBoundingClientRect()
    const rectangles = Array.from(
      this.view.spacer.querySelectorAll<HTMLElement>('.editor-virtualized-selection-range'),
    ).flatMap((element) => {
      const bounds = element.getBoundingClientRect()
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) return []
      return [
        {
          left: bounds.left - origin.left,
          top: bounds.top - origin.top - this.view.viewport.paintOffsetY,
          width: bounds.width,
          height: bounds.height,
          backgroundColor: window?.getComputedStyle(element).backgroundColor ?? '',
        },
      ]
    })
    return { id: 'editor.selection', rectangles }
  }

  public captureRowBackgrounds() {
    const window = this.scrollElement.ownerDocument.defaultView
    return getMountedRows(this.view).map((row) => ({
      backgroundColor: window?.getComputedStyle(row.element).backgroundColor ?? '',
      color: window?.getComputedStyle(row.element).color ?? '',
      gutterBackgroundColor: window?.getComputedStyle(row.gutterElement).backgroundColor ?? '',
    }))
  }

  public captureGutterPaint() {
    return captureGutterPaint(this.view)
  }

  public get hasPendingReveal(): boolean {
    return this.pendingReveal !== null
  }

  public get savedPaint(): SavedPaint | null {
    return this.provisionalPaint?.paint ?? null
  }

  public measureInitialViewport(): void {
    if (this.view.virtualizer.hasMeasuredViewport()) return
    // Layout first: the padding read after it finds style already clean.
    const clientWidth = this.scrollElement.clientWidth
    const clientHeight = this.scrollElement.clientHeight
    const padding = scrollElementPadding(this.scrollElement)
    this.view.virtualizer.setScrollMetrics({
      scrollTop: 0,
      scrollLeft: 0,
      viewportWidth: Math.max(0, clientWidth - padding.left - padding.right),
      viewportHeight: Math.max(0, clientHeight - padding.top - padding.bottom),
      borderBoxWidth: this.scrollElement.offsetWidth,
      borderBoxHeight: this.scrollElement.offsetHeight,
    })
  }

  public get isProvisional(): boolean {
    return this.view.provisional
  }

  public get provisionalScrollPosition(): { top: number; left: number } | null {
    const paint = this.provisionalPaint?.paint
    return paint ? { top: paint.scrollTop, left: paint.scrollLeft } : null
  }

  public restorePaint(paint: SavedPaint): boolean {
    const inset = paint.gutterWidth > 0 ? this.view.gutterLeadingInset : 0
    if (paint.gutterLayout.leadingInset !== inset) return false

    const liveWidths =
      this.pendingOverlayWidths ??
      new Map<'left' | 'right', number>([
        ['left', this.reservedOverlayWidth('left')],
        ['right', this.reservedOverlayWidth('right')],
      ])
    this.releaseProvisionalPaint()
    clearTokenHighlights(this.view)
    clearSelectionHighlight(this.view)
    this.view.caretLayerElement.hidden = true
    this.view.provisional = true
    this.pendingOverlayWidths = liveWidths
    this.view.viewport.reserveOverlayWidth('left', paint.reservedLeft)
    this.view.viewport.reserveOverlayWidth('right', paint.reservedRight)
    this.scrollElement.dataset.editorPresentation = 'provisional'
    this.scrollElement.setAttribute('aria-busy', 'true')
    this.scrollElement.inert = true
    this.setInputEditable(false)
    this.view.viewport.setDocumentWidth(paint.scrollWidth)
    this.view.viewport.setDocumentHeight(paint.scrollHeight, 0)
    this.view.viewport.setViewportSize(paint.viewportWidth, paint.viewportHeight)
    this.view.viewport.setScrollPosition(paint.scrollLeft, paint.scrollTop)
    this.scrollElement.style.setProperty('--editor-gutter-width', `${paint.gutterWidth}px`)
    setGutterLeadingInsetProperty(this.view, inset)
    const release = paintProvisionalRows(this.view, paint)
    if (!release) {
      this.commitProvisionalPaint()
      return false
    }
    this.provisionalPaint = { paint, release }
    this.view.virtualizer.setProvisionalScrollGeometry(paint)
    this.scrollElement.addEventListener('wheel', this.preventProvisionalInput, {
      passive: false,
      capture: true,
    })
    this.scrollElement.addEventListener('touchmove', this.preventProvisionalInput, {
      passive: false,
      capture: true,
    })
    this.scrollElement.addEventListener('scroll', this.freezeProvisionalScroll, true)
    this.freezeProvisionalScroll()
    return true
  }

  public commitProvisionalPaint(): void {
    if (!this.view.provisional) return
    const overlayWidths = this.pendingOverlayWidths
    this.releaseProvisionalPaint()
    for (const [side, width] of overlayWidths ?? []) this.reserveOverlayWidth(side, width)
    const view = this.view
    view.lastRenderedRowsKey = ''
    view.gutterContributionWidths = new Map()
    view.gutterWidthDirty = true
    clearRowTokenState(view)
    clearRowGeometryCaches(view)
    resetContentWidthScan(view)
    this.renderSnapshot(view.virtualizer.getSnapshot())
  }

  public preparedVisibleRange(): { startIndex: number; endIndex: number } {
    const view = this.view
    const snapshot = view.virtualizer.getSnapshot()
    const first = snapshot.virtualItems[0]?.index ?? 0
    const last = snapshot.virtualItems.at(-1)?.index ?? first
    return { startIndex: lineStartOffset(view, first), endIndex: lineEndOffset(view, last) }
  }

  private releaseProvisionalPaint(): void {
    this.provisionalPaint?.release()
    this.provisionalPaint = null
    this.pendingOverlayWidths = null
    this.view.provisional = false
    this.view.virtualizer.setProvisionalScrollGeometry(null)
    this.scrollElement.inert = false
    this.view.caretLayerElement.hidden = false
    this.scrollElement.dataset.editorPresentation = 'live'
    this.scrollElement.removeAttribute('aria-busy')
    this.scrollElement.removeEventListener('wheel', this.preventProvisionalInput, true)
    this.scrollElement.removeEventListener('touchmove', this.preventProvisionalInput, true)
    this.scrollElement.removeEventListener('scroll', this.freezeProvisionalScroll, true)
  }

  private readonly preventProvisionalInput = (event: Event): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  private readonly freezeProvisionalScroll = (): void => {
    const paint = this.provisionalPaint?.paint
    if (!paint) return
    this.scrollElement.scrollTop = paint.scrollTop
    this.scrollElement.scrollLeft = paint.scrollLeft
  }

  public runAtomicRender<T>(update: () => T): T {
    this.atomicRenderDepth += 1
    try {
      return update()
    } finally {
      this.atomicRenderDepth -= 1
      this.flushAtomicRender()
    }
  }

  get isRenderingAtomically(): boolean {
    return this.atomicRenderDepth > 0 || this.flushingAtomicRender
  }

  public setText(
    text: string | TextSnapshot,
    preparedLineStarts?: readonly number[],
    preparedTokens?: EditorTokenStore,
  ): void {
    const textSnapshot = typeof text === 'string' ? createStringTextSnapshot(text) : text
    const view = this.view
    this.pendingReveal = null
    view.sameLineTokenEdit = null
    view.tokenProjectionDirtyStartRow = null
    if (preparedTokens) {
      view.tokens = preparedTokens
      view.tokenPaletteDirty = true
    }
    const { lineCountChanged } = setTextLayoutState(view, textSnapshot, preparedLineStarts)
    this.finishTextReplacement(lineCountChanged)
  }

  public refreshGutterWidth(): void {
    const view = this.view
    view.gutterWidthDirty = true
    this.renderSnapshot(view.virtualizer.getSnapshot())
  }

  public setFoldMap(foldMap: FoldMap | null): void {
    if (this.view.foldMarkerSource) {
      this.setIndexedFoldState(this.view.foldMarkerSource, foldMap)
      return
    }
    this.setFoldState(this.view.foldMarkers, foldMap)
  }

  /** Spans of source the painted map stands something else in for; insertions cover none. */
  public inlineReplacementRanges(): readonly TextOffsetRange[] {
    const ranges = this.view.model.inlineMap?.ranges ?? []
    return ranges
      .filter((range) => range.insertion !== true)
      .map((range) => ({ start: range.startOffset, end: range.endOffset }))
  }

  public setInlineMap(inlineMap: InlineMap | null): void {
    const view = this.view
    view.inlineMapBase = inlineMapMatchesText(inlineMap, view.model.textLength) ? inlineMap : null
    this.refreshInlineReveal()
  }

  // Selection reveal, mapping, and painting share the same derived inline map.
  private refreshInlineReveal(): void {
    const view = this.view
    const base = view.inlineMapBase
    const next = base ? revealInlineMap(base, selectionOffsetRanges(view)) : null
    if (view.model.inlineMap === next) return

    view.model.inlineMap = next
    clearRowTokenState(view)
    refreshDisplayProjection(view, horizontalViewportColumns(view))
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
  }

  public setFoldMarkers(markers: readonly VirtualizedFoldMarker[]): void {
    this.setFoldState(markers, this.view.model.foldMap)
  }

  public setFoldState(markers: readonly VirtualizedFoldMarker[], foldMap: FoldMap | null): void {
    const view = this.view
    const update = setFoldStateLayout(view, markers, foldMap)
    if (!update.changed) return

    if (update.foldMapChanged) clearRowTokenState(view)
    if (update.foldMapChanged) refreshDisplayProjection(view, horizontalViewportColumns(view))

    view.lastRenderedRowsKey = ''
    if (update.foldMapChanged) {
      updateVirtualizerRows(view)
      return
    }

    this.renderSnapshot(view.virtualizer.getSnapshot())
  }

  public setIndexedFoldState(source: FoldMarkerSource, foldMap: FoldMap | null): void {
    const view = this.view
    const nextMap = foldMapMatchesText(foldMap, view.model.textLength) ? foldMap : null
    const mapChanged = view.model.foldMap !== nextMap
    view.foldMarkerSource = source
    view.foldMarkers = []
    view.foldMarkerByStartRow = new Map()
    view.foldMarkerByKey = new Map()
    view.model.foldMap = nextMap
    if (mapChanged) {
      view.lastRenderedRowsKey = ''
      clearRowTokenState(view)
      refreshDisplayProjection(view, horizontalViewportColumns(view))
      updateVirtualizerRows(view)
      return
    }
    if (this.applyingEdit) return
    if (this.atomicRenderPending) {
      view.lastRenderedRowsKey = ''
      return
    }
    updateMountedFoldMarkers(view)
  }

  public refreshMetrics(): BrowserTextMetrics {
    const view = this.view
    invalidateScrollElementPadding(this.scrollElement)
    const face = measuredTextFace(this.scrollElement, view.textMetrics)
    view.monospace = face.monospace
    view.glyphs = face.monospace ? null : glyphAdvancesFor(this.scrollElement)
    const rowHeightValue = normalizeRowHeight(view.lineHeightOverride ?? face.metrics.rowHeight)
    this.applyMetrics({ rowHeight: rowHeightValue, characterWidth: face.metrics.characterWidth })
    return view.metrics
  }

  /** Re-measures and applies a reading that differs from the one in use; null when none does. */
  public remeasureMetrics(): BrowserTextMetrics | null {
    const view = this.view
    invalidateScrollElementPadding(this.scrollElement)
    const face = measuredTextFace(this.scrollElement, view.textMetrics)
    const rowHeight = normalizeRowHeight(view.lineHeightOverride ?? face.metrics.rowHeight)
    const glyphs = face.monospace ? null : glyphAdvancesFor(this.scrollElement)
    const unchanged =
      rowHeight === view.metrics.rowHeight &&
      face.metrics.characterWidth === view.metrics.characterWidth &&
      face.monospace === view.monospace
    if (unchanged) {
      // A late face can keep the average width and still move single glyphs.
      if (glyphs !== view.glyphs) this.applyGlyphs(glyphs)
      return null
    }

    view.monospace = face.monospace
    view.glyphs = glyphs
    this.applyMetrics({ rowHeight, characterWidth: face.metrics.characterWidth })
    return view.metrics
  }

  /**
   * Measures in the same call, so nothing between the write and the next frame positions a caret
   * or a row with the old face's widths. Null when the metrics in use did not change.
   */
  public setFontSize(fontSize: number | undefined): BrowserTextMetrics | null {
    if (!setFontVariable(this.scrollElement, '--editor-font-size', fontSizeValue(fontSize)))
      return null
    return this.remeasureMetrics()
  }

  public setFontFamily(fontFamily: string | undefined): BrowserTextMetrics | null {
    if (!setFontVariable(this.scrollElement, '--editor-font-family', fontFamilyValue(fontFamily)))
      return null
    return this.remeasureMetrics()
  }

  public setTabSize(tabSize: number | undefined): boolean {
    const view = this.view
    const next = normalizeTabSize(tabSize)
    if (view.tabSize === next) return false

    view.tabSize = next
    setStyleValue(view.scrollElement, '--editor-tab-size', String(next))
    // A tab's width moves every column after it: wrap points, the horizontal extent, hit tests.
    refreshDisplayProjection(view, horizontalViewportColumns(view))
    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
    return true
  }

  /** Adopts metrics measured elsewhere, for a view that mirrors another view's rows. */
  public setTextMetrics(metrics: BrowserTextMetrics): boolean {
    const view = this.view
    view.textMetrics = metrics
    view.lineHeightOverride = normalizeRowHeight(metrics.rowHeight)
    return this.remeasureMetrics() !== null
  }

  public setLineHeight(lineHeight: number): boolean {
    const view = this.view
    const rowHeightValue = normalizeRowHeight(lineHeight)
    view.lineHeightOverride = rowHeightValue
    if (view.metrics.rowHeight === rowHeightValue) return false

    this.applyMetrics({ ...view.metrics, rowHeight: rowHeightValue })
    return true
  }

  public setRowHeight(rowHeight: number): boolean {
    return this.setLineHeight(rowHeight)
  }

  public setGutterScroll(mode: NonNullable<VirtualizedTextViewOptions['gutterScroll']>): boolean {
    if (this.view.viewport.gutterScroll === mode) return false
    this.view.viewport.gutterScroll = mode
    this.view.lastRenderedRowsKey = ''
    this.renderSnapshot(this.view.virtualizer.getSnapshot())
    return true
  }

  public setGutterLeadingInset(inset: number): boolean {
    const view = this.view
    const next = normalizeGutterLeadingInset(inset)
    if (view.gutterLeadingInset === next) return false

    view.gutterLeadingInset = next
    view.lastRenderedRowsKey = ''
    view.gutterWidthDirty = true
    this.renderSnapshot(view.virtualizer.getSnapshot())
    return true
  }

  public setRowGap(rowGap: number): boolean {
    const view = this.view
    const nextRowGap = normalizeRowGap(rowGap)
    if (view.rowGap === nextRowGap) return false

    view.rowGap = nextRowGap
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
    return true
  }

  public setScrollMode(scrollMode: VirtualizedTextViewScrollMode | undefined): boolean {
    const view = this.view
    const nextScrollMode = normalizeScrollMode(scrollMode)
    if (view.scrollMode === nextScrollMode) return false

    view.scrollMode = nextScrollMode
    setScrollModeAttribute(view.scrollElement, nextScrollMode)
    view.lastRenderedRowsKey = ''
    view.virtualizer.updateOptions({
      scrollMode: nextScrollMode,
      maxScrollHeight: nextScrollMode === 'virtualized' ? this.measuredMaxScrollHeight : undefined,
    })
    return true
  }

  private applyGlyphs(glyphs: GlyphAdvances | null): void {
    const view = this.view
    view.glyphs = glyphs
    clearRowGeometryCaches(view)
    resetContentWidthScan(view)
    view.lastRenderedRowsKey = ''
    if (this.refreshWrapWidth()) return
    updateVirtualizerRows(view)
  }

  private applyMetrics(metrics: BrowserTextMetrics): void {
    const view = this.view
    view.metrics = metrics
    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    const rowHeightValue = metrics.rowHeight
    applyRowHeight(view, rowHeightValue)
    view.gutterWidthDirty = true
    updateGutterWidthIfNeeded(view)
    if (view.disposed) return
    view.lastRenderedRowsKey = ''
    if (this.refreshWrapWidth()) return
    updateVirtualizerRows(view)
  }

  public applyEdit(
    edit: TextEdit,
    nextText: TextSnapshot | string,
    updateFoldState?: () => void,
  ): void {
    const view = this.view
    const textSnapshot =
      typeof nextText === 'string' ? createStringTextSnapshot(nextText) : nextText
    this.applyingEdit = true
    try {
      const sameLinePatch = sameLineEditPatch(view, edit)
      if (sameLinePatch) {
        this.applySameLineEdit(sameLinePatch, edit, textSnapshot, updateFoldState)
        return
      }

      const multiLinePatch = multiLineEditPatch(view, edit)
      if (multiLinePatch) {
        this.applyMultiLineEdit(multiLinePatch, edit, textSnapshot, updateFoldState)
        return
      }

      this.applyProjectionEdit(edit, textSnapshot, updateFoldState)
    } finally {
      this.applyingEdit = false
      this.flushAtomicRender()
    }
  }

  public applyEditBatch(batch: TextEditBatch): void {
    const view = this.view
    const previousLineCount = view.model.lineCount
    applyTextLayoutTransition(view, batch)
    projectFoldMarkersThroughBatch(view, batch)
    view.rowDecorations = projectRowDecorationMapThroughEdits(view.rowDecorations, batch)
    view.sameLineTokenEdit = null
    view.tokenProjectionDirtyStartRow = null
    if (previousLineCount !== view.model.lineCount) view.gutterWidthDirty = true
    clampStoredSelection(view)
    clearRowTokenState(view)
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    resetContentWidthScan(view)
    updateVirtualizerRows(view)
  }

  public setTokens(tokens: EditorTokenInput): void {
    setViewTokens(this.view, tokens)
  }

  public adoptTokens(tokens: EditorTokenStore): void {
    adoptViewTokens(this.view, tokens)
  }

  public restorePresentationHighlights(): void {
    restoreHighlightsAfterPresentation(this.view)
  }

  public setTheme(theme: EditorTheme | null | undefined): void {
    applyEditorTheme(this.scrollElement, theme)
  }

  public setEditable(editable: boolean): void {
    if (this.view.provisional) editable = false
    this.setInputEditable(editable)
  }

  /** An EditContext only receives text while attached, so a read-only view detaches it. */
  private setInputEditable(editable: boolean): void {
    const input = this.inputElement
    if (isTextareaElement(input)) {
      input.readOnly = !editable
      return
    }

    attachEditContext(input, editable ? this.editContext : null)
    input.setAttribute('aria-readonly', String(!editable))
  }

  /** Where each character of the drawn composition candidate sits. */
  public compositionCharacterRects(): DOMRect[] {
    return compositionCharacterRects(this.view)
  }

  /** The text an IME is still assembling, drawn at the caret; empty text takes it back down. */
  public setCompositionPreedit(text: string): void {
    if (this.view.provisional) return
    setCompositionPreedit(this.view, text)
  }

  public focusInput(): void {
    if (this.view.provisional) return
    const view = this.view
    const snapshot = view.virtualizer.getSnapshot()
    const scrollTop = snapshot.scrollTop
    const scrollLeft = this.scrollElement.scrollLeft
    flushDeferredCaret(view)
    positionInputAtCaret(view)
    // Focus and nothing more: the value and the caret inside it belong to whoever knows the
    // document, and are rewritten from it on every selection change. Emptying them here would take
    // the screen reader's only view of the text away on each click, and leave an edit deduced from
    // the element nothing to be deduced against.
    this.inputElement.focus({ preventScroll: true })
    restoreScrollPosition(view, scrollTop, scrollLeft)
  }

  public setScrollMetrics(
    scrollTop: number,
    viewportHeight: number,
    viewportWidth?: number,
    scrollLeft?: number,
  ): void {
    this.view.virtualizer.setScrollMetrics({
      scrollTop,
      viewportHeight,
      viewportWidth,
      scrollLeft,
    })
  }

  public isWrapEnabled(): boolean {
    return this.view.wrapEnabled
  }

  public setWrapEnabled(enabled: boolean): void {
    const view = this.view
    if (!setWrapEnabledLayout(view, enabled, horizontalViewportColumns(view))) return

    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
  }

  public setSuspiciousCharacters(options: ResolvedSuspiciousCharactersOptions): boolean {
    return setSuspiciousCharacters(this.view, options)
  }

  public setHiddenCharacters(mode: HiddenCharactersMode): void {
    const view = this.view
    const next = normalizeHiddenCharactersMode(mode)
    if (view.hiddenCharacters === next) return

    view.hiddenCharacters = next
    renderHiddenCharacters(view)
  }

  public setInjectedTextRows(injectedTextRows: readonly InjectedTextRow[]): void {
    const view = this.view
    setInjectedTextRowsLayout(view, injectedTextRows, horizontalViewportColumns(view))
    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    view.gutterWidthDirty = true
    updateVirtualizerRows(view)
  }

  public setRowDecorations(decorations: ReadonlyMap<number, VirtualizedTextRowDecoration>): void {
    const view = this.view
    view.rowDecorations = decorations
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    this.renderSnapshot(view.virtualizer.getSnapshot())
  }

  public setGutterContributions(contributions: readonly EditorGutterContribution[]): boolean {
    if (!updateGutterContributions(this.view, contributions)) return false

    this.renderSnapshot(this.view.virtualizer.getSnapshot())
    return true
  }

  public reserveOverlayWidth(side: 'left' | 'right', width: number): boolean {
    if (this.view.provisional) {
      this.pendingOverlayWidths?.set(side, width)
      return false
    }
    return this.view.viewport.reserveOverlayWidth(side, width)
  }

  /** Overlay padding and the visible gutter inside the native scroll viewport. */
  public textViewportInsets(): { readonly left: number; readonly right: number } {
    const padding = scrollElementPadding(this.scrollElement)
    return { left: padding.left + visibleGutterWidth(this.view), right: padding.right }
  }

  public reservedOverlayWidth(side: 'left' | 'right'): number {
    return this.view.viewport.reservedOverlayWidth(side)
  }

  public onReservedOverlayWidthChange(listener: ((side: 'left' | 'right') => void) | null): void {
    this.view.viewport.onReservedOverlayWidthChange = listener
  }

  /** Return the projected row top for a document offset. */
  public topForOffset(offset: number): number {
    return rowTop(this.view, rowForOffset(this.view, offset))
  }

  /** Scroll a zero-based document line to the top through the display projection. */
  public scrollToRow(row: number): void {
    const lines = this.getLineStartsView()
    const offset = lines.at(Math.max(0, Math.min(lines.length - 1, Math.floor(row)))) ?? 0
    if (this.view.provisional) {
      this.pendingReveal = { offset, block: 'nearest' }
      return
    }
    scrollToRow(this.view, rowForOffset(this.view, offset))
  }

  public revealOffset(offset: number, block: RevealBlock = 'nearest'): void {
    this.reveal(offset, block)
  }

  public revealCaret(
    offset: number,
    affinity: SelectionAffinity,
    block: RevealBlock = 'nearest',
  ): void {
    this.reveal(offset, block, affinity)
  }

  private reveal(offset: number, requested: RevealBlock, affinity?: SelectionAffinity): void {
    if (this.view.provisional) {
      this.pendingReveal = { offset, block: requested, affinity }
      return
    }
    const view = this.view
    this.pendingReveal = null
    // Initial navigation can arrive before ResizeObserver measures the viewport.
    if (requested !== 'nearest' && view.virtualizer.getSnapshot().viewportHeight === 0) {
      this.pendingReveal = { offset, block: requested, affinity }
      return
    }

    const block = settledRevealBlock(view, offset, requested, affinity)
    if (block !== 'nearest') {
      scrollOffsetToViewportBlock(view, offset, block, affinity)
      ensureOffsetMounted(view, offset, affinity)
      return
    }

    ensureOffsetMounted(view, offset, affinity)
    scrollOffsetIntoView(view, offset, affinity)
  }

  /** The rendered replacements a caret steps over whole and a delete takes whole. */
  public atomicRanges(): AtomicRanges {
    return atomicRangesForInlineMap(this.view.model.inlineMap)
  }

  public visualHorizontalTarget(
    offset: number,
    affinity: SelectionAffinity,
    direction: 'left' | 'right',
  ): VisualCaretTarget | null {
    return visualHorizontalTarget(this.view, offset, affinity, direction)
  }

  public caretXForOffset(offset: number, affinity: SelectionAffinity): number {
    return caretXForOffset(this.view, offset, affinity)
  }

  public verticalCaretTarget(
    offset: number,
    affinity: SelectionAffinity,
    rowDelta: number,
    goal: VerticalSelectionGoal,
  ): VisualCaretTarget {
    return verticalCaretTarget(this.view, offset, affinity, rowDelta, goal)
  }

  public visualColumnForOffset(offset: number): number {
    return visualColumnForOffset(this.view, offset)
  }

  public offsetByDisplayRows(offset: number, rowDelta: number, visualColumn: number): number {
    const view = this.view
    const row = rowForOffset(view, offset)
    const targetRow = documentTextRowByDisplayDelta(view, row, rowDelta)
    return offsetForViewportColumn(view, targetRow, visualColumn)
  }

  public offsetAtLineBoundary(offset: number, boundary: 'start' | 'end'): number {
    const view = this.view
    const row = rowForOffset(view, offset)
    if (boundary === 'start') return lineStartOffset(view, row)
    return lineEndOffset(view, row)
  }

  public pageRowDelta(): number {
    return pageRowDelta(this.view)
  }

  public getProjectionDiagnostics() {
    return this.view.model.projection.diagnostics
  }

  public getLineStarts(): readonly number[] {
    return this.getLineStartsView().toArray()
  }

  public getLineStartsView(): LineStartsView {
    return new LineStartsView(this.view.model.textSnapshot)
  }

  public getLineCount(): number {
    return this.view.model.lineCount
  }

  public createRange(
    startOffset: number,
    endOffset: number,
    options: CreateRangeOptions = {},
  ): Range | null {
    if (this.view.provisional) return null
    const view = this.view
    if (options.scrollIntoView !== false) ensureOffsetMounted(view, startOffset)

    const start = resolveMountedOffset(view, startOffset)
    const end = resolveMountedOffset(view, endOffset)
    if (!start || !end) return null

    const range = this.scrollElement.ownerDocument.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    return range
  }

  public getViewport(): EditorViewportSnapshot {
    const view = this.view
    const snapshot = view.virtualizer.getViewportSnapshot()
    return {
      scrollTop: snapshot.scrollTop,
      scrollRow: snapshot.scrollRow,
      scrollLeft: snapshot.scrollLeft,
      scrollHeight: Math.max(snapshot.viewportHeight, snapshot.scrollHeight),
      scrollWidth: spacerWidth(view, snapshot.viewportWidth),
      clientHeight: snapshot.viewportHeight,
      clientWidth: snapshot.viewportWidth,
      borderBoxHeight: snapshot.borderBoxHeight,
      borderBoxWidth: snapshot.borderBoxWidth,
      visibleRange: snapshot.visibleRange,
    }
  }

  public captureDeferredFoldMarkerSource(): FoldMarkerSource | null {
    const view = this.view
    const source = view.foldMarkerSource
    if (!source || source.size === 0) return null
    if (view.gutterContributions.length > 0 || view.model.foldMap?.ranges.length) return null
    return source
  }

  public getState(): VirtualizedTextViewState {
    const view = this.view
    const snapshot = view.virtualizer.getSnapshot()
    const markerSource = view.foldMarkerSource
    const foldMarkers = view.foldMarkers
    return {
      lineCount: view.model.lineCount,
      contentWidth: view.contentWidth,
      gutterWidth: view.currentGutterWidth,
      gutterLayout: {
        leadingInset: view.currentGutterLeadingInset,
        fixedWidth:
          view.currentGutterWidth -
          view.currentGutterLeadingInset -
          Array.from(view.gutterContributionWidths.values()).reduce(
            (total, width) => total + width,
            0,
          ),
        lanes: view.gutterContributions.map((contribution) => ({
          id: contribution.id,
          width: view.gutterContributionWidths.get(contribution.id) ?? 0,
        })),
      },
      foldMapActive: view.model.foldMap !== null,
      metrics: view.metrics,
      scrollHeight: Math.max(snapshot.viewportHeight, snapshot.scrollHeight),
      scrollLeft: snapshot.scrollLeft,
      scrollTop: snapshot.scrollTop,
      scrollRow: snapshot.scrollRow,
      scrollWidth: spacerWidth(view, snapshot.viewportWidth),
      borderBoxHeight: snapshot.borderBoxHeight,
      borderBoxWidth: snapshot.borderBoxWidth,
      totalHeight: snapshot.totalSize,
      viewportHeight: snapshot.viewportHeight,
      viewportWidth: snapshot.viewportWidth,
      visibleRange: snapshot.visibleRange,
      mountedRows: view.provisional ? [] : getMountedRows(view),
      get foldMarkers() {
        return markerSource?.all() ?? foldMarkers
      },
      wrapActive: view.wrapEnabled,
      tabSize: view.tabSize,
    }
  }

  public validateMountedNativeGeometry(): NativeGeometryValidation {
    const rows = getMountedRows(this.view)
    const failures: string[] = []
    const caretChecks = countValidCaretChecks(rows, failures)
    const selectionChecks = countValidSelectionChecks(rows, failures)
    const hitTestChecks = countValidHitTestChecks(this.scrollElement, rows, failures)

    return {
      mountedRows: rows.length,
      caretChecks,
      selectionChecks,
      hitTestChecks,
      failures,
      ok: failures.length === 0,
    }
  }

  public getRowPresentation(displayRow: number): EditorRowPresentation | null {
    const row = this.view.rowElements.get(displayRow)
    return row ? acquireRowPresentation(row.element) : null
  }

  public rowAtPoint(clientX: number, clientY: number): EditorPointHit | null {
    const point = locatePoint(this.view, clientX, clientY)
    if (!point) return null
    const { bounds, metrics, row } = point
    const displayRow = row.index
    const view = this.view
    const base = { bufferRow: row.bufferRow, displayRow, source: row.source }
    if (
      (clientX - bounds.left) / bounds.scale <
      visibleGutterWidth(view, view.scrollElement.scrollLeft)
    )
      return { ...base, region: 'gutter', offset: null }
    const mounted = view.rowElements.get(displayRow)
    const extent =
      mounted?.kind === 'text'
        ? rowTextExtent(view, mounted).right
        : ((row.displayEndColumn - row.displayStartColumn) * view.metrics.characterWidth) /
          metrics.scale
    if (metrics.x > extent) return { ...base, region: 'trailing', offset: null }
    const offset = this.textPositionAt(point, false)?.offset ?? null
    return { ...base, region: 'text', offset }
  }

  public markerAtPoint(clientX: number, clientY: number): EditorMarkerHit | null {
    const point = locatePoint(this.view, clientX, clientY)
    if (!point) return null
    if (
      (clientX - point.bounds.left) / point.bounds.scale <
      visibleGutterWidth(this.view, this.scrollElement.scrollLeft)
    )
      return null
    const row = this.view.rowElements.get(point.row.index)
    return row?.kind === 'text' ? markerAtRowX(row, point.metrics.x) : null
  }

  public textOffsetFromPoint(clientX: number, clientY: number): number | null {
    const point = locatePoint(this.view, clientX, clientY, true)
    return point ? (this.textPositionAt(point, false)?.offset ?? null) : null
  }

  public textOffsetFromViewportPoint(clientX: number, clientY: number): number | null {
    return this.textOffsetFromPoint(clientX, clientY)
  }

  public textPositionFromPoint(
    clientX: number,
    clientY: number,
  ): VirtualizedTextHitPosition | null {
    if (this.view.provisional) return null
    return this.textPositionFromViewportPoint(clientX, clientY)
  }

  public textPositionFromViewportPoint(
    clientX: number,
    clientY: number,
  ): VirtualizedTextHitPosition | null {
    const point = locatePoint(this.view, clientX, clientY, true)
    return point ? this.textPositionAt(point, true) : null
  }

  private textPositionAt(
    point: NonNullable<ReturnType<typeof locatePoint>>,
    includeAffinity: boolean,
  ): VirtualizedTextHitPosition | null {
    const view = this.view
    const { metrics } = point
    const row = point.row.index
    if (metrics.verticalDirection < 0) {
      return textHitPosition(lineStartOffset(view, row), 'after', row, metrics.x)
    }
    if (metrics.verticalDirection > 0) {
      return textHitPosition(lineEndOffset(view, row), 'before', row, metrics.x)
    }
    if (point.row.source !== 'document') return null

    const mounted = view.rowElements.get(row)
    if (mounted?.kind === 'text' && rowMightContainRTL(view, mounted)) {
      if (includeAffinity) return bidiTextHitPosition(view, mounted, metrics)
      const offset = bidiOffsetFromViewportPoint(view, mounted, metrics)
      return offset === null ? null : textHitPosition(offset, 'after', row, metrics.x)
    }
    if (mounted?.kind === 'text') {
      const offset = xToOffset(view, mounted, metrics.x, metrics.scale)
      return textHitPosition(offset, endpointAffinity(mounted, offset), row, metrics.x)
    }

    const column = Math.floor(metrics.x / Math.max(1, view.metrics.characterWidth))
    const offset = offsetForViewportColumn(view, row, column)
    const affinity = offset === lineEndOffset(view, row) ? 'before' : 'after'
    return textHitPosition(offset, affinity, row, metrics.x)
  }

  public createBidiSelectionAnchor(
    position: VirtualizedTextHitPosition,
  ): VirtualizedBidiSelectionAnchor | null {
    const view = this.view
    const row = view.rowElements.get(position.displayRow)
    if (row?.kind !== 'text') return null
    if (!rowMightContainRTL(view, row)) return null

    const positions = boundaryPositionXs(view, row, position.offset)
    if (positions.length !== 2) return null
    if (positions[1]! - positions[0]! <= 1) return null

    const alternate = alternateBoundaryOffset(view, row, position.offset, positions)
    if (alternate === null) return null

    const intervalStart = Math.min(position.offset, alternate)
    const intervalEnd = Math.max(position.offset, alternate)
    const direction = bidiTwinIntervalDirection(view, row, intervalStart, intervalEnd)
    if (!direction) return null

    const anchorAtLeft = closestPositionX(positions, position.rowX) === positions[0]
    const mappings = bidiTwinAnchorMappings(intervalStart, intervalEnd, direction, anchorAtLeft)
    return {
      displayRow: position.displayRow,
      displayProjectionRevision: view.displayProjectionRevision,
      textRevision: view.textRevision,
      rawOffset: position.offset,
      rawAffinity: position.affinity,
      intervalStart,
      intervalEnd,
      ...mappings,
    }
  }

  public resolveBidiSelectionAnchor(
    anchor: VirtualizedBidiSelectionAnchor,
    head: VirtualizedTextHitPosition,
  ): number {
    if (anchor.textRevision !== this.view.textRevision) return anchor.rawOffset
    if (anchor.displayProjectionRevision !== this.view.displayProjectionRevision) {
      return anchor.rawOffset
    }
    if (head.displayRow < anchor.displayRow) return anchor.rightOffset
    if (head.displayRow > anchor.displayRow) return anchor.leftOffset
    if (head.offset === anchor.rawOffset && head.affinity === anchor.rawAffinity) {
      return anchor.rawOffset
    }
    if (bidiHeadInsideTwinInterval(anchor, head)) return anchor.insideOffset
    return anchor.outsideOffset
  }

  public textOffsetFromDomBoundary(node: Node, offset: number): number | null {
    return textOffsetFromDomBoundary(this.view, node, offset)
  }

  public setSelection(
    anchorOffset: number,
    headOffset: number,
    affinity: SelectionAffinity = 'after',
  ): void {
    setSelection(this.view, anchorOffset, headOffset, affinity)
    this.refreshInlineReveal()
  }

  public setSelections(selections: readonly VirtualizedTextSelection[]): void {
    setSelections(this.view, selections)
    this.refreshInlineReveal()
  }

  public clearSelection(): void {
    clearSelection(this.view)
    this.refreshInlineReveal()
  }

  public setRangeHighlight(
    name: string,
    ranges: readonly VirtualizedTextHighlightRange[],
    style: VirtualizedTextHighlightStyle,
  ): void {
    setRangeHighlight(this.view, name, ranges, style)
  }

  public clearRangeHighlight(name: string): void {
    clearRangeHighlight(this.view, name)
  }

  /** The rows' own height, wrapped rows included, so a host can size itself to its text. */
  public getContentHeight(): number {
    return this.view.virtualizer.getSnapshot().totalSize
  }

  private reportContentHeight(height: number): void {
    if (height === this.contentHeight) return
    this.contentHeight = height
    this.onContentHeightChange?.(height)
  }

  private renderSnapshot(snapshot: FixedRowVirtualizerSnapshot): void {
    if (this.view.disposed) return
    if (this.view.provisional) {
      this.freezeProvisionalScroll()
      this.reportViewportChange()
      return
    }
    if (this.atomicRenderDepth > 0 || this.applyingEdit) {
      this.atomicRenderPending = true
      return
    }

    const view = this.view
    if (
      this.measuredMaxScrollHeight === undefined &&
      view.scrollMode === 'virtualized' &&
      snapshot.viewportHeight > 0 &&
      view.model.textLength > 0 &&
      // Discover before native caps are reached, while ordinary opens remain layout-free.
      snapshot.totalSize > DEFAULT_MAX_SCROLL_HEIGHT / 4 &&
      snapshot.scrollHeight > snapshot.viewportHeight
    ) {
      this.measuredMaxScrollHeight = view.viewport.maxScrollHeight
      if (
        this.measuredMaxScrollHeight !== undefined &&
        view.virtualizer.updateOptions({ maxScrollHeight: this.measuredMaxScrollHeight })
      )
        return
    }
    this.synchronizeScrollPaint(snapshot)
    this.view.viewport.setViewportSize(snapshot.viewportWidth, snapshot.viewportHeight)
    this.reportContentHeight(snapshot.totalSize)
    if (view.disposed) return
    const visible = snapshot.viewportHeight > 0
    if (visible) {
      const first = snapshot.virtualItems[0]?.index ?? 0
      const last = snapshot.virtualItems.at(-1)?.index ?? -1
      view.model.projection.retainWindow(first, last + 1)
    }
    const revealed = visible && !this.viewportVisible
    this.viewportVisible = visible
    if (revealed) {
      this.refreshMetrics()
      return
    }
    updateGutterWidthIfNeeded(view)
    if (view.disposed) return
    if (visible && this.refreshWrapWidth(snapshot.viewportWidth)) return
    if (!visible) {
      this.cancelContentWidthMeasurement?.()
      this.cancelContentWidthMeasurement = null
      view.model.projection.clearCache()
    }

    const previousPaintOffsetY = view.viewport.paintOffsetY
    updateSpacerHeight(view, snapshot)
    if (view.viewport.paintOffsetY !== previousPaintOffsetY) rebaseCaretPaint(view)
    updateSpacerWidth(view, snapshot.viewportWidth)
    const key = rowsKey(view, snapshot)
    if (key === view.lastRenderedRowsKey) {
      this.reportViewportChange()
      this.flushPendingReveal()
      return
    }

    view.lastRenderedRowsKey = key
    renderRows(view, snapshot, (rowSlotId) => deleteTokenRangesForRow(view, rowSlotId))
    if (view.disposed) return
    this.applyKnownContentWidths(snapshot)
    renderTokenHighlights(view)
    for (const name of view.rangeHighlightGroups.keys()) renderRangeHighlight(view, name)
    renderSelectionHighlight(view)
    refreshCompositionPreedit(view)
    this.reportViewportChange()
    this.flushPendingReveal()
  }

  private reportViewportChange(): void {
    if (this.view.disposed || this.flushingAtomicRender) return
    this.view.onViewportChange?.()
  }

  private synchronizeScrollPaint(
    snapshot: Pick<FixedRowVirtualizerSnapshot, 'scrollLeft' | 'nativeScrollTop'>,
  ): void {
    if (this.view.provisional || this.atomicRenderDepth > 0 || this.applyingEdit) return
    this.view.viewport.setScrollPosition(snapshot.scrollLeft, snapshot.nativeScrollTop)
  }

  private flushPendingReveal(): void {
    if (this.view.disposed || !this.viewportVisible || !this.pendingReveal) return

    const pending = this.pendingReveal
    this.reveal(pending.offset, pending.block, pending.affinity)
  }

  private flushAtomicRender(): void {
    if (this.atomicRenderDepth > 0 || this.applyingEdit || !this.atomicRenderPending) return

    this.atomicRenderPending = false
    const wasFlushing = this.flushingAtomicRender
    this.flushingAtomicRender = true
    try {
      this.renderSnapshot(this.view.virtualizer.getSnapshot())
    } finally {
      this.flushingAtomicRender = wasFlushing
    }
    if (!wasFlushing) this.reportViewportChange()
  }

  /**
   * The horizontal scroll extent is a column-count estimate, and a wide glyph advances further than
   * the one cell it is counted as — so a CJK or emoji line reaches past the extent and its end
   * cannot be scrolled to. Rows that already know their rendered width correct it here for free;
   * the rest are measured off the critical path, because finding out costs a layout read and the
   * render pass has just finished writing to the DOM.
   */
  private applyKnownContentWidths(snapshot: FixedRowVirtualizerSnapshot): void {
    const view = this.view
    let unmeasured = false
    for (const row of view.rowElements.values()) {
      if (row.kind !== 'text') continue

      const width = knownRowScrollWidth(view, row)
      if (width === null) {
        unmeasured = true
        continue
      }

      raiseVisualColumnsSeen(view, width)
    }

    updateContentWidth(view, snapshot.virtualItems)
    if (unmeasured) this.scheduleContentWidthMeasurement()
  }

  private scheduleContentWidthMeasurement(): void {
    if (this.view.disposed || this.cancelContentWidthMeasurement) return

    const win = this.scrollElement.ownerDocument.defaultView
    if (!win) return

    const run = () => {
      this.cancelContentWidthMeasurement = null
      this.measureContentWidths()
    }

    if (typeof win.requestIdleCallback === 'function') {
      /**
       * @justification Measuring every row's width is the work the horizontal scroll extent needs
       * and nothing on screen is waiting for, so it is deliberately given whatever the frame has
       * left rather than a place in the queue. `cancelContentWidthMeasurement` withdraws it when
       * the content it would measure has already changed.
       */
      const handle = win.requestIdleCallback(run)
      this.cancelContentWidthMeasurement = () => win.cancelIdleCallback(handle)
      return
    }

    /**
     * @justification The same deferral for an engine with no idle callback. Zero rather than a
     * delay, because the point is only to leave the current frame, and the same cancel withdraws it.
     */
    const handle = win.setTimeout(run, 0)
    this.cancelContentWidthMeasurement = () => win.clearTimeout(handle)
  }

  private measureContentWidths(): void {
    const view = this.view
    let raised = false
    for (const row of view.rowElements.values()) {
      if (row.kind !== 'text') continue

      raised = raiseVisualColumnsSeen(view, measureRowScrollWidth(view, row)) || raised
    }

    if (!raised && !view.wrapEnabled) return
    updateContentWidth(view, view.virtualizer.getSnapshot().virtualItems)
  }

  private applySameLineEdit(
    patch: SameLineEditPatch,
    edit: TextEdit,
    nextText: TextSnapshot,
    updateFoldState?: () => void,
  ): void {
    const view = this.view
    const snapshot = view.virtualizer.getSnapshot()
    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after: nextText,
      edits: [edit],
    })
    clampStoredSelection(view)
    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    updateFoldState?.()
    if (this.atomicRenderPending) {
      view.sameLineTokenEdit = null
      view.lastRenderedRowsKey = ''
      return
    }
    updateContentWidth(view, snapshot.virtualItems)
    const editedRowPatchedInPlace = updateMountedRowsAfterSameLineEdit(
      view,
      snapshot.virtualItems,
      patch,
      snapshot,
    )
    if (view.disposed) return
    view.sameLineTokenEdit = {
      rowIndex: patch.rowIndex,
      editedRowPatchedInPlace,
      kind: 'same-line',
    }
    renderHiddenCharacters(view)
  }

  private applyMultiLineEdit(
    patch: MultiLineEditPatch,
    edit: TextEdit,
    nextText: TextSnapshot,
    updateFoldState?: () => void,
  ): void {
    const view = this.view
    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after: nextText,
      edits: [edit],
    })
    clampStoredSelection(view)
    resetContentWidthScan(view)
    clearRowGeometryCaches(view)
    if (patch.insertedLineBreaks !== patch.endRow - patch.startRow) view.gutterWidthDirty = true
    view.lastRenderedRowsKey = ''
    view.sameLineTokenEdit = {
      rowIndex: patch.startRow,
      editedRowPatchedInPlace: false,
      kind: 'multi-line',
    }
    view.tokenProjectionDirtyStartRow = dirtyTokenProjectionStartRow(
      view.tokenProjectionDirtyStartRow,
      patch.startRow,
    )
    projectFoldMarkersThroughMultiLineEdit(view, patch, edit)
    projectRowDecorationsThroughMultiLineEdit(view, patch)
    updateFoldState?.()
    clearTokenHighlightsFromRow(view, patch.startRow)
    updateVirtualizerRows(view)
    renderHiddenCharacters(view)
  }

  private applyProjectionEdit(
    edit: TextEdit,
    textSnapshot: TextSnapshot,
    updateFoldState?: () => void,
  ): void {
    const view = this.view
    const previousLineCount = view.model.lineCount
    const patch = sourceEditPatch(view, edit)
    applyTextLayoutTransition(view, {
      before: view.model.textSnapshot,
      after: textSnapshot,
      edits: [edit],
    })
    if (patch) {
      projectFoldMarkersThroughMultiLineEdit(view, patch, edit)
      projectRowDecorationsThroughMultiLineEdit(view, patch)
    }
    view.sameLineTokenEdit = null
    view.tokenProjectionDirtyStartRow = null
    if (previousLineCount !== view.model.lineCount) view.gutterWidthDirty = true
    clampStoredSelection(view)
    clearRowTokenState(view)
    clearRowGeometryCaches(view)
    view.lastRenderedRowsKey = ''
    resetContentWidthScan(view)
    updateFoldState?.()
    updateVirtualizerRows(view)
  }

  private finishTextReplacement(lineCountChanged: boolean): void {
    const view = this.view
    if (lineCountChanged) view.gutterWidthDirty = true
    if (view.provisional) updateGutterWidthIfNeeded(view)
    refreshDisplayProjection(view, horizontalViewportColumns(view))
    clampStoredSelection(view)
    clearRowTokenState(view)
    view.lastRenderedRowsKey = ''
    resetContentWidthScan(view)
    updateVirtualizerRows(view)
  }

  private refreshWrapWidth(
    viewportWidth = this.view.virtualizer.getSnapshot().viewportWidth,
  ): boolean {
    const view = this.view
    const changed = refreshDisplayProjectionForWrapWidth(
      view,
      horizontalViewportColumns(view, viewportWidth),
      viewportWidth,
    )
    if (!changed) return false

    resetContentWidthScan(view)
    view.lastRenderedRowsKey = ''
    updateVirtualizerRows(view)
    return true
  }
}

function locatePoint(
  view: VirtualizedTextViewInternal,
  clientX: number,
  clientY: number,
  clamp = false,
) {
  if (view.provisional) return null
  const bounds = pointViewport(view.scrollElement)
  if (
    !clamp &&
    (clientX < bounds.left ||
      clientX >= bounds.right ||
      clientY < bounds.top ||
      clientY >= bounds.bottom)
  )
    return null
  const metrics = viewportPointMetrics(view, clientX, clientY)
  const index = rowForViewportY(view, metrics.y)
  const y = view.scrollElement.scrollTop + metrics.y
  if (!clamp && (y < rowTop(view, index) || y >= rowTop(view, index) + view.metrics.rowHeight))
    return null
  const row = view.model.projection.getRowMetrics(index)
  return row ? { bounds, metrics, row } : null
}

type ViewportPointMetrics = ReturnType<typeof viewportPointMetrics>

function textHitPosition(
  offset: number,
  affinity: SelectionAffinity,
  displayRow: number,
  rowX: number,
): VirtualizedTextHitPosition {
  return { offset, affinity, displayRow, rowX }
}

function textHitPositionAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
): VirtualizedTextHitPosition | null {
  if (rowMightContainRTL(view, row)) return bidiTextHitPositionAtRowX(view, row, rowX)

  const hit = initialTextOffsetAtRowX(view, row, rowX)
  if (hit === null) return null

  const offset = closestTextOffsetNearHit(view, row, hit, rowX)
  return textHitPosition(offset, endpointAffinity(row, offset), row.index, rowX)
}

function initialTextOffsetAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
): number | null {
  // Calculated rows answer without touching layout. Measured rows must not fall through to xToOffset:
  // resolving that inverse reads every boundary in the row, while the browser already has the hit.
  if (!row.inlineMapping && isSimpleRowText(row)) return xToOffset(view, row, rowX)
  return hitTestBidiVisualProbeAtLocalX(view, row, rowX)
}

function closestTextOffsetNearHit(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  hit: number,
  rowX: number,
): number {
  const localHit = rowLocalIndexForOffset(row, hit)
  let closest = hit
  let distance = Number.POSITIVE_INFINITY
  for (const local of candidateGraphemeOffsets(row.text, localHit)) {
    const candidate = rowOffsetForLocalIndex(row, local)
    const candidateDistance = closestBoundaryDistance(view, row, candidate, rowX)
    if (candidateDistance >= distance) continue

    closest = candidate
    distance = candidateDistance
  }
  return closest
}

function bidiTextHitPosition(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  point: ViewportPointMetrics,
): VirtualizedTextHitPosition | null {
  const offset = bidiOffsetFromViewportPoint(view, row, point)
  const rowX = rowLocalXFromClientPoint(row, point.clientX)
  return bidiTextHitPositionForOffset(view, row, offset, rowX)
}

function bidiTextHitPositionAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
): VirtualizedTextHitPosition | null {
  const offset = bidiOffsetFromRowX(view, row, rowX)
  return bidiTextHitPositionForOffset(view, row, offset, rowX)
}

function bidiTextHitPositionForOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number | null,
  rowX: number,
): VirtualizedTextHitPosition | null {
  if (offset === null) return null

  const affinity = bidiPointAffinity(view, row, offset, rowX)
  return textHitPosition(offset, affinity, row.index, rowX)
}

function bidiPointAffinity(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  rowX: number,
): SelectionAffinity {
  const positions = boundaryPositionXs(view, row, offset)
  return bidiPointAffinityForPositions(view, row, offset, rowX, positions)
}

function bidiPointAffinityForPositions(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  rowX: number,
  positions: readonly number[],
): SelectionAffinity {
  const boundaryX = closestPositionX(positions, rowX)
  return boundaryAffinityForX(view, row, offset, boundaryX, positions)
}

function endpointAffinity(row: MountedVirtualizedTextRow, offset: number): SelectionAffinity {
  return offset >= row.endOffset ? 'before' : 'after'
}

function closestPositionX(positions: readonly number[], target: number): number {
  let closest = positions[0] ?? target
  let distance = Math.abs(closest - target)
  for (const position of positions.slice(1)) {
    const candidateDistance = Math.abs(position - target)
    if (candidateDistance >= distance) continue

    closest = position
    distance = candidateDistance
  }
  return closest
}

function alternateBoundaryOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  positions: readonly number[],
): number | null {
  for (const position of positions) {
    const candidate = hitTestRowOffsetAtLocalX(row, position)
    if (candidate === null || candidate === offset) continue
    if (!boundarySharesPositions(view, row, candidate, positions)) continue
    return candidate
  }
  return null
}

function boundarySharesPositions(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  expected: readonly number[],
): boolean {
  const actual = boundaryPositionXs(view, row, offset)
  if (actual.length !== expected.length) return false
  return expected.every((position) =>
    actual.some((candidate) => Math.abs(candidate - position) <= 1),
  )
}

type BidiTwinIntervalDirection = 'ltr' | 'rtl'

function bidiTwinIntervalDirection(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  intervalStart: number,
  intervalEnd: number,
): BidiTwinIntervalDirection | null {
  const next = nextRowUnitOffset(row, intervalStart)
  if (next <= intervalStart || next > intervalEnd) return null

  const rect = unitRectForOffset(view, row, intervalStart)
  if (!rect || rect.width <= 1) return null

  const left = hitTestRowOffsetAtLocalX(row, rect.left + rect.width * 0.25)
  const right = hitTestRowOffsetAtLocalX(row, rect.left + rect.width * 0.75)
  const leftAtStart = hitRepresentsBoundary(view, row, left, intervalStart)
  const leftAtNext = hitRepresentsBoundary(view, row, left, next)
  const rightAtStart = hitRepresentsBoundary(view, row, right, intervalStart)
  const rightAtNext = hitRepresentsBoundary(view, row, right, next)
  if (leftAtStart && rightAtNext) return 'ltr'
  if (leftAtNext && rightAtStart) return 'rtl'
  return null
}

function hitRepresentsBoundary(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  hit: number | null,
  expected: number,
): boolean {
  if (hit === expected) return true
  if (hit === null) return false
  return boundarySharesPositions(view, row, hit, boundaryPositionXs(view, row, expected))
}

function previousRowUnitOffset(row: MountedVirtualizedTextRow, offset: number): number {
  let local = rowLocalIndexForOffset(row, offset, 'before')
  while (local > 0) {
    const previous = previousGraphemeBoundary(row.text, local)
    if (previous === local) return offset

    // An insertion or replacement can paint several graphemes at one source point. Keep walking until
    // motion reaches a distinct document offset instead of reporting the same caret as its neighbor.
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

    // See previousRowUnitOffset: projected display units sharing one source point are atomic to motion.
    const target = rowOffsetForLocalIndex(row, next, 'after')
    if (target !== offset) return target
    local = next
  }
  return offset
}

function bidiTwinAnchorMappings(
  intervalStart: number,
  intervalEnd: number,
  direction: BidiTwinIntervalDirection,
  anchorAtLeft: boolean,
): Pick<
  VirtualizedBidiSelectionAnchor,
  'insideOffset' | 'outsideOffset' | 'leftOffset' | 'rightOffset'
> {
  if (direction === 'ltr') {
    return anchorAtLeft
      ? {
          insideOffset: intervalStart,
          outsideOffset: intervalEnd,
          leftOffset: intervalEnd,
          rightOffset: intervalStart,
        }
      : {
          insideOffset: intervalEnd,
          outsideOffset: intervalStart,
          leftOffset: intervalEnd,
          rightOffset: intervalStart,
        }
  }

  return anchorAtLeft
    ? {
        insideOffset: intervalEnd,
        outsideOffset: intervalStart,
        leftOffset: intervalStart,
        rightOffset: intervalEnd,
      }
    : {
        insideOffset: intervalStart,
        outsideOffset: intervalEnd,
        leftOffset: intervalStart,
        rightOffset: intervalEnd,
      }
}

function bidiHeadInsideTwinInterval(
  anchor: VirtualizedBidiSelectionAnchor,
  head: VirtualizedTextHitPosition,
): boolean {
  if (head.offset > anchor.intervalStart && head.offset < anchor.intervalEnd) return true
  if (head.offset === anchor.intervalStart) return head.affinity === 'after'
  if (head.offset === anchor.intervalEnd) return head.affinity === 'before'
  return false
}

function bidiOffsetFromViewportPoint(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  point: ViewportPointMetrics,
): number | null {
  const offset = hitTestRowOffset(row, point.clientX, point.clientY)
  const localX = rowLocalXFromClientPoint(row, point.clientX)
  return bidiOffsetAtRowX(view, row, localX, offset)
}

function bidiOffsetFromRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
): number | null {
  const offset = hitTestRowOffsetAtLocalX(row, rowX)
  return bidiOffsetAtRowX(view, row, rowX, offset)
}

function bidiOffsetAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
  offset: number | null,
): number | null {
  const advance = rowCharacterAdvance(view, row)
  const edgeOffset = bidiEdgeOffset(view, row, rowX, advance)
  if (edgeOffset !== null) return edgeOffset
  if (offset !== null) return offset

  const interpolated = interpolatedBidiOffset(view, row, rowX, advance)
  return interpolated ?? xToOffset(view, row, rowX)
}

function bidiEdgeOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
  advance: number,
): number | null {
  const extent = rowTextExtent(view, row)
  const halfAdvance = advance / 2
  if (x > extent.left + halfAdvance && x < extent.right - halfAdvance) return null

  const extremal = bidiExtremalBoundaries(view, row, advance)
  const leftBand = bidiEdgeBoundaryHalfWidth(view, row, extremal.left, extent.left, halfAdvance)
  if (x <= extent.left + leftBand) return extremal.left

  const rightBand = bidiEdgeBoundaryHalfWidth(view, row, extremal.right, extent.right, halfAdvance)
  if (x >= extent.right - rightBand) return extremal.right
  return null
}

function bidiEdgeBoundaryHalfWidth(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  boundary: number,
  edge: number,
  fallback: number,
): number {
  const minimum = fallback / 2
  const local = rowLocalIndexForOffset(row, boundary)
  const previous = previousGraphemeBoundary(row.text, local)
  const candidates = new Set([local, previous])
  for (const candidateLocal of candidates) {
    const candidate = rowOffsetForLocalIndex(row, candidateLocal)
    const rect = unitRectForOffset(view, row, candidate)
    if (!rect) continue

    const touchesEdge =
      Math.abs(rect.left - edge) <= 1 || Math.abs(rect.left + rect.width - edge) <= 1
    if (!touchesEdge) continue
    // RTL fallback glyphs are not guaranteed to fill the editor's Latin monospace advance. Keep
    // the outer quarter-advance in the repair band even when that glyph's own box is narrower.
    return Math.max(minimum, Math.min(fallback, rect.width / 2))
  }
  return fallback
}

function bidiExtremalBoundaries(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  advance: number,
): { readonly left: number; readonly right: number } {
  const cached = bidiExtremalBoundaryCaches.get(row.element)
  if (cached && row.geometryCache !== null && cached.geometry === row.geometryCache) return cached

  const extent = rowTextExtent(view, row)
  const left = resolveExtremalBoundary(view, row, extent.left, extent.left + advance * 0.75)
  const right = resolveExtremalBoundary(view, row, extent.right, extent.right - advance * 0.75)
  const geometry = row.geometryCache
  if (geometry !== null) bidiExtremalBoundaryCaches.set(row.element, { geometry, left, right })
  return { left, right }
}

function resolveExtremalBoundary(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  edge: number,
  sampleX: number,
): number {
  const offset = hitTestBidiVisualProbeAtLocalX(view, row, sampleX)
  if (offset === null) return closestRowEndpointToX(view, row, edge)

  const candidates = [offset, offset - 1, offset + 1]
  for (const candidate of candidates) {
    if (candidate < row.startOffset || candidate > row.endOffset) continue
    const positions = boundaryPositionXs(view, row, candidate)
    if (positions.some((x) => Math.abs(x - edge) <= 1)) return candidate
  }
  return offset
}

function closestRowEndpointToX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
): number {
  const startDistance = closestBoundaryDistance(view, row, row.startOffset, x)
  const endDistance = closestBoundaryDistance(view, row, row.endOffset, x)
  return startDistance <= endDistance ? row.startOffset : row.endOffset
}

function closestBoundaryDistance(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  x: number,
): number {
  const positions = boundaryPositionXs(view, row, offset)
  return Math.min(...positions.map((position) => Math.abs(position - x)))
}

function hitTestRowOffsetAtLocalX(row: MountedVirtualizedTextRow, localX: number): number | null {
  const point = rowClientPointAtLocalX(row, localX)
  return hitTestRowOffset(row, point.x, point.y)
}

function rowClientPointAtLocalX(
  row: MountedVirtualizedTextRow,
  localX: number,
): {
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly top: number
  readonly bottom: number
} {
  const rect = row.element.getBoundingClientRect()
  const scale = row.element.offsetWidth > 0 ? rect.width / row.element.offsetWidth : 1
  return {
    x: rect.left + localX * scale,
    y: rect.top + rect.height / 2,
    scale,
    top: rect.top,
    bottom: rect.bottom,
  }
}

function hitTestBidiVisualProbeAtLocalX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  localX: number,
): number | null {
  const point = rowClientPointAtLocalX(row, localX)
  const viewport = bidiVisualProbeViewport(view, point)
  if (viewport === null) return null

  const probe = { x: point.x, y: viewport.y, scale: point.scale }
  // Native caret APIs can return a nearby row for a point outside its scrollport.
  if (point.x >= viewport.left && point.x <= viewport.right) {
    const hit = hitTestRowOffset(row, probe.x, probe.y)
    if (hit !== null) return hit
  }
  return hitTestBidiVisualProbeWithTranslatedRow(row, probe, (viewport.left + viewport.right) / 2)
}

function bidiVisualProbeViewport(
  view: VirtualizedTextViewInternal,
  point: { readonly y: number; readonly top: number; readonly bottom: number },
): { readonly left: number; readonly right: number; readonly y: number } | null {
  const element = view.scrollElement
  const rect = element.getBoundingClientRect()
  const scale = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const viewportLeft = rect.left + element.clientLeft * scale
  const viewportTop = rect.top + element.clientTop * scale
  const viewportRight = viewportLeft + element.clientWidth * scale
  const viewportBottom = viewportTop + element.clientHeight * scale
  const documentViewport = bidiVisualProbeDocumentViewport(element.ownerDocument)
  const top = Math.max(viewportTop, documentViewport.top, point.top)
  const bottom = Math.min(viewportBottom, documentViewport.bottom, point.bottom)
  if (bottom <= top) return null
  const inset = Math.min(BIDI_VISUAL_PROBE_VIEWPORT_INSET, (bottom - top) / 2)
  const y = Math.max(top + inset, Math.min(point.y, bottom - inset))

  const gutterRight = gutterWidth(view) > 0 ? view.gutterElement.getBoundingClientRect().right : 0
  const left =
    Math.max(viewportLeft, documentViewport.left, gutterRight) + BIDI_VISUAL_PROBE_VIEWPORT_INSET
  const right = Math.min(viewportRight, documentViewport.right) - BIDI_VISUAL_PROBE_VIEWPORT_INSET
  if (right <= left) return null
  return { left, right, y }
}

function bidiVisualProbeDocumentViewport(document: Document): {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
} {
  const window = document.defaultView
  if (!window) {
    return { left: 0, top: 0, right: Number.POSITIVE_INFINITY, bottom: Number.POSITIVE_INFINITY }
  }

  const visual = window.visualViewport
  const left = visual?.offsetLeft ?? 0
  const top = visual?.offsetTop ?? 0
  const width = visual?.width ?? window.innerWidth
  const height = visual?.height ?? window.innerHeight
  return { left, top, right: left + width, bottom: top + height }
}

function hitTestBidiVisualProbeWithTranslatedRow(
  row: MountedVirtualizedTextRow,
  point: { readonly x: number; readonly y: number; readonly scale: number },
  clientX: number,
): number | null {
  if (!Number.isFinite(point.scale) || point.scale <= 0) return null

  const translate = row.element.style.getPropertyValue('translate')
  const priority = row.element.style.getPropertyPriority('translate')
  const delta = (clientX - point.x) / point.scale
  const probeTranslate = translatedBidiProbeStyle(row.element, delta)
  row.element.style.setProperty('translate', probeTranslate, 'important')
  try {
    return hitTestRowOffset(row, clientX, point.y)
  } finally {
    restoreInlineStyleProperty(row.element.style, 'translate', translate, priority)
  }
}

function translatedBidiProbeStyle(element: HTMLElement, delta: number): string {
  const computed = element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .getPropertyValue('translate')
    .trim()
  if (!computed || computed === 'none') return `${delta}px 0px`

  const [x = '0px', y = '0px', z] = computed.split(/\s+/)
  const translatedX = `calc(${x} + ${delta}px)`
  return z ? `${translatedX} ${y} ${z}` : `${translatedX} ${y}`
}

function restoreInlineStyleProperty(
  style: CSSStyleDeclaration,
  name: string,
  value: string,
  priority: string,
): void {
  if (value) {
    style.setProperty(name, value, priority)
    return
  }
  style.removeProperty(name)
}

function hitTestRowOffset(
  row: MountedVirtualizedTextRow,
  clientX: number,
  clientY: number,
): number | null {
  const documentWithCaret = row.element.ownerDocument as DocumentWithCaretHitTesting
  const hit = hitTestBoundaryFromPoint(documentWithCaret, clientX, clientY)
  if (!hit) return null

  const offset = rowOffsetFromCaretHit(row, hit)
  if (offset !== null) return offset
  return hitTestBelowAuxiliaryElement(row, hit.node, clientX, clientY)
}

function hitTestBelowAuxiliaryElement(
  row: MountedVirtualizedTextRow,
  node: Node,
  clientX: number,
  clientY: number,
): number | null {
  const first = auxiliaryCaretHitElement(node)
  if (!first) return null

  const hidden = [hideCaretHitElement(first)]
  try {
    return hitTestWithAuxiliaryElementsHidden(row, clientX, clientY, hidden)
  } finally {
    for (const entry of hidden) restoreCaretHitElement(entry)
  }
}

function hitTestWithAuxiliaryElementsHidden(
  row: MountedVirtualizedTextRow,
  clientX: number,
  clientY: number,
  hidden: HiddenCaretHitElement[],
): number | null {
  const documentWithCaret = row.element.ownerDocument as DocumentWithCaretHitTesting
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const hit = hitTestBoundaryFromPoint(documentWithCaret, clientX, clientY)
    if (!hit) return null

    const offset = rowOffsetFromCaretHit(row, hit)
    if (offset !== null) return offset

    const auxiliary = auxiliaryCaretHitElement(hit.node)
    if (!auxiliary || hidden.some((entry) => entry.element === auxiliary)) return null
    hidden.push(hideCaretHitElement(auxiliary))
  }
  return null
}

function interpolatedBidiOffset(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  x: number,
  advance: number,
): number | null {
  const extent = rowTextExtent(view, row)
  const width = extent.right - extent.left
  if (width <= 0 || row.text.length === 0) return null

  const startOnLeft = rowStartsOnVisualLeft(view, row, extent.left)
  const visualFraction = Math.max(0, Math.min(1, (x - extent.left) / width))
  const logicalFraction = startOnLeft ? visualFraction : 1 - visualFraction
  const localGuess = Math.round(logicalFraction * row.text.length)
  let closest: number | null = null
  let closestDistance = Number.POSITIVE_INFINITY
  for (const local of candidateGraphemeOffsets(row.text, localGuess)) {
    const candidate = fallbackBidiOffsetForLocalIndex(row, local)
    const distance = closestBoundaryDistance(view, row, candidate, x)
    if (distance >= closestDistance) continue

    closest = candidate
    closestDistance = distance
  }
  return closestDistance <= advance ? closest : null
}

function fallbackBidiOffsetForLocalIndex(
  row: MountedVirtualizedTextRow,
  localIndex: number,
): number {
  const local = clampNumber(localIndex, 0, row.text.length)
  const mapped = rowOffsetForLocalIndex(row, local, 'nearest')
  return clampNumber(mapped, row.startOffset, row.endOffset)
}

function rowStartsOnVisualLeft(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  left: number,
): boolean {
  const cached = bidiVisualOrientationCaches.get(row.element)
  if (cached && row.geometryCache !== null && cached.geometry === row.geometryCache) {
    return cached.startOnLeft
  }

  const startOnLeft =
    closestBoundaryDistance(view, row, row.startOffset, left) <=
    closestBoundaryDistance(view, row, row.endOffset, left)
  const geometry = row.geometryCache
  if (geometry !== null) bidiVisualOrientationCaches.set(row.element, { geometry, startOnLeft })
  return startOnLeft
}

function candidateGraphemeOffsets(text: TextContent, localGuess: number): ReadonlySet<number> {
  const offsets = new Set<number>()
  const local = Math.max(0, Math.min(text.length, localGuess))
  const previous = previousGraphemeBoundary(text, local)
  offsets.add(previous)
  const current = nextGraphemeBoundary(text, previous)
  offsets.add(current)
  if (current !== local) return offsets

  offsets.add(nextGraphemeBoundary(text, local))
  return offsets
}

function rowOffsetFromCaretHit(
  row: MountedVirtualizedTextRow,
  hit: { readonly node: Node; readonly offset: number },
): number | null {
  if (!row.element.contains(hit.node)) return null
  return offsetFromDomBoundary(row, hit.node, hit.offset)
}

function auxiliaryCaretHitElement(node: Node): HTMLElement | null {
  const element = isElementNode(node) ? node : node.parentElement
  return element?.closest<HTMLElement>(AUXILIARY_CARET_HIT_SELECTOR) ?? null
}

function hideCaretHitElement(element: HTMLElement): HiddenCaretHitElement {
  const visibility = element.style.visibility
  element.style.visibility = 'hidden'
  return { element, visibility }
}

function restoreCaretHitElement(entry: HiddenCaretHitElement): void {
  entry.element.style.visibility = entry.visibility
}

function rowCharacterAdvance(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): number {
  const rect = row.element.getBoundingClientRect()
  const scale = row.element.offsetWidth > 0 ? rect.width / row.element.offsetWidth : 1
  if (!Number.isFinite(scale) || scale <= 0) return Math.max(1, view.metrics.characterWidth)
  return Math.max(1, view.metrics.characterWidth / scale)
}

function raiseVisualColumnsSeen(view: VirtualizedTextViewInternal, width: number): boolean {
  const columns = width / Math.max(1, view.metrics.characterWidth)
  if (columns <= view.maxVisualColumnsSeen) return false

  view.maxVisualColumnsSeen = columns
  return true
}

function subscribeToForegroundHighlightRestore(view: VirtualizedTextViewInternal): () => void {
  const doc = view.scrollElement.ownerDocument
  const win = doc.defaultView
  if (!win) return () => {}

  const restore = () => restoreHighlightsAfterBrowserResume(view)
  const restoreWhenVisible = () => {
    if (doc.visibilityState === 'hidden') return

    restore()
  }

  win.addEventListener('focus', restore)
  win.addEventListener('pageshow', restore)
  doc.addEventListener('visibilitychange', restoreWhenVisible)

  return () => {
    win.removeEventListener('focus', restore)
    win.removeEventListener('pageshow', restore)
    doc.removeEventListener('visibilitychange', restoreWhenVisible)
  }
}

function documentTextRowByDisplayDelta(
  view: VirtualizedTextViewInternal,
  row: number,
  rowDelta: number,
): number {
  if (rowDelta === 0) return row

  const step = rowDelta > 0 ? 1 : -1
  let remaining = Math.abs(rowDelta)
  let current = row
  while (remaining > 0) {
    const next = nextDocumentTextRow(view, current, step)
    if (next === current) return current

    current = next
    remaining -= 1
  }

  return current
}

function caretXForOffset(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity,
): number {
  const rowIndex = rowForCaretPosition(view, offset, affinity)
  const row = view.rowElements.get(rowIndex)
  const measured = row?.source === 'document' ? mountedCaretX(view, row, offset, affinity) : null
  if (measured !== null) return measured

  const column = visualColumnForOffset(view, offset, affinity)
  return column * Math.max(1, view.metrics.characterWidth)
}

function mountedCaretX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
): number | null {
  if (!rowSupportsVerticalGeometry(view, row)) return null
  return boundaryPositionXsForAffinity(view, row, offset, affinity)[0] ?? null
}

function verticalCaretTarget(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity,
  rowDelta: number,
  goal: VerticalSelectionGoal,
): VisualCaretTarget {
  const sourceRow = rowForCaretPosition(view, offset, affinity)
  const targetRowIndex = documentTextRowByDisplayDelta(view, sourceRow, rowDelta)
  if (targetRowIndex === sourceRow) return { offset, affinity }
  if (goal.kind === 'lineEnd') {
    return { offset: lineEndOffset(view, targetRowIndex), affinity: 'before' }
  }

  const row = view.rowElements.get(targetRowIndex)
  if (row?.source === 'document' && rowSupportsVerticalGeometry(view, row)) {
    const measured = textHitPositionAtRowX(view, row, goal.x)
    if (measured) return { offset: measured.offset, affinity: measured.affinity }
  }

  return fallbackVerticalCaretTarget(view, targetRowIndex, goal.x)
}

function rowSupportsVerticalGeometry(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): boolean {
  if (!rowMightContainRTL(view, row)) return true
  return !isBidiMeasurementRefusalRow(view, row)
}

function fallbackVerticalCaretTarget(
  view: VirtualizedTextViewInternal,
  row: number,
  x: number,
): VisualCaretTarget {
  const column = x / Math.max(1, view.metrics.characterWidth)
  const offset = offsetForViewportColumn(view, row, column)
  const affinity = offset >= lineEndOffset(view, row) ? 'before' : 'after'
  return { offset, affinity }
}

function visualHorizontalTarget(
  view: VirtualizedTextViewInternal,
  offset: number,
  affinity: SelectionAffinity,
  direction: 'left' | 'right',
): VisualCaretTarget | null {
  const rowIndex = rowForCaretPosition(view, offset, affinity)
  const row = view.rowElements.get(rowIndex)
  if (!row || row.source !== 'document') return null

  const move = horizontalCaretMoveInRow(view, row, offset, affinity, direction)
  if (!move) return null
  if (!('kind' in move)) return move

  return visualTargetAcrossDisplayRows(view, rowIndex, { offset, affinity }, direction)
}

function horizontalCaretMoveInRow(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  const homogeneous = homogeneousRtlCaretMoveInRow(view, row, offset, direction)
  if (homogeneous) return homogeneous
  if (row.text.length <= BIDI_WINDOWED_VISUAL_MOVE_MIN_TEXT_LENGTH) {
    return visualCaretMoveInRow(view, row, offset, affinity, direction)
  }
  if (!rowMightContainRTL(view, row)) {
    return visualCaretMoveInRow(view, row, offset, affinity, direction)
  }
  if (rowHasOnlyBidiControls(row)) return null
  if (isBidiMeasurementRefusalRow(view, row)) return null
  return windowedBidiVisualCaretMove(view, row, offset, affinity, direction)
}

function windowedBidiVisualCaretMove(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
  direction: 'left' | 'right',
): VisualRowCaretMove | null {
  if (!hasCaretHitTesting(row)) return null

  const origin = normalizedRowCaretTarget(row, offset, affinity)
  const originPositions = boundaryPositionXs(view, row, origin.offset)
  const originX = boundaryPositionXsForAffinity(
    view,
    row,
    origin.offset,
    origin.affinity,
    originPositions,
  )[0]
  if (originX === undefined || !Number.isFinite(originX)) return null

  const affinityTarget = adjacentOriginAffinityTarget(
    view,
    row,
    origin,
    originPositions,
    originX,
    direction,
  )
  if (affinityTarget) return affinityTarget

  const extent = rowTextExtent(view, row)
  const edge = direction === 'left' ? extent.left : extent.right
  const edgeDistance = Math.abs(edge - originX)
  if (edgeDistance <= BIDI_VISUAL_MOVE_EPSILON) return { kind: 'row-edge' }

  const positionsByOffset = new Map([[origin.offset, originPositions]])
  const context = { view, row, positionsByOffset, originOffset: origin.offset, originX, direction }
  return probeBidiVisualCaretMove(context, edgeDistance)
}

function adjacentOriginAffinityTarget(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  origin: VisualCaretTarget,
  originPositions: readonly number[],
  originX: number,
  direction: 'left' | 'right',
): VisualCaretTarget | null {
  if (originPositions.length !== 2) return null

  const affinity = origin.affinity === 'before' ? 'after' : 'before'
  const targetX = boundaryPositionXsForAffinity(
    view,
    row,
    origin.offset,
    affinity,
    originPositions,
  )[0]
  if (targetX === undefined || !xAdvancesInDirection(originX, targetX, direction)) return null

  const unitOffset =
    origin.affinity === 'before' ? origin.offset : previousRowUnitOffset(row, origin.offset)
  const rect = unitRectForOffset(view, row, unitOffset)
  if (!rect || !rectHasEdgesAtXs(rect, originX, targetX)) return null
  return { offset: origin.offset, affinity }
}

function xAdvancesInDirection(
  originX: number,
  targetX: number,
  direction: 'left' | 'right',
): boolean {
  const delta = targetX - originX
  if (direction === 'left') return delta < -BIDI_VISUAL_MOVE_EPSILON
  return delta > BIDI_VISUAL_MOVE_EPSILON
}

function rectHasEdgesAtXs(
  rect: { readonly left: number; readonly width: number },
  firstX: number,
  secondX: number,
): boolean {
  const right = rect.left + rect.width
  const firstMatches =
    Math.abs(rect.left - firstX) <= BIDI_VISUAL_MOVE_EPSILON ||
    Math.abs(right - firstX) <= BIDI_VISUAL_MOVE_EPSILON
  if (!firstMatches) return false
  return (
    Math.abs(rect.left - secondX) <= BIDI_VISUAL_MOVE_EPSILON ||
    Math.abs(right - secondX) <= BIDI_VISUAL_MOVE_EPSILON
  )
}

function probeBidiVisualCaretMove(
  context: BidiVisualProbeContext,
  edgeDistance: number,
): VisualRowCaretMove | null {
  const sign = context.direction === 'left' ? -1 : 1
  let stationaryX = context.originX
  let delta = BIDI_VISUAL_PROBE_INITIAL_DELTA
  for (let step = 0; step < BIDI_VISUAL_PROBE_MAX_STEPS; step += 1) {
    const distance = Math.min(delta, edgeDistance)
    const sampleX = context.originX + sign * distance
    const probe = bidiVisualProbeAtX(context, sampleX)
    if (!probe) return null
    if (bidiVisualProbeAdvances(context, probe)) {
      return refineBidiVisualProbe(context, stationaryX, sampleX, probe)
    }

    stationaryX = sampleX
    if (distance >= edgeDistance) return { kind: 'row-edge' }
    delta *= 2
  }
  return null
}

function refineBidiVisualProbe(
  context: BidiVisualProbeContext,
  stationaryX: number,
  advancedX: number,
  initial: BidiVisualProbe,
): VisualCaretTarget {
  let stationary = stationaryX
  let advanced = advancedX
  let best = initial
  for (let step = 0; step < BIDI_VISUAL_PROBE_REFINEMENTS; step += 1) {
    const middle = (stationary + advanced) / 2
    const probe = bidiVisualProbeAtX(context, middle)
    if (!probe) return canonicalBidiVisualProbeTarget(context, best)
    if (!bidiVisualProbeAdvances(context, probe)) {
      stationary = middle
      continue
    }

    advanced = middle
    best = probe
  }
  return canonicalBidiVisualProbeTarget(context, best)
}

function canonicalBidiVisualProbeTarget(
  context: BidiVisualProbeContext,
  probe: BidiVisualProbe,
): VisualCaretTarget {
  return originAdjacentBidiVisualTarget(context, probe.x) ?? probe.target
}

function originAdjacentBidiVisualTarget(
  context: BidiVisualProbeContext,
  targetX: number,
): VisualCaretTarget | null {
  const midpoint = (context.originX + targetX) / 2
  const previousOffset = previousRowUnitOffset(context.row, context.originOffset)
  const nextOffset = nextRowUnitOffset(context.row, context.originOffset)
  const previous = unitRectForOffset(context.view, context.row, previousOffset)
  const current = unitRectForOffset(context.view, context.row, context.originOffset)
  const crossesPrevious =
    previousOffset !== context.originOffset && rectContainsX(previous, midpoint)
  const crossesCurrent = nextOffset !== context.originOffset && rectContainsX(current, midpoint)
  if (crossesPrevious === crossesCurrent) return null

  const target = crossesPrevious
    ? { offset: previousOffset, affinity: 'after' as const }
    : { offset: nextOffset, affinity: 'before' as const }
  const canonicalX = boundaryPositionXsForAffinity(
    context.view,
    context.row,
    target.offset,
    target.affinity,
  )[0]
  if (canonicalX === undefined || Math.abs(canonicalX - targetX) > BIDI_VISUAL_MOVE_EPSILON) {
    return null
  }
  return target
}

function bidiVisualProbeAtX(context: BidiVisualProbeContext, rowX: number): BidiVisualProbe | null {
  const { view, row, positionsByOffset } = context
  const offset = hitTestBidiVisualProbeAtLocalX(view, row, rowX)
  if (offset === null) return null

  let positions = positionsByOffset.get(offset)
  if (!positions) {
    positions = boundaryPositionXs(view, row, offset)
    positionsByOffset.set(offset, positions)
  }
  const affinity = bidiVisualProbeAffinity(context, offset, rowX, positions)
  const target = { offset, affinity }
  const x = boundaryPositionXsForAffinity(view, row, offset, affinity, positions)[0]
  if (x === undefined || !Number.isFinite(x)) return null
  return { target, x }
}

function bidiVisualProbeAffinity(
  context: BidiVisualProbeContext,
  offset: number,
  rowX: number,
  positions: readonly number[],
): SelectionAffinity {
  if (positions.length !== 1 || offset === context.originOffset) {
    return bidiPointAffinityForPositions(context.view, context.row, offset, rowX, positions)
  }

  const unitAffinity = bidiVisualUnitAffinity(context, offset, positions[0]!)
  if (unitAffinity) return unitAffinity
  return bidiPointAffinityForPositions(context.view, context.row, offset, rowX, positions)
}

function bidiVisualUnitAffinity(
  context: BidiVisualProbeContext,
  offset: number,
  targetX: number,
): SelectionAffinity | null {
  const midpoint = (context.originX + targetX) / 2
  const previousOffset = previousRowUnitOffset(context.row, offset)
  const previous = unitRectForOffset(context.view, context.row, previousOffset)
  const current = unitRectForOffset(context.view, context.row, offset)
  const crossesPrevious = previousOffset !== offset && rectContainsX(previous, midpoint)
  const crossesCurrent = rectContainsX(current, midpoint)
  if (crossesPrevious === crossesCurrent) return null
  return crossesPrevious ? 'before' : 'after'
}

function rectContainsX(
  rect: { readonly left: number; readonly width: number } | null,
  x: number,
): boolean {
  if (!rect) return false
  return (
    x >= rect.left - BIDI_VISUAL_MOVE_EPSILON &&
    x <= rect.left + rect.width + BIDI_VISUAL_MOVE_EPSILON
  )
}

function bidiVisualProbeAdvances(context: BidiVisualProbeContext, probe: BidiVisualProbe): boolean {
  const delta = probe.x - context.originX
  if (context.direction === 'left') return delta < -BIDI_VISUAL_MOVE_EPSILON
  return delta > BIDI_VISUAL_MOVE_EPSILON
}

function hasCaretHitTesting(row: MountedVirtualizedTextRow): boolean {
  const documentWithCaret = row.element.ownerDocument as DocumentWithCaretHitTesting
  if (typeof documentWithCaret.caretPositionFromPoint === 'function') return true
  return typeof documentWithCaret.caretRangeFromPoint === 'function'
}

function normalizedRowCaretTarget(
  row: MountedVirtualizedTextRow,
  offset: number,
  affinity: SelectionAffinity,
): VisualCaretTarget {
  const clamped = clampNumber(offset, row.startOffset, row.endOffset)
  if (clamped <= row.startOffset) return { offset: clamped, affinity: 'after' }
  if (clamped >= row.endOffset) return { offset: clamped, affinity: 'before' }
  return { offset: clamped, affinity }
}

function visualTargetAcrossDisplayRows(
  view: VirtualizedTextViewInternal,
  sourceRow: number,
  origin: VisualCaretTarget,
  direction: 'left' | 'right',
): VisualCaretTarget | null {
  const rowDelta = direction === 'left' ? -1 : 1
  const targetRowIndex = documentTextRowByDisplayDelta(view, sourceRow, rowDelta)
  if (targetRowIndex === sourceRow) return origin

  const targetRow = view.rowElements.get(targetRowIndex)
  if (!targetRow || targetRow.source !== 'document') return null

  const edge = direction === 'left' ? 'right' : 'left'
  const edgeTarget = horizontalCaretAtRowEdge(view, targetRow, edge)
  if (!edgeTarget) return null
  if (!displayRowsShareBoundary(view, sourceRow, targetRowIndex, direction)) return edgeTarget

  const move = horizontalCaretMoveInRow(
    view,
    targetRow,
    edgeTarget.offset,
    edgeTarget.affinity,
    direction,
  )
  if (!move) return null
  return 'kind' in move ? edgeTarget : move
}

function horizontalCaretAtRowEdge(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  edge: 'left' | 'right',
): VisualCaretTarget | null {
  const homogeneous = homogeneousRtlCaretAtRowEdge(view, row, edge)
  if (homogeneous) return homogeneous
  if (row.text.length <= BIDI_WINDOWED_VISUAL_MOVE_MIN_TEXT_LENGTH) {
    return visualCaretAtRowEdge(view, row, edge)
  }
  if (!rowMightContainRTL(view, row)) return visualCaretAtRowEdge(view, row, edge)
  if (rowHasOnlyBidiControls(row)) return null
  if (isBidiMeasurementRefusalRow(view, row)) return null
  if (!hasCaretHitTesting(row)) return null

  const extent = rowTextExtent(view, row)
  const width = Math.max(0, extent.right - extent.left)
  const inset = Math.min(BIDI_VISUAL_PROBE_INITIAL_DELTA, width / 4)
  const rowX = edge === 'left' ? extent.left + inset : extent.right - inset
  return nativeBidiCaretTargetAtRowX(view, row, rowX)
}

function nativeBidiCaretTargetAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  rowX: number,
): VisualCaretTarget | null {
  const advance = rowCharacterAdvance(view, row)
  const offset =
    bidiEdgeOffset(view, row, rowX, advance) ?? hitTestBidiVisualProbeAtLocalX(view, row, rowX)
  if (offset === null) return null

  const controlTarget = precedingBidiControlTargetAtRowX(view, row, offset, rowX)
  if (controlTarget) return controlTarget

  const positions = boundaryPositionXs(view, row, offset)
  const affinity = bidiPointAffinityForPositions(view, row, offset, rowX, positions)
  return { offset, affinity }
}

function precedingBidiControlTargetAtRowX(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
  offset: number,
  rowX: number,
): VisualCaretTarget | null {
  const previous = previousRowUnitOffset(row, offset)
  if (previous === offset || !rowUnitIsBidiControl(row, previous)) return null

  const x = boundaryPositionXsForAffinity(view, row, previous, 'after')[0]
  if (x === undefined || Math.abs(x - rowX) > BIDI_VISUAL_MOVE_EPSILON) return null
  return { offset: previous, affinity: 'after' }
}

function rowUnitIsBidiControl(row: MountedVirtualizedTextRow, offset: number): boolean {
  const local = rowLocalIndexForOffset(row, offset, 'after')
  const codePoint = row.text.codePointAt(local)
  return BIDI_CONTROL_CODE_POINTS.some((candidate) => candidate === codePoint)
}

function displayRowsShareBoundary(
  view: VirtualizedTextViewInternal,
  sourceRow: number,
  targetRow: number,
  direction: 'left' | 'right',
): boolean {
  if (direction === 'right') {
    return lineEndOffset(view, sourceRow) === lineStartOffset(view, targetRow)
  }
  return lineStartOffset(view, sourceRow) === lineEndOffset(view, targetRow)
}

function nextDocumentTextRow(view: VirtualizedTextViewInternal, row: number, step: 1 | -1): number {
  return view.model.projection.nextDocumentRow(row, step) ?? row
}

function normalizeCursorLineHighlight(
  options: EditorCursorLineHighlightOptions | undefined,
): Required<EditorCursorLineHighlightOptions> {
  return {
    gutterNumber: options?.gutterNumber ?? DEFAULT_CURSOR_LINE_HIGHLIGHT.gutterNumber,
    gutterBackground: options?.gutterBackground ?? DEFAULT_CURSOR_LINE_HIGHLIGHT.gutterBackground,
    rowBackground: options?.rowBackground ?? DEFAULT_CURSOR_LINE_HIGHLIGHT.rowBackground,
  }
}

function projectFoldMarkersThroughMultiLineEdit(
  view: VirtualizedTextViewInternal,
  patch: MultiLineEditPatch,
  edit: TextEdit,
): void {
  if (view.foldMarkers.length === 0) return

  const rowDelta = multiLineEditRowDelta(patch)
  const offsetDelta = patch.delta
  const markers = view.foldMarkers.map((marker) =>
    projectFoldMarkerThroughEdit(marker, edit, offsetDelta, rowDelta, view.model.textLength),
  )
  view.foldMarkers = markers
  view.foldMarkerByStartRow = indexFoldMarkersByStartRow(markers)
  view.foldMarkerByKey = indexFoldMarkersByKey(markers)
}

function projectFoldMarkersThroughBatch(
  view: VirtualizedTextViewInternal,
  batch: TextEditBatch,
): void {
  if (view.foldMarkers.length === 0) return

  const markers = view.foldMarkers.map((marker) => projectFoldMarkerThroughBatch(marker, batch))
  view.foldMarkers = markers
  view.foldMarkerByStartRow = indexFoldMarkersByStartRow(markers)
  view.foldMarkerByKey = indexFoldMarkersByKey(markers)
}

function projectFoldMarkerThroughBatch(
  marker: VirtualizedFoldMarker,
  batch: TextEditBatch,
): VirtualizedFoldMarker {
  const first = firstBatchChangeEndingAtOrAfter(batch, marker.startOffset)
  const firstChange = batch.changes[first]
  let offsetDelta = firstChange
    ? firstChange.afterFrom - firstChange.from
    : batch.after.length - batch.before.length
  let rowDelta = firstChange
    ? firstChange.afterStartRow - firstChange.startRow
    : batch.after.lineCount - batch.before.lineCount
  let endOffsetDelta = 0
  let endRowDelta = 0
  for (let index = first; index < batch.changes.length; index += 1) {
    const change = batch.changes[index]!
    if (change.from >= marker.endOffset) break
    if (change.to <= marker.startOffset) {
      offsetDelta += change.offsetDelta
      rowDelta += change.lineDelta
      continue
    }
    if (change.from <= marker.startOffset || change.to >= marker.endOffset) continue
    endOffsetDelta += change.offsetDelta
    endRowDelta += change.lineDelta
  }

  const shifted = shiftFoldMarker(marker, offsetDelta, rowDelta, batch.after.length)
  if (endOffsetDelta === 0 && endRowDelta === 0) return shifted
  return resizeFoldMarkerEnd(shifted, endOffsetDelta, endRowDelta, batch.after.length)
}

function projectFoldMarkerThroughEdit(
  marker: VirtualizedFoldMarker,
  edit: TextEdit,
  offsetDelta: number,
  rowDelta: number,
  textLength: number,
): VirtualizedFoldMarker {
  if (edit.to <= marker.startOffset) {
    return shiftFoldMarker(marker, offsetDelta, rowDelta, textLength)
  }
  if (edit.from >= marker.endOffset) return marker
  if (edit.from > marker.startOffset && edit.to < marker.endOffset) {
    return resizeFoldMarkerEnd(marker, offsetDelta, rowDelta, textLength)
  }

  return marker
}

function shiftFoldMarker(
  marker: VirtualizedFoldMarker,
  offsetDelta: number,
  rowDelta: number,
  textLength: number,
): VirtualizedFoldMarker {
  return {
    ...marker,
    startOffset: clampNumber(marker.startOffset + offsetDelta, 0, textLength),
    endOffset: clampNumber(marker.endOffset + offsetDelta, 0, textLength),
    startRow: Math.max(0, marker.startRow + rowDelta),
    endRow: Math.max(0, marker.endRow + rowDelta),
  }
}

function resizeFoldMarkerEnd(
  marker: VirtualizedFoldMarker,
  offsetDelta: number,
  rowDelta: number,
  textLength: number,
): VirtualizedFoldMarker {
  const endOffset = clampNumber(marker.endOffset + offsetDelta, marker.startOffset + 1, textLength)
  return {
    ...marker,
    endOffset,
    endRow: Math.max(marker.startRow + 1, marker.endRow + rowDelta),
  }
}

function projectRowDecorationsThroughMultiLineEdit(
  view: VirtualizedTextViewInternal,
  patch: MultiLineEditPatch,
): void {
  if (view.rowDecorations.size === 0) return

  const rowDelta = multiLineEditRowDelta(patch)
  if (rowDelta === 0) return

  const decorations = new Map<number, VirtualizedTextRowDecoration>()
  for (const [row, decoration] of view.rowDecorations) {
    if (row <= patch.startRow) {
      decorations.set(row, decoration)
      continue
    }

    if (row > patch.endRow) {
      decorations.set(Math.max(0, row + rowDelta), decoration)
    }
  }

  view.rowDecorations = decorations
}

function multiLineEditRowDelta(patch: MultiLineEditPatch): number {
  return patch.insertedLineBreaks - (patch.endRow - patch.startRow)
}

function dirtyTokenProjectionStartRow(current: number | null, row: number): number {
  if (current === null) return row
  return Math.min(current, row)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
