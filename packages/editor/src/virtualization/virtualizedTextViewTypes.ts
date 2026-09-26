import type { HighlightOverlay } from './highlightOverlay'
import type { TextContent } from '../textContent'
import type {
  EditorGutterContribution,
  EditorGutterWidthContext,
  EditorMountedChunkPaintJSON,
  EditorVisibleGutterLayoutJSON,
} from '../plugins'
import type { SelectionAffinity } from '../selections'
import type { EditorTokenStyle } from '../tokens'
import type { DisplayTextRowSource, InjectedTextRow } from '../displayTransforms'
import type { BrowserTextMetrics } from './browserMetrics'
import type { RowInlineMapping } from './virtualizedTextViewInlineMapping'
import type { FixedRowVisibleRange } from './fixedRowVirtualizer'
import type { MeasuredText } from '../textMeasurements'
import type { WrapBreak } from './displayProjectionTypes'

type CaretPositionResult = {
  readonly offsetNode: Node
  readonly offset: number
}

export type VirtualizedTextHitPosition = {
  readonly offset: number
  readonly affinity: SelectionAffinity
  readonly displayRow: number
  readonly rowX: number
}

/** The two logical anchors that share one visual caret at a BiDi boundary. */
export type VirtualizedBidiSelectionAnchor = {
  readonly displayRow: number
  readonly displayProjectionRevision: number
  readonly textRevision: number
  readonly rawOffset: number
  readonly rawAffinity: SelectionAffinity
  readonly intervalStart: number
  readonly intervalEnd: number
  readonly insideOffset: number
  readonly outsideOffset: number
  readonly leftOffset: number
  readonly rightOffset: number
}

/** A half-open logical range; run arrays are ordered from visual left to visual right. */
export type VirtualizedBidiRun = {
  readonly startOffset: number
  readonly endOffset: number
  readonly direction: 'ltr' | 'rtl'
}

export type VirtualizedCaretPosition = {
  readonly left: number
  readonly top: number
  readonly height: number
}

export type VirtualizedCaretPositions =
  | readonly [VirtualizedCaretPosition]
  | readonly [VirtualizedCaretPosition, VirtualizedCaretPosition]

export type DocumentWithCaretHitTesting = Document & {
  readonly caretPositionFromPoint?: (x: number, y: number) => CaretPositionResult | null
  readonly caretRangeFromPoint?: (x: number, y: number) => Range | null
}

export type VirtualizedTextViewOptions = {
  /** In pixels. Unset, the stylesheet decides. */
  readonly fontSize?: number
  /** A CSS `font-family` list. Unset, the stylesheet decides. */
  readonly fontFamily?: string
  readonly lineHeight?: number
  readonly rowHeight?: number
  readonly rowGap?: number
  readonly overscan?: number
  readonly scrollMode?: VirtualizedTextViewScrollMode
  readonly rowPositioning?: VirtualizedTextViewRowPositioning
  readonly className?: string
  readonly gutterWidth?: number | ((context: EditorGutterWidthContext) => number)
  readonly longLineChunkSize?: number
  readonly longLineChunkThreshold?: number
  readonly horizontalOverscanColumns?: number
  readonly selectionHighlightName?: string
  readonly highlightRegistry?: HighlightRegistry
  readonly onFoldToggle?: (marker: VirtualizedFoldMarker) => void
  readonly onViewportChange?: () => void
  readonly onViewportScroll?: () => void
  readonly wrap?: boolean
  /** Where a wrapped row may end. Defaults to `'character'`. */
  readonly wrapBreak?: WrapBreak
  readonly injectedTextRows?: readonly InjectedTextRow[]
  readonly gutterContributions?: readonly EditorGutterContribution[]
  readonly cursorLineHighlight?: EditorCursorLineHighlightOptions
  readonly hiddenCharacters?: HiddenCharactersMode
  readonly tabSize?: number
  readonly textMetrics?: BrowserTextMetrics
  /** Defaults to the textarea; EditContext is taken only where the engine has it. */
  readonly inputRoute?: EditorInputRoute
  /** The input's accessible name. Defaults to "Editor input". */
  readonly inputLabel?: string
  readonly inputKind?: EditorInputKind
  readonly scrollPastEnd?: boolean
  readonly onContentHeightChange?: (height: number) => void
}

/**
 * `'prose'` asks soft keyboards to capitalize sentences and autocorrect; `'code'` (the default)
 * turns both off.
 */
export type EditorInputKind = 'code' | 'prose'

export type EditorWrapBreak = WrapBreak

/**
 * How typed text reaches the editor. EditContext hands over every edit with the range it replaced,
 * where the textarea leaves some to be diffed back out of its value; only Chromium has it.
 */
export type EditorInputRoute = 'textarea' | 'edit-context'

export type VirtualizedTextViewScrollMode = 'virtualized' | 'static'

export type VirtualizedTextViewRowPositioning = 'transform' | 'top'

export type HiddenCharactersMode =
  | 'hidden'
  | 'show'
  | 'show-on-selection'
  /** Leading and trailing runs, plus runs of two or more inside the text. */
  | 'boundary'
  /** Whitespace past the last non-whitespace character of the line. */
  | 'trailing'

export type VirtualizedTextHighlightRange = {
  readonly start: number
  readonly end: number
}

export type VirtualizedTextHighlightStyle =
  | {
      readonly overlay: HighlightOverlay
      readonly backgroundColor?: never
      readonly color?: never
      readonly textDecoration?: never
      readonly zIndex?: never
      readonly dimmable?: never
    }
  | {
      readonly overlay?: never
      readonly backgroundColor?: string
      readonly color?: string
      readonly textDecoration?: string
      /** Stacking within the color-producing or colorless highlight band. */
      readonly zIndex?: number
      /** Keep this producer's color at full opacity inside a fade mask. */
      readonly dimmable?: boolean
    }

export type VirtualizedTextRowDecoration = {
  /** Declares that these classes change only foreground/background paint. */
  readonly snapshotStyle?: 'colors'
  readonly className?: string
  readonly gutterClassName?: string
}

export type EditorCursorLineHighlightOptions = {
  readonly gutterNumber?: boolean
  readonly gutterBackground?: boolean | readonly string[]
  readonly rowBackground?: boolean
}

export type VirtualizedTextChunk = {
  readonly startOffset: number
  readonly endOffset: number
  readonly localStart: number
  readonly localEnd: number
  readonly text: TextContent
  readonly element: HTMLSpanElement | null
  readonly textNode: Text
  readonly parts: readonly VirtualizedTextChunkPart[]
  readonly mountedPaint: EditorMountedChunkPaintJSON
}

export type VirtualizedTextChunkPart =
  | VirtualizedTextChunkTextPart
  | VirtualizedTextChunkControlPart
  | VirtualizedTextChunkWidgetPart

export type VirtualizedTextRenderMode = 'simple' | 'rendered' | 'chunked' | 'widget'

export type VirtualizedTextChunkTextPart = {
  readonly kind: 'text'
  readonly localStart: number
  readonly localEnd: number
  readonly node: Text
}

type VirtualizedTextChunkControlPart = {
  readonly kind: 'control'
  readonly localStart: number
  readonly localEnd: number
  readonly element: HTMLSpanElement
  readonly widthCells: number
}

/**
 * An inline replacement that rendered its own DOM instead of standing for text. It covers the
 * replacement's display columns like any other part, but its advance is whatever the mounted node
 * measures — the columns underneath it say nothing about how wide it draws.
 */
type VirtualizedTextChunkWidgetPart = {
  readonly kind: 'widget'
  readonly localStart: number
  readonly localEnd: number
  readonly element: HTMLSpanElement
}

export type VirtualizedFoldMarker = {
  readonly key: string
  readonly startOffset: number
  readonly endOffset: number
  readonly startRow: number
  readonly endRow: number
  readonly collapsed: boolean
}

export type VirtualizedTextRow = MeasuredText & {
  readonly index: number
  readonly bufferRow: number
  readonly source: DisplayTextRowSource
  readonly injectedTextRowId?: string
  readonly metadata?: unknown
  readonly startOffset: number
  readonly endOffset: number
  readonly text: TextContent
  readonly kind: 'text'
  readonly chunks: readonly VirtualizedTextChunk[]
  readonly element: HTMLDivElement
  readonly textNode: Text
  /** Present only while this row renders inline replacements; see RowInlineMapping. */
  readonly inlineMapping?: RowInlineMapping | null
}

export type VirtualizedTextViewState = {
  readonly lineCount: number
  readonly contentWidth: number
  readonly gutterWidth: number
  readonly gutterLayout: EditorVisibleGutterLayoutJSON
  readonly foldMapActive: boolean
  readonly metrics: BrowserTextMetrics
  readonly scrollHeight: number
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly scrollRow: number
  readonly scrollWidth: number
  readonly borderBoxHeight: number
  readonly borderBoxWidth: number
  readonly totalHeight: number
  readonly viewportHeight: number
  readonly viewportWidth: number
  readonly visibleRange: FixedRowVisibleRange
  readonly mountedRows: readonly MountedVirtualizedTextRow[]
  readonly foldMarkers: readonly VirtualizedFoldMarker[]
  readonly wrapActive: boolean
  readonly tabSize: number
}

export type NativeGeometryValidation = {
  readonly mountedRows: number
  readonly caretChecks: number
  readonly selectionChecks: number
  readonly hitTestChecks: number
  readonly failures: readonly string[]
  readonly ok: boolean
}

export interface HighlightRegistry {
  set(name: string, highlight: Highlight): void
  delete(name: string): boolean
  entries?(): IterableIterator<[string, Highlight]>
}

export type TokenGroup = {
  readonly name: string
  readonly highlight: Highlight
  readonly style: EditorTokenStyle
  readonly styleKey: string
}

export type TokenRowSegment = {
  readonly chunk: VirtualizedTextChunk
  readonly start: number
  readonly end: number
  readonly style: EditorTokenStyle
  readonly styleKey: string
}

export type MountedVirtualizedTextRow = VirtualizedTextRow & {
  readonly gutterElement: HTMLDivElement
  readonly gutterCells: Map<string, HTMLElement>
  readonly gutterCellList: readonly HTMLElement[]
  readonly leftSpacerElement: HTMLSpanElement
  readonly selectionLayerElement: HTMLDivElement
  readonly foldPlaceholderElement: HTMLSpanElement
  readonly hiddenCharactersLayerElement: HTMLDivElement
  readonly top: number
  readonly height: number
  readonly leftSpacerWidth: number
  readonly primaryText: boolean
  readonly foldMarker: VirtualizedFoldMarker | null
  readonly gutterNumberCursorLine: boolean
  readonly gutterCursorLineBackgroundLaneIds: readonly string[]
  readonly mountedPaintSupport: 'replayable' | 'unreplayable-plugin-css'
  readonly coreBidiRefusal: boolean
  readonly textRevision: number
  readonly tokenHighlightSlotId: number
  readonly chunkKey: string
  readonly selectionLayerKey: string
  readonly hiddenCharactersKey: string
  readonly foldMarkerKey: string
  readonly foldCollapsed: boolean
  readonly textRenderMode: VirtualizedTextRenderMode
  readonly rowDecorationClassName: string
  readonly rowDecorationGutterClassName: string
  readonly rowDecorationKey: string
  readonly rowDecorationSnapshotStyle: boolean
  /** Classes derived from the row's inline replacement kinds (`editor-inline-<kind>`). */
  readonly inlineKindsClassName: string
  readonly cursorLineContentActive: boolean
  readonly geometryCache: unknown | null
}

export type SameLineEditPatch = {
  readonly rowIndex: number
  readonly localFrom: number
  readonly deleteLength: number
  readonly text: string
}

export type MultiLineEditPatch = {
  readonly startRow: number
  readonly endRow: number
  readonly insertedLineBreaks: number
  readonly delta: number
}

export type HorizontalChunkWindow = {
  readonly start: number
  readonly end: number
}

export type OffsetRange = {
  readonly start: number
  readonly end: number
}
