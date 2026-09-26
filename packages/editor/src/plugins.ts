import type { EditorRowPresentation } from './rowPresentation'
import type { EditorPointHit, EditorMarkerHit } from './pointQueries'
import type { TextContent } from './textContent'
import type { EditorDecorationRange, EditorDecorationStore } from './editor/decorationStore'
import type { DocumentSessionChange } from './documentSession'
import type { DocumentTextSnapshot, TextReadSnapshot } from './documentTextSnapshot'
import type { EditorCommandContext } from './editor/commands'
import type {
  EditorAnyCommandId,
  EditorContributedCommandDeclaration,
} from './editor/commandCatalog'
import { EditorDisposableStore, MutableEditorDisposable } from './editor/disposables'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { SnippetMirrorRange, SnippetSessionStop } from './editor/snippetSession'
import type { EditorSyntaxThemeColor, EditorTheme, EditorThemeType } from './theme'
import type { EditorTokenStore } from './syntax/tokenStore'
import type { TextEdit } from './tokens'
import type { DisplayTextRowSource, InjectedTextRow } from './displayTransforms'
import {
  type BracketInfo,
  type EditorSyntaxCapture,
  type EditorSyntaxLanguageId,
  type EditorSyntaxProvider,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type FoldRange,
} from './syntax/session'
import type { InlineReplacementSpec } from './inlineMap'
import type { TextOffsetRange } from './textRanges'
import type { SelectionAffinity } from './selections'
import type { EditorSetSelectionOptions } from './editor/selectionReveal'
import type { EditorScrollPosition, EditorSyntaxStatus } from './editor/types'
import type {
  DocumentChangesSinceSyncPoint,
  DocumentLogicalRevisionScope,
  DocumentSyncPoint,
} from './editor/editChain'
import type { BrowserTextMetrics } from './virtualization/browserMetrics'
import type { FixedRowVisibleRange } from './virtualization/fixedRowVirtualizer'
import type {
  EditorCursorLineHighlightOptions,
  VirtualizedFoldMarker,
  VirtualizedTextHighlightStyle,
  VirtualizedTextRowDecoration,
} from './virtualization/virtualizedTextViewTypes'

export type EditorDisposable = {
  dispose(): void
}

export type EditorCapabilityToken<T> = {
  readonly id: string
  readonly __capability?: T
}

export function createEditorCapabilityToken<T>(id: string): EditorCapabilityToken<T> {
  const normalized = id.trim()
  if (!normalized) throw new Error('Editor capability token id cannot be empty')

  return Object.freeze({ id: normalized }) as EditorCapabilityToken<T>
}

/**
 * Names a language feature — completion, hover, definition — that as many sources may answer as a
 * document has for it: a language server, a grammar-backed word source and a snippet set all offer
 * completions at once. A capability is the opposite case, one owner for the whole editor, which is
 * why the two are separate token kinds rather than one channel that sometimes allows a second
 * registration.
 *
 * The id is the identity: two packages that cannot import each other's token still answer the same
 * feature by naming it the same.
 */
export type EditorLanguageFeatureToken<T> = {
  readonly id: string
  readonly __languageFeature?: T
}

export function createEditorLanguageFeatureToken<T>(id: string): EditorLanguageFeatureToken<T> {
  const normalized = id.trim()
  if (!normalized) throw new Error('Editor language feature token id cannot be empty')

  return Object.freeze({ id: normalized }) as EditorLanguageFeatureToken<T>
}

/** Which documents a provider answers for. */
export type EditorLanguageFeatureSelector = {
  /** `'*'` answers for every document, including one whose language is unknown. */
  readonly language: EditorSyntaxLanguageId | '*'
  /** Separates providers that fit the document equally well; higher is asked first, default 0. */
  readonly priority?: number
}

export type EditorLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type EditorLogError = {
  readonly message: string
  readonly name?: string
  readonly stack?: string
}

export type EditorLogEditorContext = {
  readonly documentId: string | null
  readonly documentMode?: string
  readonly documentVersion?: number
  readonly editability?: string
  readonly instanceId: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly textVersion?: number
}

export type EditorLogEvent = {
  readonly action: string
  readonly editor?: Partial<EditorLogEditorContext>
  readonly error?: EditorLogError
  readonly level: EditorLogLevel
  readonly message?: string
  readonly source: 'editor'
  readonly timestamp: string
  readonly [key: string]: unknown
}

export type EditorLogInput = {
  readonly action: string
  readonly editor?: Partial<EditorLogEditorContext>
  readonly error?: EditorLogError
  readonly level: EditorLogLevel
  readonly message?: string
  readonly source?: 'editor'
  readonly timestamp?: string
  readonly [key: string]: unknown
}

export type EditorLogger = (event: EditorLogEvent) => void

export const EDITOR_MINIMAP_FEATURE_ID = 'editor.minimap'

export type EditorMinimapDecorationPosition = 'inline' | 'gutter'
export type EditorMinimapSectionHeaderStyle = 'normal' | 'underlined'

export type EditorMinimapDecoration = {
  readonly startLineNumber: number
  readonly startColumn: number
  readonly endLineNumber: number
  readonly endColumn: number
  readonly color?: string
  readonly position: EditorMinimapDecorationPosition
  readonly sectionHeaderStyle?: EditorMinimapSectionHeaderStyle | null
  readonly sectionHeaderText?: string | null
  readonly zIndex?: number
}

export type EditorMinimapFeature = {
  setDecorations(sourceId: string, decorations: readonly EditorMinimapDecoration[]): void
  clearDecorations(sourceId: string): void
  getDecorations(): readonly EditorMinimapDecoration[]
  subscribe(listener: () => void): EditorDisposable
}

export const EDITOR_MINIMAP_FEATURE =
  createEditorCapabilityToken<EditorMinimapFeature>(EDITOR_MINIMAP_FEATURE_ID)

export type EditorHighlightResult = {
  readonly tokens: EditorTokenStore
  readonly theme?: EditorTheme | null
}

// A highlighter is a protocol adapter: it owns the full immutable source and decides when a
// transport needs the whole text.
export type EditorHighlighterSessionOptions = {
  readonly documentId: string
  readonly runtimeSessionId?: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly textSnapshot: DocumentTextSnapshot
  readonly snapshot: PieceTableSnapshot
}

export type EditorHighlighterSession = EditorDisposable & {
  onDidChangeTheme?(listener: () => void): (() => void) | void
  refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorHighlightResult>
  applyChange(change: DocumentSessionChange): Promise<EditorHighlightResult>
}

export type EditorHighlighterProvider = {
  loadTheme?(): Promise<EditorTheme | null | undefined>
  createSession(options: EditorHighlighterSessionOptions): EditorHighlighterSession | null
}

/**
 * A change as a contribution receives it: the same object the document produced, typed so that its
 * text is a read source and the piece table and transaction behind it stay with the owners.
 */
export type EditorContributionChange = Omit<
  DocumentSessionChange,
  'snapshot' | 'textSnapshot' | 'transaction'
> & {
  readonly textSnapshot: TextReadSnapshot
}

export type EditorResolvedSelection = {
  readonly anchorOffset: number
  readonly headOffset: number
  readonly startOffset: number
  readonly endOffset: number
  readonly affinity: SelectionAffinity
}

/** `idle` before any document and `loading` while its highlight runs; the rest are settled. */
export type EditorInitialHighlightStatus =
  | 'idle'
  | 'loading'
  | 'painted'
  | 'plain'
  | 'degraded'
  | 'error'

export type EditorInitialPaintEvent =
  | {
      readonly phase: 'text'
      readonly documentId: string | null
      readonly documentGeneration: number
      readonly textVersion: number
    }
  | {
      readonly phase: 'highlight-settled'
      readonly documentId: string | null
      readonly documentGeneration: number
      readonly textVersion: number
      readonly status: Exclude<EditorInitialHighlightStatus, 'idle' | 'loading'>
    }

export type EditorTokenStyleJSON = {
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontStyle?: 'normal' | 'italic'
  readonly fontWeight?: string | number
  readonly textDecoration?: string
}

export type EditorThemeJSON = {
  readonly type?: EditorThemeType
  readonly backgroundColor?: string
  readonly foregroundColor?: string
  readonly gutterBackgroundColor?: string
  readonly gutterForegroundColor?: string
  readonly caretColor?: string
  readonly minimapBackgroundColor?: string
  readonly syntax?: Readonly<Partial<Record<EditorSyntaxThemeColor, string>>>
  readonly colors?: Readonly<Record<string, string>>
}

export type EditorMountedChunkPaintPartJSON =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'control'; readonly text: string; readonly widthCells: number }
  | { readonly kind: 'refusal'; readonly text: string }

export type EditorMountedChunkPaintJSON =
  | { readonly kind: 'replayable'; readonly parts: readonly EditorMountedChunkPaintPartJSON[] }
  | { readonly kind: 'unreplayable-widget' }

export type EditorVisibleChunkSnapshot = {
  readonly sourceStartOffset: number
  readonly sourceEndOffset: number
  readonly rowLocalStart: number
  readonly rowLocalEnd: number
  readonly text: TextContent
  readonly mountedPaint: EditorMountedChunkPaintJSON
}

export type EditorVisibleChunkSnapshotJSON = Omit<EditorVisibleChunkSnapshot, 'text'> & {
  readonly text: string
}

export type EditorVisibleGutterLayoutJSON = {
  readonly fixedWidth: number
  readonly lanes: readonly { readonly id: string; readonly width: number }[]
}

export type EditorViewportSnapshot = {
  readonly scrollTop: number
  /** Continuous display-row coordinate at scrollTop, including the gap following each row. */
  readonly scrollRow: number
  readonly scrollLeft: number
  readonly scrollHeight: number
  readonly scrollWidth: number
  readonly clientHeight: number
  readonly clientWidth: number
  readonly borderBoxHeight?: number
  readonly borderBoxWidth?: number
  readonly visibleRange: FixedRowVisibleRange
}

export type EditorViewportSnapshotJSON = {
  readonly scrollTop: number
  readonly scrollRow: number
  readonly scrollLeft: number
  readonly scrollHeight: number
  readonly scrollWidth: number
  readonly clientHeight: number
  readonly clientWidth: number
  readonly borderBoxHeight: number | null
  readonly borderBoxWidth: number | null
  readonly visibleRange: { readonly start: number; readonly end: number }
}

export type EditorVisibleRowSnapshot = {
  readonly index: number
  readonly bufferRow: number
  readonly source: DisplayTextRowSource
  readonly injectedTextRowId?: string
  readonly metadata?: unknown
  readonly startOffset: number
  readonly endOffset: number
  readonly text: TextContent
  readonly kind: 'text'
  /** Document-backed text, including soft-wrap continuations. */
  readonly primaryText: boolean
  /** The first display segment of a document row. */
  readonly firstWrapSegment: boolean
  readonly top: number
  readonly height: number
  readonly leftSpacerWidth: number
  readonly contentCursorLine: boolean
  readonly gutterNumberCursorLine: boolean
  readonly gutterCursorLineBackgroundLaneIds: readonly string[]
  readonly mountedPaintSupport: 'replayable' | 'unreplayable-plugin-css'
  readonly chunks: readonly EditorVisibleChunkSnapshot[]
  readonly foldMarker: VirtualizedFoldMarker | null
}

export type EditorVisibleRowSnapshotJSON = {
  readonly index: number
  readonly bufferRow: number
  readonly source: DisplayTextRowSource
  readonly injectedTextRowId: string | null
  readonly startOffset: number
  readonly endOffset: number
  readonly text: string
  readonly kind: 'text'
  /** Document-backed text, including soft-wrap continuations. */
  readonly primaryText: boolean
  /** The first display segment of a document row. */
  readonly firstWrapSegment: boolean
  readonly top: number
  readonly height: number
  readonly leftSpacerWidth: number
  readonly contentCursorLine: boolean
  readonly gutterNumberCursorLine: boolean
  readonly gutterCursorLineBackgroundLaneIds: readonly string[]
  readonly mountedPaintSupport: 'replayable' | 'unreplayable-plugin-css'
  readonly chunks: readonly EditorVisibleChunkSnapshotJSON[]
  readonly foldMarker: VirtualizedFoldMarker | null
}

export type EditorVisiblePaintRunJSON = {
  /** Half-open UTF-16 offsets into the concatenated text paint parts. */
  readonly start: number
  readonly end: number
  readonly style: {
    readonly color?: string
    readonly backgroundColor?: string
    readonly textDecoration?: string
  }
}

export type EditorVisiblePaintChunkJSON = {
  readonly sourceStartOffset: number
  readonly sourceEndOffset: number
  readonly rowLocalStart: number
  readonly rowLocalEnd: number
  readonly parts: readonly EditorMountedChunkPaintPartJSON[]
  readonly replayFidelity: 'exact' | 'plain-transformed' | 'plain-core-rendered'
  readonly runs: readonly EditorVisiblePaintRunJSON[]
}

export type EditorVisiblePaintRowJSON = {
  readonly index: number
  readonly bufferRow: number
  readonly source: DisplayTextRowSource
  readonly injectedTextRowId: string | null
  /** The first display segment of a document row. */
  readonly firstWrapSegment: boolean
  readonly top: number
  readonly height: number
  readonly leftSpacerWidth: number
  readonly contentCursorLine: boolean
  readonly gutterNumberCursorLine: boolean
  readonly gutterCursorLineBackgroundLaneIds: readonly string[]
  readonly foldMarker: VirtualizedFoldMarker | null
  readonly chunks: readonly EditorVisiblePaintChunkJSON[]
}

export type EditorVisiblePaintRectangle = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly backgroundColor: string
}

export type EditorVisiblePaintLayer = {
  readonly id: string
  readonly rectangles: readonly EditorVisiblePaintRectangle[]
}

export type EditorVisiblePaintCapture =
  | { readonly id: string; readonly status: 'pending' }
  | ({ readonly status: 'ready' } & EditorVisiblePaintLayer)

export type EditorVisibleSnapshotJSON = {
  readonly kind: 'editor-visible'
  readonly schemaVersion: 1
  readonly documentId: string | null
  readonly languageId: EditorSyntaxLanguageId | null
  readonly theme: EditorThemeJSON | null
  readonly textVersion: number
  readonly initialHighlightStatus: EditorInitialHighlightStatus
  readonly metrics: { readonly rowHeight: number; readonly characterWidth: number }
  readonly lineCount: number
  readonly contentWidth: number
  readonly totalHeight: number
  readonly gutterWidth: number
  readonly gutterLayout: EditorVisibleGutterLayoutJSON
  readonly tabSize: number
  readonly viewport: EditorViewportSnapshotJSON
  readonly rows: readonly EditorVisiblePaintRowJSON[]
  readonly paintLayers: readonly EditorVisiblePaintLayer[]
}

export type EditorVisibleSnapshot = EditorVisibleSnapshotJSON & {
  toJSON(): EditorVisibleSnapshotJSON
}

export type EditorViewSnapshotJSON = {
  readonly kind: 'editor-view'
  readonly schemaVersion: 1
  readonly documentId: string | null
  readonly languageId: EditorSyntaxLanguageId | null
  readonly theme: EditorThemeJSON | null
  readonly fullText: string
  readonly textVersion: number
  readonly initialHighlightStatus: EditorInitialHighlightStatus
  readonly lineStarts: readonly number[]
  /** Packed: token `i` spans `[starts[i], ends[i])` and is styled by `styles[styleIds[i]]`. */
  readonly tokens: {
    readonly starts: readonly number[]
    readonly ends: readonly number[]
    readonly styleIds: readonly number[]
    readonly styles: readonly EditorTokenStyleJSON[]
  }
  readonly brackets: readonly BracketInfo[]
  readonly selections: readonly EditorResolvedSelection[]
  readonly metrics: { readonly rowHeight: number; readonly characterWidth: number }
  readonly lineCount: number
  readonly contentWidth: number
  readonly totalHeight: number
  readonly gutterWidth: number
  readonly gutterLayout: EditorVisibleGutterLayoutJSON
  readonly tabSize: number
  readonly foldMarkers: readonly VirtualizedFoldMarker[]
  readonly visibleRows: readonly EditorVisibleRowSnapshotJSON[]
  readonly viewport: EditorViewportSnapshotJSON
}

// Read-only line-start access without materializing the full array; see
// LineStartsView in virtualization/lineStartIndex.ts.
export type EditorLineStartsView = {
  readonly length: number
  at(index: number): number | undefined
  indexForOffset(offset: number): number
  firstIndexAtOrAfter(offset: number): number
  toArray(): readonly number[]
}

export type EditorViewSnapshot = {
  readonly documentId: string | null
  readonly languageId: EditorSyntaxLanguageId | null
  readonly theme?: EditorTheme | null
  readonly textSnapshot: TextReadSnapshot
  readonly textVersion: number
  readonly initialHighlightStatus: EditorInitialHighlightStatus
  readonly geometryCommitted?: boolean
  readonly syntaxStatus: EditorSyntaxStatus
  /** Null until every paint contribution has committed this exact snapshot. */
  readonly paintLayers: readonly EditorVisiblePaintLayer[] | null
  readonly documentSyncPoint: DocumentSyncPoint
  readonly changesSinceDocumentSyncPoint: (
    point: DocumentSyncPoint,
    scope: DocumentLogicalRevisionScope | null,
  ) => DocumentChangesSinceSyncPoint | null
  // Materializes the full array on first read; prefer lineStartsView on
  // per-keystroke paths.
  readonly lineStarts: readonly number[]
  readonly lineStartsView: EditorLineStartsView
  readonly tokens: EditorTokenStore
  /** Bracket positions from the last structural parse, sorted by offset; empty when unavailable. */
  readonly brackets: readonly BracketInfo[]
  readonly selections: readonly EditorResolvedSelection[]
  readonly metrics: BrowserTextMetrics
  readonly lineCount: number
  readonly contentWidth: number
  readonly totalHeight: number
  readonly gutterWidth: number
  readonly gutterLayout: EditorVisibleGutterLayoutJSON
  readonly tabSize: number
  readonly foldMarkers: readonly VirtualizedFoldMarker[]
  readonly visibleRows: readonly EditorVisibleRowSnapshot[]
  readonly viewport: EditorViewportSnapshot
  /**
   * Copies mounted vertical rows and horizontal chunks. Indexed built-in tokens stay viewport-bounded;
   * an unindexed external array may be scanned once. Unsupported mounted plugin paint returns null.
   */
  toVisibleSnapshot(): EditorVisibleSnapshot | null
}

export type EditorOverlaySide = 'left' | 'right'

/**
 * Ranges the document keeps in step with its own text.
 *
 * A contribution that holds a span across edits it does not control — the region a find is scoped
 * to, matches painted while a re-search is still outstanding — would otherwise be reading offsets
 * the text has already moved out from under.
 */
export type EditorTrackedRanges = {
  /** Where the tracked ranges now sit, without any whose text is gone. */
  resolve(): readonly TextOffsetRange[]
}

export type EditorTextAnchor =
  | { readonly kind: 'point'; readonly offset: number; readonly bias: 'left' | 'right' }
  | {
      readonly kind: 'range'
      readonly start: number
      readonly end: number
      readonly startBias: 'left' | 'right'
      readonly endBias: 'left' | 'right'
    }

export type EditorTrackedPoint = {
  resolve():
    | { readonly kind: 'live'; readonly offset: number }
    | { readonly kind: 'deleted' }
    | null
}

/**
 * Asked about a mouse press before the editor turns it into a caret or a selection. Returning true
 * claims it: the editor prevents its default and does nothing else with it, and no later
 * participant is asked. A participant never has to beat the editor's own listener to the event.
 */
export type EditorPressParticipant = (event: MouseEvent) => boolean

export type EditorViewContributionContext = {
  readonly container: HTMLElement
  readonly scrollElement: HTMLDivElement
  /** Document paint parent inside the code viewport, separate from native scrollbars. */
  readonly contentElement: HTMLDivElement
  /** Unique per editor, so two editors' CSS highlights never share a registry name. */
  readonly highlightPrefix: string
  hasDocument(): boolean
  getSnapshot(): EditorViewSnapshot
  requestViewUpdate(): void
  /**
   * The character the user typed, after its edit has landed. A contribution that acts on a
   * keystroke reads it here rather than deducing it from the change: auto-closing turns a typed
   * `(` into a two-character `()`, and typing over the closer it inserted changes no text at all.
   */
  onDidType(listener: (text: string) => void): EditorDisposable
  /** Participants are asked in the order they registered. */
  registerPressParticipant(participant: EditorPressParticipant): EditorDisposable
  /**
   * Keeps the caret off buffer rows the contribution draws as chrome, such as a diff separator whose
   * label is buffer text: a caret move that would land on one steps past it in the same direction.
   */
  registerNonCaretRows(isNonCaret: (bufferRow: number) => boolean): EditorDisposable
  /**
   * Names state this contribution owns for key bindings' `when` conditions, such as a widget being
   * open. Read at the moment a key is matched, so it is never stale; unregistered, it reads false.
   */
  registerKeymapContextKey(key: string, read: () => boolean): EditorDisposable
  getFeature<T>(token: EditorCapabilityToken<T>): T | null
  /**
   * The sources registered for a language feature, best first. The language is the caller's to name
   * because the region being answered for is not always the whole document's — an embedded fence
   * asks on behalf of the language inside it.
   */
  getProviders<T>(
    token: EditorLanguageFeatureToken<T>,
    languageId: EditorSyntaxLanguageId | null,
  ): readonly T[]
  /**
   * Registers a source from the contribution that owns whatever answers for it — a connection, a
   * worker, an index built from the view. Such a source has to stop being asked the moment that
   * thing goes away, and the contribution's own disposal is what knows when; a source that owns
   * nothing view-scoped registers from a capability contribution instead.
   */
  registerProvider<T>(
    token: EditorLanguageFeatureToken<T>,
    selector: EditorLanguageFeatureSelector,
    provider: T,
  ): EditorDisposable
  log(event: EditorLogInput): void
  revealLine(row: number): void
  focusEditor(): void
  /** Says something out loud to a screen reader. */
  announce(message: string): void
  setSelection(
    anchor: number,
    head: number,
    timingName: string,
    options?: EditorSetSelectionOptions,
  ): void
  setSelections(
    selections: readonly EditorSelectionRange[],
    timingName: string,
    revealOffset?: number,
  ): void
  /** An axis left out keeps its current offset. */
  setScrollPosition(position: EditorScrollPosition): void
  reserveOverlayWidth(side: EditorOverlaySide, width: number): void
  // Width already claimed on that edge by other contributions, so an overlay
  // that anchors itself to the edge can step clear of them instead of covering
  // them.
  getReservedOverlayWidth(side: EditorOverlaySide): number
  /**
   * Called after the width reserved on a side changes, from any cause: a contribution's claim made
   * during layout, or a restored or committed provisional paint. Never dropped or coalesced away.
   */
  onDidChangeReservedOverlayWidth(listener: (side: EditorOverlaySide) => void): EditorDisposable
  /**
   * Aborts before logical row text replacement, recycling, provisional paint, or view disposal.
   * Decoration, position, and horizontal chunk-window updates keep the handle valid.
   * Returns null for unmounted rows and during invalidation. dispose() only releases the handle.
   */
  getRowPresentation(displayRow: number): EditorRowPresentation | null
  rowAtPoint(clientX: number, clientY: number): EditorPointHit | null
  markerAtPoint(clientX: number, clientY: number): EditorMarkerHit | null
  textOffsetFromPoint(clientX: number, clientY: number): number | null
  getRangeClientRect(start: number, end: number): DOMRect | null
  // Spans the document follows on the contribution's behalf; see EditorTrackedRanges. Whether an
  // edge absorbs text arriving against it is the contribution's call, in the bias terms
  // EditorDecorationRange states it in: a region selected to work within absorbs it, something
  // found in the text does not.
  trackRanges(
    ranges: readonly TextOffsetRange[],
    bias?: Pick<EditorDecorationRange, 'startBias' | 'endBias'>,
  ): EditorTrackedRanges
  trackPoint(anchor: Extract<EditorTextAnchor, { readonly kind: 'point' }>): EditorTrackedPoint
  setRangeHighlight(
    name: string,
    ranges: readonly { readonly start: number; readonly end: number }[],
    style: VirtualizedTextHighlightStyle,
  ): void
  clearRangeHighlight(name: string): void
}

export type EditorViewContributionUpdateKind =
  | 'document'
  | 'content'
  | 'tokens'
  | 'selection'
  | 'viewport'
  | 'layout'
  | 'clear'

/**
 * Contributions update from one snapshot inside a single render pass, so their reads and writes
 * interleave with each other's. A measurement taken after anything in the pass has written to the
 * DOM forces the browser to settle the layout that write dirtied, and the bill lands on whoever
 * happens to measure next rather than on whoever wrote — so an update takes every measurement it
 * needs first, into plain data, and writes only once the last of them is in hand.
 */
/** What a view contribution can say it acts on; `document` and `clear` reach every contribution. */
export type EditorViewContributionInput = Exclude<
  EditorViewContributionUpdateKind,
  'document' | 'clear'
>

export type EditorViewContribution = EditorDisposable & {
  /**
   * The update kinds this contribution acts on. Its `update` is called only for those, plus
   * `document` and `clear`, and a pass whose kinds no contribution asked for builds no snapshot.
   * Left out, every kind reaches it.
   */
  readonly inputs?: readonly EditorViewContributionInput[]
  /** Capture contributors opt into synchronous restoration with a configuration-specific key. */
  readonly snapshotKey?: string
  captureVisiblePaint?(snapshot: EditorViewSnapshot): EditorVisiblePaintCapture
  /** Scroll feedback at display rate, without rebuilding the document or mounted-row snapshot. */
  updateViewport?(viewport: EditorViewportSnapshot): void
  update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change?: EditorContributionChange | null,
  ): void
}

export type EditorViewContributionProvider = {
  createContribution(context: EditorViewContributionContext): EditorViewContribution | null
}

export type EditorCommandHandler = (context: EditorCommandContext) => boolean

export type EditorSelectionRange = {
  readonly anchor: number
  readonly head: number
  readonly affinity?: SelectionAffinity
}

type EditorFeatureDomContributionContext = {
  readonly container: HTMLElement
  readonly scrollElement: HTMLDivElement
  readonly contentElement: HTMLDivElement
  readonly highlightPrefix: string
}

type EditorDocumentContributionContext = {
  hasDocument(): boolean
  log(event: EditorLogInput): void
  /** O(document length); for whole-document work such as a live diff, never per-row reads. */
  materializeFullText(): string
  getTextSnapshot(): TextReadSnapshot | null
  /** Changes reach a contribution coalesced; a point taken here recovers every edit since it. */
  getDocumentSyncPoint(): DocumentSyncPoint
  changesSinceDocumentSyncPoint(
    point: DocumentSyncPoint,
    scope: DocumentLogicalRevisionScope | null,
  ): DocumentChangesSinceSyncPoint | null
}

type EditorSelectionContributionContext = {
  getSelections(): readonly EditorResolvedSelection[]
  focusEditor(): void
  setSelection(
    anchor: number,
    head: number,
    timingName: string,
    options?: EditorSetSelectionOptions,
  ): void
  setSelections(
    selections: readonly EditorSelectionRange[],
    timingName: string,
    revealOffset?: number,
  ): void
}

type EditorRangeHighlightContributionContext = {
  setRangeHighlight(
    name: string,
    ranges: readonly { readonly start: number; readonly end: number }[],
    style: VirtualizedTextHighlightStyle,
  ): void
  clearRangeHighlight(name: string): void
}

type EditorRowDecorationContributionContext = {
  setRowDecorations(
    sourceId: string,
    decorations: ReadonlyMap<number, VirtualizedTextRowDecoration>,
  ): void
  clearRowDecorations(sourceId: string): void
}

export type EditorCommandContributionContext = {
  registerCommand(command: EditorAnyCommandId, handler: EditorCommandHandler): EditorDisposable
}

export type EditorCapabilityContributionContext = {
  registerFeature<T>(token: EditorCapabilityToken<T>, feature: T): EditorDisposable
  /**
   * Adds one more source for a language feature, next to whichever others already answer it. The
   * selector decides which documents it is asked about and where in the order it sits; see
   * EditorLanguageFeatureSelector.
   */
  registerProvider<T>(
    token: EditorLanguageFeatureToken<T>,
    selector: EditorLanguageFeatureSelector,
    provider: T,
  ): EditorDisposable
}

export type EditorEditContributionContext = EditorDocumentContributionContext &
  EditorCapabilityContributionContext & {
    getSelections(): readonly EditorResolvedSelection[]
    focusEditor(): void
    applyEdits(
      edits: readonly TextEdit[],
      timingName: string,
      selection?: EditorSelectionRange,
    ): void
    /**
     * Starts tab-stop navigation over the text just inserted: one entry per stop, carrying the
     * range the caret visits and, where the snippet writes that stop more than once, the copies
     * that have to go on reading the same as it while it is being typed into. A copy with a
     * `transform` is rendered from the stop's text rather than holding it verbatim.
     */
    startSnippetSession(stops: readonly EditorSnippetStop[]): void
  }

/** A second place a snippet writes a stop, kept reading the same as the stop while it is typed. */
export type EditorSnippetMirror = SnippetMirrorRange

/** One tab stop as a snippet source hands it over: where the caret visits, and its copies. */
export type EditorSnippetStop = SnippetSessionStop

export type EditorFeatureContributionContext = EditorFeatureDomContributionContext &
  EditorDocumentContributionContext &
  EditorSelectionContributionContext &
  EditorEditContributionContext &
  EditorRangeHighlightContributionContext &
  EditorRowDecorationContributionContext &
  EditorCommandContributionContext &
  EditorCapabilityContributionContext

export type EditorCommandContribution = EditorDisposable

export type EditorCommandContributionProvider = {
  createContribution(context: EditorCommandContributionContext): EditorCommandContribution | null
}

export type EditorCapabilityContribution = EditorDisposable

export type EditorCapabilityContributionProvider = {
  createContribution(
    context: EditorCapabilityContributionContext,
  ): EditorCapabilityContribution | null
}

export type EditorEditContribution = EditorDisposable

export type EditorEditContributionProvider = {
  createContribution(context: EditorEditContributionContext): EditorEditContribution | null
}

/** One place a paste is about to land, with the text it would replace. */
export type EditorPasteTarget = {
  readonly start: number
  readonly end: number
  /** What the paste displaces, empty at a caret. A handler that rewrites around it reads it here. */
  readonly text: string
}

/**
 * A paste, as the transfer describes it rather than as the text it flattens to.
 *
 * The flattening is the whole problem: an image, a URL landing on a word, a symbol whose import has
 * to travel with it are each a different payload, and every one of them reaches `text/plain` as
 * either nothing at all or as something that reads wrong where it lands.
 */
export type EditorPasteContext = {
  /** The transfer itself, for a type nothing named here carries. */
  readonly dataTransfer: DataTransfer
  /** Types the transfer reports; `'Files'` is the one a browser uses for the files below. */
  readonly types: readonly string[]
  readonly files: readonly File[]
  /** `text/plain` with its line endings already flattened — what the default path would insert. */
  readonly text: string
  readonly languageId: EditorSyntaxLanguageId | null
  /** The payload was copied out of an editor in this process, so a move within one is visible. */
  readonly internal: boolean
  /** A drop lands at the pointer: its one target is the caret the drop placed there. */
  readonly source: 'paste' | 'drop'
  /** Where it lands, in document order. */
  readonly targets: readonly EditorPasteTarget[]
}

/**
 * A reading of a paste other than its plain text.
 *
 * Registered against `EDITOR_PASTE_HANDLER`, so which documents a handler is asked about and where
 * in the order it sits are the selector's to say. The first handler to answer takes the paste;
 * declining costs it nothing, and the plain-text path is what remains when every one of them does.
 */
export type EditorPasteHandler = {
  /** Types this handler answers for. A transfer carrying none of them never reaches it. */
  readonly mimeTypes: readonly string[]
  /**
   * The text each target takes, one entry per entry of `context.targets`, or null to pass. A list
   * of any other length does not describe these targets and is declined on the handler's behalf.
   */
  handlePaste(context: EditorPasteContext): readonly string[] | null
}

export const EDITOR_PASTE_HANDLER_ID = 'editor.pasteHandler'

export const EDITOR_PASTE_HANDLER =
  createEditorLanguageFeatureToken<EditorPasteHandler>(EDITOR_PASTE_HANDLER_ID)

export type EditorDecorationContributionContext = EditorDocumentContributionContext &
  EditorRangeHighlightContributionContext &
  EditorRowDecorationContributionContext & {
    /**
     * Decorations registered here follow the text through edits, so a
     * contribution states where a decoration is once instead of recomputing its
     * offsets after every keystroke. Shared with every other contribution, which
     * is why each one owns its entries.
     */
    readonly decorations: EditorDecorationStore
  }

export type EditorDecorationContribution = EditorDisposable & {
  handleEditorChange?(change: EditorContributionChange | null): void
}

export type EditorDecorationContributionProvider = {
  createContribution(
    context: EditorDecorationContributionContext,
  ): EditorDecorationContribution | null
}

export type EditorFeatureContribution = EditorDisposable & {
  handleEditorChange?(change: EditorContributionChange | null): void
}

export type EditorFeatureContributionProvider = {
  createContribution(context: EditorFeatureContributionContext): EditorFeatureContribution | null
}

export type EditorGutterWidthContext = {
  readonly lineCount: number
  readonly metrics: BrowserTextMetrics
}

export type EditorGutterRowContext = {
  readonly index: number
  readonly bufferRow: number
  readonly source: DisplayTextRowSource
  readonly startOffset: number
  readonly endOffset: number
  readonly text: TextContent
  readonly kind: 'text'
  readonly injectedTextRowId?: string
  readonly metadata?: unknown
  readonly primaryText: boolean
  readonly cursorLine: boolean
  readonly cursorLineHighlight: Required<EditorCursorLineHighlightOptions>
  readonly foldMarker: VirtualizedFoldMarker | null
  readonly lineCount: number
  toggleFold(marker: VirtualizedFoldMarker): void
}

export type EditorInjectedTextRow = InjectedTextRow

export type EditorInjectedTextRowProviderContext = {
  readonly documentId: string | null
  readonly textSnapshot: TextReadSnapshot
  readonly lineCount: number
}

export type EditorInjectedTextRowProvider = {
  getInjectedTextRows(
    context: EditorInjectedTextRowProviderContext,
  ): readonly EditorInjectedTextRow[]
  onDidChangeInjectedTextRows?(listener: () => void): EditorDisposable
}

export type EditorGutterContribution = {
  readonly snapshotRenderer?: {
    readonly key: string
    capture(cell: HTMLElement): string | null
    restore(cell: HTMLElement, paint: string): boolean
  }
  readonly id: string
  readonly className?: string
  /** The cell takes pointer events; the rest of the gutter passes them to the text beneath. */
  readonly interactive?: boolean
  createCell(document: Document): HTMLElement
  width(context: EditorGutterWidthContext): number
  updateCell(element: HTMLElement, row: EditorGutterRowContext): void
  disposeCell?(element: HTMLElement): void
}

export type EditorInlineReplacementContext = {
  readonly textSnapshot: TextReadSnapshot
  readonly languageId: EditorSyntaxLanguageId | null
  readonly captures: readonly EditorSyntaxCapture[]
  /** Where the carets are, so a provider can leave the token being typed as text. */
  readonly selections: readonly EditorResolvedSelection[]
}

/**
 * Derives the spans a document renders something else in place of — hidden markdown fences, a bullet
 * standing in for `-`, and so on. Called with fresh syntax captures whenever the parse settles.
 * Providers compose: every registered provider contributes, and overlapping spans are resolved by
 * the inline map, outermost first.
 */
export type EditorInlineReplacementProvider = (
  context: EditorInlineReplacementContext,
) => readonly InlineReplacementSpec[]

/**
 * `'syntax'` (the default) reruns a provider when captures land and turns captures on while it is
 * registered. `'edit'` reruns it inside every operation that edits or moves a selection, so a span
 * it derives from the text itself is in the map that operation paints; it asks for no captures.
 */
export type EditorInlineReplacementTrigger = 'syntax' | 'edit'

export type EditorInlineReplacementProviderOptions = {
  readonly trigger?: EditorInlineReplacementTrigger
}

export type EditorInlineReplacementSource = {
  readonly provide: EditorInlineReplacementProvider
  readonly trigger: EditorInlineReplacementTrigger
}

export type EditorSelectionRangeContext = {
  readonly textSnapshot: TextReadSnapshot
  readonly languageId: EditorSyntaxLanguageId | null
  /** The caret the ladder is being built around; a provider that knows only a point uses this. */
  readonly offset: number
  readonly selection: TextOffsetRange
  /**
   * Enclosing constructs the last structural parse reported, so a grammar-backed provider answers
   * from the parse the document already paid for instead of asking for one of its own.
   */
  readonly folds: readonly FoldRange[]
}

/**
 * One source of candidate ranges around a caret, in no particular order.
 *
 * Ranking is deliberately not a provider's job: a source that knows about brackets cannot compare
 * its ranges against one that knows about words, so each hands back a bucket and the expand/shrink
 * ladder is the single place that turns the union into the sequence a reader walks up.
 */
export type EditorSelectionRangeProvider = (
  context: EditorSelectionRangeContext,
) => readonly TextOffsetRange[]

export type EditorPluginContext = {
  log(event: EditorLogInput): void
  registerLogger(logger: EditorLogger): EditorDisposable
  registerHighlighter(provider: EditorHighlighterProvider): EditorDisposable
  registerSyntaxProvider(provider: EditorSyntaxProvider): EditorDisposable
  registerViewContribution(provider: EditorViewContributionProvider): EditorDisposable
  registerCommandContribution(provider: EditorCommandContributionProvider): EditorDisposable
  registerCapabilityContribution(provider: EditorCapabilityContributionProvider): EditorDisposable
  registerEditContribution(provider: EditorEditContributionProvider): EditorDisposable
  registerDecorationContribution(provider: EditorDecorationContributionProvider): EditorDisposable
  registerGutterContribution(contribution: EditorGutterContribution): EditorDisposable
  registerInjectedTextRowProvider(provider: EditorInjectedTextRowProvider): EditorDisposable
  registerInlineReplacementProvider(
    provider: EditorInlineReplacementProvider,
    options?: EditorInlineReplacementProviderOptions,
  ): EditorDisposable
  registerSelectionRangeProvider(provider: EditorSelectionRangeProvider): EditorDisposable
}

/** The view context `createPlugin`'s scope is built on: the combined per-view context. */
export type EditorInternalViewContributionContext = EditorViewContributionContext & {
  /** The owning editor, typed where it is used; unstable. */
  readonly unstableEditor: unknown
  getSelections(): readonly EditorResolvedSelection[]
  applyEdits(edits: readonly TextEdit[], timingName: string, selection?: EditorSelectionRange): void
  registerCommand(command: EditorAnyCommandId, handler: EditorCommandHandler): EditorDisposable
  /** A contribution whose `inputs` changed after it was created asks for its routing to be rebuilt. */
  refreshInputs(): void
}

export type EditorInternalPluginContext = EditorPluginContext & {
  registerEditorFeatureContribution(provider: EditorFeatureContributionProvider): EditorDisposable
  /** Installs a plugin this one uses, once per editor however many use it, until the last lets go. */
  usePlugin(plugin: EditorPlugin): EditorDisposable
}

export type EditorPlugin = {
  readonly name?: string
  /** Commands the plugin contributes, as data: listed by hosts, removed with the plugin. */
  readonly commands?: readonly EditorContributedCommandDeclaration[]
  install?(context: EditorPluginContext): void | EditorDisposable | readonly EditorDisposable[]
  activate(context: EditorPluginContext): void | EditorDisposable | readonly EditorDisposable[]
  update?(context: EditorPluginContext, state: EditorPluginLifecycleState): void
  deactivate?(context: EditorPluginContext): void
  dispose?(context: EditorPluginContext): void
}

export type EditorPluginLifecycleState = {
  readonly active: boolean
  readonly managed: boolean
  readonly manual: boolean
  /** Another plugin in this editor uses it. */
  readonly used: boolean
}

export type EditorPluginHostEvents = {
  onPluginInstalled?(name: string, durationMs: number): void
  onPluginInstallFailed?(name: string, error: unknown, durationMs: number): void
  onHighlighterProvidersChanged?(): void
  onSyntaxProvidersChanged?(): void
  onInlineReplacementProvidersChanged?(): void
  onPluginActivated?(name: string, durationMs: number): void
  onPluginActivationFailed?(name: string, error: unknown, durationMs: number): void
  onPluginUpdated?(name: string, durationMs: number): void
  onPluginUpdateFailed?(name: string, error: unknown, durationMs: number): void
  onPluginDeactivated?(name: string, durationMs: number): void
  onPluginDeactivateFailed?(name: string, error: unknown, durationMs: number): void
  onPluginDisposed?(name: string): void
  onPluginDisposeFailed?(name: string, error: unknown, durationMs: number): void
  onViewContributionProviderAdded?(provider: EditorViewContributionProvider): void
  onViewContributionProviderRemoved?(provider: EditorViewContributionProvider): void
  onDecorationContributionProviderAdded?(provider: EditorDecorationContributionProvider): void
  onDecorationContributionProviderRemoved?(provider: EditorDecorationContributionProvider): void
  onCommandContributionProviderAdded?(provider: EditorCommandContributionProvider): void
  onCommandContributionProviderRemoved?(provider: EditorCommandContributionProvider): void
  onCapabilityContributionProviderAdded?(provider: EditorCapabilityContributionProvider): void
  onCapabilityContributionProviderRemoved?(provider: EditorCapabilityContributionProvider): void
  onEditContributionProviderAdded?(provider: EditorEditContributionProvider): void
  onEditContributionProviderRemoved?(provider: EditorEditContributionProvider): void
  onEditorFeatureContributionProviderAdded?(provider: EditorFeatureContributionProvider): void
  onEditorFeatureContributionProviderRemoved?(provider: EditorFeatureContributionProvider): void
  onGutterContributionsChanged?(): void
  onInjectedTextRowProvidersChanged?(): void
}

const LANGUAGE_SELECTOR_SCORE = 10
const WILDCARD_SELECTOR_SCORE = 5

type LanguageFeatureEntry = {
  readonly provider: unknown
  readonly selector: EditorLanguageFeatureSelector
  readonly sequence: number
}

type LanguageFeatureChannel = {
  readonly entries: LanguageFeatureEntry[]
  readonly ordered: Map<EditorSyntaxLanguageId | null, readonly unknown[]>
}

/**
 * The sources answering each language feature, and the order a consumer asks them in.
 *
 * How closely a provider's selector fits the document decides the order before anything the
 * provider asked for itself does: one that named this language outranks one that took every
 * document, so a general source cannot push a language's own source aside by claiming a priority.
 * Priority separates only providers that fit equally well, and registration order separates the
 * rest — leaving the sequence a consumer walks the same on every query.
 */
export type EditorLanguageFeatureRegistryListener = (tokenId: string, count: number) => void

export class EditorLanguageFeatureRegistry {
  private readonly channels = new Map<string, LanguageFeatureChannel>()
  private readonly listeners = new Set<EditorLanguageFeatureRegistryListener>()
  private sequence = 0

  /** How many providers answer for a token, whatever the document. */
  public count(token: EditorLanguageFeatureToken<unknown>): number {
    return this.channels.get(token.id)?.entries.length ?? 0
  }

  /** Told after every registration and removal with the token's new provider count. */
  public subscribe(listener: EditorLanguageFeatureRegistryListener): EditorDisposable {
    this.listeners.add(listener)
    return disposableOnce(() => this.listeners.delete(listener))
  }

  public register<T>(
    token: EditorLanguageFeatureToken<T>,
    selector: EditorLanguageFeatureSelector,
    provider: T,
  ): EditorDisposable {
    const channel = this.channelFor(token.id)
    const entry: LanguageFeatureEntry = { provider, selector, sequence: this.sequence++ }
    channel.entries.push(entry)
    channel.ordered.clear()
    this.notify(token.id, channel.entries.length)

    return disposableOnce(() => this.unregister(token.id, entry))
  }

  public ordered<T>(
    token: EditorLanguageFeatureToken<T>,
    languageId: EditorSyntaxLanguageId | null,
  ): readonly T[] {
    const channel = this.channels.get(token.id)
    if (!channel) return []

    // Language features are queried per keystroke, so the answer for a language is held until a
    // registration moves and consumers can skip work on the array they already have.
    const cached = channel.ordered.get(languageId)
    if (cached) return cached as readonly T[]

    const providers = orderedLanguageFeatureProviders(channel.entries, languageId)
    channel.ordered.set(languageId, providers)

    return providers as readonly T[]
  }

  private channelFor(id: string): LanguageFeatureChannel {
    const existing = this.channels.get(id)
    if (existing) return existing

    const channel: LanguageFeatureChannel = { entries: [], ordered: new Map() }
    this.channels.set(id, channel)

    return channel
  }

  private unregister(id: string, entry: LanguageFeatureEntry): void {
    const channel = this.channels.get(id)
    if (!channel) return

    const index = channel.entries.indexOf(entry)
    if (index === -1) return

    channel.entries.splice(index, 1)
    channel.ordered.clear()
    this.notify(id, channel.entries.length)
  }

  private notify(tokenId: string, count: number): void {
    for (const listener of this.listeners) listener(tokenId, count)
  }
}

function orderedLanguageFeatureProviders(
  entries: readonly LanguageFeatureEntry[],
  languageId: EditorSyntaxLanguageId | null,
): readonly unknown[] {
  const matched: { readonly entry: LanguageFeatureEntry; readonly score: number }[] = []
  for (const entry of entries) {
    const score = languageFeatureSelectorScore(entry.selector, languageId)
    if (score > 0) matched.push({ entry, score })
  }

  matched.sort(
    (a, b) =>
      b.score - a.score ||
      (b.entry.selector.priority ?? 0) - (a.entry.selector.priority ?? 0) ||
      a.entry.sequence - b.entry.sequence,
  )

  return matched.map((match) => match.entry.provider)
}

function languageFeatureSelectorScore(
  selector: EditorLanguageFeatureSelector,
  languageId: EditorSyntaxLanguageId | null,
): number {
  if (selector.language === '*') return WILDCARD_SELECTOR_SCORE

  return selector.language === languageId ? LANGUAGE_SELECTOR_SCORE : 0
}

type InstalledEditorPlugin = {
  activationDisposable: EditorDisposable | null
  active: boolean
  installationDisposable: EditorDisposable | null
  readonly context: EditorInternalPluginContext
  readonly registrations: PluginRegistrations
}

/** Who owns a registration a plugin makes through its context, by when it makes it. */
type PluginRegistrations = {
  /** The running `install` or `activate` call's own store. */
  scope: EditorDisposableStore | null
  /** Later, while active: released when the plugin deactivates. */
  active: EditorDisposableStore | null
  /** Later, while installed but inactive: released when the plugin is removed. */
  readonly installed: EditorDisposableStore
}

type EditorPluginActivation = {
  readonly activated: boolean
  readonly disposable: EditorDisposable | null
}

type EditorPluginInstallation = {
  readonly installed: boolean
  readonly disposable: EditorDisposable | null
}

/**
 * A plugin an editor installs by itself, for as long as something in that editor asks for what it
 * serves. This is how a package that is not the editor gives the editor a capability of its own:
 * the shared hover registers itself here when its participant token is imported, and an editor
 * loads and installs it the moment the first hover participant registers, and drops it when the
 * last one goes. A host wires nothing, and an editor with no participants pays nothing.
 */
export type AmbientEditorPlugin = {
  /** The language feature whose providers are the demand: installed while any is registered. */
  readonly demand: EditorLanguageFeatureToken<unknown>
  /** Called once, on first demand from any editor; the plugin is shared by every editor after. */
  load(): EditorPlugin | Promise<EditorPlugin>
}

const ambientPlugins = new Set<AmbientEditorPlugin>()
const ambientListeners = new Set<() => void>()

export function registerAmbientEditorPlugin(ambient: AmbientEditorPlugin): EditorDisposable {
  ambientPlugins.add(ambient)
  for (const listener of ambientListeners) listener()
  return disposableOnce(() => {
    ambientPlugins.delete(ambient)
    for (const listener of ambientListeners) listener()
  })
}

export function ambientEditorPlugins(): readonly AmbientEditorPlugin[] {
  return Array.from(ambientPlugins)
}

/** Told after every registration and removal, so a live editor follows the list. */
export function subscribeAmbientEditorPlugins(listener: () => void): EditorDisposable {
  ambientListeners.add(listener)
  return disposableOnce(() => ambientListeners.delete(listener))
}

export class EditorPluginHost implements EditorDisposable {
  private readonly loggers: EditorLogger[] = []
  private readonly highlighters: EditorHighlighterProvider[] = []
  private readonly syntaxProviders: EditorSyntaxProvider[] = []
  private readonly viewContributions: EditorViewContributionProvider[] = []
  private readonly commandContributions: EditorCommandContributionProvider[] = []
  private readonly capabilityContributions: EditorCapabilityContributionProvider[] = []
  private readonly editContributions: EditorEditContributionProvider[] = []
  private readonly decorationContributions: EditorDecorationContributionProvider[] = []
  private readonly editorFeatureContributions: EditorFeatureContributionProvider[] = []
  private readonly gutterContributions: EditorGutterContribution[] = []
  private readonly injectedTextRowProviders: EditorInjectedTextRowProvider[] = []
  private readonly inlineReplacementProviders: EditorInlineReplacementSource[] = []
  private readonly selectionRangeProviders: EditorSelectionRangeProvider[] = []
  private readonly injectedTextRowProviderInvalidationDisposables = new Map<
    EditorInjectedTextRowProvider,
    MutableEditorDisposable
  >()
  private readonly installedPlugins = new Map<EditorPlugin, InstalledEditorPlugin>()
  private readonly managedPlugins = new Set<EditorPlugin>()
  private readonly manualPlugins = new Set<EditorPlugin>()
  private readonly usedPlugins = new Map<EditorPlugin, number>()
  private events: EditorPluginHostEvents = {}
  private disposed = false

  public constructor(plugins: readonly EditorPlugin[] = []) {
    this.setPlugins(plugins)
  }

  public setEvents(events: EditorPluginHostEvents): void {
    this.events = events
  }

  public addPlugin(plugin: EditorPlugin): EditorDisposable {
    if (this.manualPlugins.has(plugin)) return disposableOnce(() => undefined)
    if (!this.ensurePluginActive(plugin)) return disposableOnce(() => undefined)

    this.manualPlugins.add(plugin)
    this.updatePlugin(plugin)

    return disposableOnce(() => this.removeManualPlugin(plugin))
  }

  public removePlugin(plugin: EditorPlugin): boolean {
    const removedManaged = this.removeManagedPlugin(plugin)
    const removedManual = this.removeManualPlugin(plugin)
    return removedManaged || removedManual
  }

  public setPlugins(plugins: readonly EditorPlugin[]): void {
    const nextPlugins = new Set(plugins)

    for (const plugin of this.managedPlugins) {
      if (nextPlugins.has(plugin)) continue

      this.managedPlugins.delete(plugin)
      this.updatePlugin(plugin)
      this.disposePluginIfUnowned(plugin)
    }

    for (const plugin of nextPlugins) {
      if (this.managedPlugins.has(plugin)) continue

      if (!this.ensurePluginActive(plugin)) continue

      this.managedPlugins.add(plugin)
      this.updatePlugin(plugin)
    }
  }

  public createHighlighterSession(
    options: EditorHighlighterSessionOptions,
  ): EditorHighlighterSession | null {
    for (const provider of this.highlighters) {
      const session = provider.createSession(options)
      if (session) return session
    }

    return null
  }

  public hasHighlighterProviders(): boolean {
    return this.highlighters.length > 0
  }

  public getHighlighterProvider(): EditorHighlighterProvider | null {
    return this.highlighters[0] ?? null
  }

  public async loadHighlighterTheme(): Promise<EditorTheme | null | undefined> {
    for (const provider of this.highlighters) {
      if (!provider.loadTheme) continue

      const theme = await provider.loadTheme()
      if (theme !== undefined) return theme
    }

    return undefined
  }

  public createSyntaxSession(options: EditorSyntaxSessionOptions): EditorSyntaxSession | null {
    for (const provider of this.syntaxProviders) {
      const session = provider.createSession(options)
      if (session) return session
    }

    return null
  }

  public hasSyntaxProviders(): boolean {
    return this.syntaxProviders.length > 0
  }

  public getSyntaxProvider(): EditorSyntaxProvider | null {
    return this.syntaxProviders[0] ?? null
  }

  public createViewContributions(context: EditorViewContributionContext): EditorViewContribution[] {
    const contributions: EditorViewContribution[] = []
    for (const provider of this.viewContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public createCommandContributions(
    context: EditorCommandContributionContext,
  ): EditorCommandContribution[] {
    const contributions: EditorCommandContribution[] = []
    for (const provider of this.commandContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public createCapabilityContributions(
    context: EditorCapabilityContributionContext,
  ): EditorCapabilityContribution[] {
    const contributions: EditorCapabilityContribution[] = []
    for (const provider of this.capabilityContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public createEditContributions(context: EditorEditContributionContext): EditorEditContribution[] {
    const contributions: EditorEditContribution[] = []
    for (const provider of this.editContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public createDecorationContributions(
    context: EditorDecorationContributionContext,
  ): EditorDecorationContribution[] {
    const contributions: EditorDecorationContribution[] = []
    for (const provider of this.decorationContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public createEditorFeatureContributions(
    context: EditorFeatureContributionContext,
  ): EditorFeatureContribution[] {
    const contributions: EditorFeatureContribution[] = []
    for (const provider of this.editorFeatureContributions) {
      const contribution = provider.createContribution(context)
      if (contribution) contributions.push(contribution)
    }

    return contributions
  }

  public getGutterContributions(): readonly EditorGutterContribution[] {
    return [...this.gutterContributions]
  }

  public getInlineReplacementProviders(): readonly EditorInlineReplacementSource[] {
    return this.inlineReplacementProviders
  }

  public getSelectionRangeProviders(): readonly EditorSelectionRangeProvider[] {
    return this.selectionRangeProviders
  }

  public getInjectedTextRowProviders(): readonly EditorInjectedTextRowProvider[] {
    return this.injectedTextRowProviders
  }

  public getViewContributionProviders(): readonly EditorViewContributionProvider[] {
    return this.viewContributions
  }

  /** The commands the active plugins contribute, in plugin order. */
  public getContributedCommands(): readonly EditorContributedCommandDeclaration[] {
    const commands: EditorContributedCommandDeclaration[] = []
    for (const [plugin, installed] of this.installedPlugins) {
      if (installed.active) commands.push(...(plugin.commands ?? []))
    }
    return commands
  }

  public getCommandContributionProviders(): readonly EditorCommandContributionProvider[] {
    return this.commandContributions
  }

  public getCapabilityContributionProviders(): readonly EditorCapabilityContributionProvider[] {
    return this.capabilityContributions
  }

  public getEditContributionProviders(): readonly EditorEditContributionProvider[] {
    return this.editContributions
  }

  public getDecorationContributionProviders(): readonly EditorDecorationContributionProvider[] {
    return this.decorationContributions
  }

  public getEditorFeatureContributionProviders(): readonly EditorFeatureContributionProvider[] {
    return this.editorFeatureContributions
  }

  public getActivePluginNames(): readonly string[] {
    const names: string[] = []
    for (const [plugin, state] of this.installedPlugins) {
      if (state.active) names.push(pluginName(plugin))
    }

    return names
  }

  public hasLoggers(): boolean {
    return this.loggers.length > 0
  }

  public log(event: EditorLogEvent): void {
    if (this.loggers.length === 0) return

    for (const logger of this.loggers) callEditorLogger(logger, event)
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    while (this.installedPlugins.size > 0) {
      const plugin = this.installedPlugins.keys().next().value
      if (!plugin) break

      this.disposeInstalledPlugin(plugin)
    }
    this.managedPlugins.clear()
    this.manualPlugins.clear()
    this.usedPlugins.clear()
    this.loggers.length = 0
    this.highlighters.length = 0
    this.syntaxProviders.length = 0
    this.viewContributions.length = 0
    this.commandContributions.length = 0
    this.capabilityContributions.length = 0
    this.editContributions.length = 0
    this.decorationContributions.length = 0
    this.editorFeatureContributions.length = 0
    this.gutterContributions.length = 0
    for (const disposable of this.injectedTextRowProviderInvalidationDisposables.values()) {
      disposable.dispose()
    }
    this.injectedTextRowProviderInvalidationDisposables.clear()
    this.injectedTextRowProviders.length = 0
    this.inlineReplacementProviders.length = 0
    this.selectionRangeProviders.length = 0
  }

  private ensurePluginActive(plugin: EditorPlugin): boolean {
    const installedPlugin = this.ensurePluginInstalled(plugin)
    if (!installedPlugin) return false
    if (installedPlugin.active) return true

    const activation = this.activatePlugin(plugin, installedPlugin)
    if (!activation.activated) {
      this.disposeInstalledPlugin(plugin)
      return false
    }

    installedPlugin.active = true
    installedPlugin.activationDisposable = activation.disposable
    return true
  }

  private ensurePluginInstalled(plugin: EditorPlugin): InstalledEditorPlugin | null {
    const installedPlugin = this.installedPlugins.get(plugin)
    if (installedPlugin) return installedPlugin

    const nextInstalledPlugin = this.createInstalledPlugin()
    const installation = this.installPlugin(plugin, nextInstalledPlugin)
    if (!installation.installed) {
      nextInstalledPlugin.registrations.installed.dispose()
      return null
    }

    nextInstalledPlugin.installationDisposable = installation.disposable
    this.installedPlugins.set(plugin, nextInstalledPlugin)
    return nextInstalledPlugin
  }

  // Each plugin gets its own context, so a registration it makes from a timer or a promise is its
  // own and goes when it does, and one plugin object in two editors keeps two separate owners.
  private createInstalledPlugin(): InstalledEditorPlugin {
    const registrations: PluginRegistrations = {
      scope: null,
      active: null,
      installed: new EditorDisposableStore(),
    }
    return {
      active: false,
      activationDisposable: null,
      installationDisposable: null,
      context: this.createContext(registrations),
      registrations,
    }
  }

  private disposePluginIfUnowned(plugin: EditorPlugin): void {
    if (this.managedPlugins.has(plugin)) return
    if (this.manualPlugins.has(plugin)) return
    if (this.usedPlugins.has(plugin)) return

    this.deactivatePlugin(plugin)
    this.disposeInstalledPlugin(plugin)
  }

  private installPlugin(
    plugin: EditorPlugin,
    installed: InstalledEditorPlugin,
  ): EditorPluginInstallation {
    if (!plugin.install) return { installed: true, disposable: null }

    const start = nowMs()
    const registrations = new EditorDisposableStore()
    installed.registrations.scope = registrations

    try {
      const disposable = lifecycleDisposableFromResult(
        plugin.install(installed.context),
        registrations,
      )
      this.events.onPluginInstalled?.(pluginName(plugin), nowMs() - start)
      return { installed: true, disposable }
    } catch (error) {
      registrations.dispose()
      this.events.onPluginInstallFailed?.(pluginName(plugin), error, nowMs() - start)
      return { installed: false, disposable: null }
    } finally {
      installed.registrations.scope = null
    }
  }

  private activatePlugin(
    plugin: EditorPlugin,
    installed: InstalledEditorPlugin,
  ): EditorPluginActivation {
    const start = nowMs()
    const registrations = new EditorDisposableStore()
    installed.registrations.scope = registrations
    installed.registrations.active = new EditorDisposableStore()

    try {
      const disposable = lifecycleDisposableFromResult(
        plugin.activate(installed.context),
        registrations,
      )
      this.events.onPluginActivated?.(pluginName(plugin), nowMs() - start)
      return { activated: true, disposable }
    } catch (error) {
      registrations.dispose()
      this.events.onPluginActivationFailed?.(pluginName(plugin), error, nowMs() - start)
      return { activated: false, disposable: null }
    } finally {
      installed.registrations.scope = null
    }
  }

  private updatePlugin(plugin: EditorPlugin): void {
    const installedPlugin = this.installedPlugins.get(plugin)
    if (!installedPlugin?.active) return
    if (!plugin.update) return

    const start = nowMs()
    try {
      plugin.update(installedPlugin.context, this.lifecycleStateFor(plugin, installedPlugin))
      this.events.onPluginUpdated?.(pluginName(plugin), nowMs() - start)
    } catch (error) {
      this.events.onPluginUpdateFailed?.(pluginName(plugin), error, nowMs() - start)
    }
  }

  private deactivatePlugin(plugin: EditorPlugin): void {
    const installedPlugin = this.installedPlugins.get(plugin)
    if (!installedPlugin?.active) return

    const start = nowMs()
    try {
      plugin.deactivate?.(installedPlugin.context)
      this.events.onPluginDeactivated?.(pluginName(plugin), nowMs() - start)
    } catch (error) {
      this.events.onPluginDeactivateFailed?.(pluginName(plugin), error, nowMs() - start)
    }

    installedPlugin.active = false
    installedPlugin.activationDisposable?.dispose()
    installedPlugin.activationDisposable = null
    installedPlugin.registrations.active?.dispose()
    installedPlugin.registrations.active = null
    this.events.onPluginDisposed?.(pluginName(plugin))
  }

  private disposeInstalledPlugin(plugin: EditorPlugin): void {
    const installedPlugin = this.installedPlugins.get(plugin)
    if (!installedPlugin) return

    this.deactivatePlugin(plugin)
    this.installedPlugins.delete(plugin)
    const start = nowMs()
    try {
      plugin.dispose?.(installedPlugin.context)
    } catch (error) {
      // Teardown has to survive a plugin that throws on its way out: an escaping error would abort
      // the loop in dispose(), stranding every plugin behind it and everything the host's owner
      // unwinds after it.
      this.events.onPluginDisposeFailed?.(pluginName(plugin), error, nowMs() - start)
    } finally {
      installedPlugin.installationDisposable?.dispose()
      installedPlugin.registrations.installed.dispose()
    }
  }

  private lifecycleStateFor(
    plugin: EditorPlugin,
    installedPlugin: InstalledEditorPlugin,
  ): EditorPluginLifecycleState {
    return {
      active: installedPlugin.active,
      managed: this.managedPlugins.has(plugin),
      manual: this.manualPlugins.has(plugin),
      used: this.usedPlugins.has(plugin),
    }
  }

  private removeManagedPlugin(plugin: EditorPlugin): boolean {
    if (!this.managedPlugins.delete(plugin)) return false

    this.updatePlugin(plugin)
    this.disposePluginIfUnowned(plugin)
    return true
  }

  private usePlugin(plugin: EditorPlugin): EditorDisposable {
    const count = this.usedPlugins.get(plugin) ?? 0
    if (count === 0 && !this.ensurePluginActive(plugin)) return disposableOnce(() => undefined)

    this.usedPlugins.set(plugin, count + 1)
    if (count === 0) this.updatePlugin(plugin)
    return disposableOnce(() => this.releaseUsedPlugin(plugin))
  }

  private releaseUsedPlugin(plugin: EditorPlugin): void {
    const count = this.usedPlugins.get(plugin) ?? 0
    if (count > 1) {
      this.usedPlugins.set(plugin, count - 1)
      return
    }
    this.usedPlugins.delete(plugin)
    this.updatePlugin(plugin)
    this.disposePluginIfUnowned(plugin)
  }

  private removeManualPlugin(plugin: EditorPlugin): boolean {
    if (!this.manualPlugins.delete(plugin)) return false

    this.updatePlugin(plugin)
    this.disposePluginIfUnowned(plugin)
    return true
  }

  private createContext(owner: PluginRegistrations): EditorInternalPluginContext {
    return {
      log: (event) => this.logInput(event),
      registerLogger: (logger) => this.ownRegistration(owner, () => this.registerLogger(logger)),
      registerHighlighter: (provider) =>
        this.ownRegistration(owner, () => this.registerHighlighter(provider)),
      registerSyntaxProvider: (provider) =>
        this.ownRegistration(owner, () => this.registerSyntaxProvider(provider)),
      registerViewContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerViewContribution(provider)),
      registerCommandContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerCommandContribution(provider)),
      registerCapabilityContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerCapabilityContribution(provider)),
      registerEditContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerEditContribution(provider)),
      registerDecorationContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerDecorationContribution(provider)),
      registerEditorFeatureContribution: (provider) =>
        this.ownRegistration(owner, () => this.registerEditorFeatureContribution(provider)),
      registerGutterContribution: (contribution) =>
        this.ownRegistration(owner, () => this.registerGutterContribution(contribution)),
      registerInjectedTextRowProvider: (provider) =>
        this.ownRegistration(owner, () => this.registerInjectedTextRowProvider(provider)),
      registerInlineReplacementProvider: (provider, options) =>
        this.ownRegistration(owner, () =>
          this.registerInlineReplacementProvider(provider, options),
        ),
      registerSelectionRangeProvider: (provider) =>
        this.ownRegistration(owner, () => this.registerSelectionRangeProvider(provider)),
      usePlugin: (plugin) => this.ownRegistration(owner, () => this.usePlugin(plugin)),
    }
  }

  private logInput(event: EditorLogInput): void {
    this.log(normalizeEditorLogInput(event))
  }

  private registerLogger(logger: EditorLogger): EditorDisposable {
    this.loggers.push(logger)

    return disposableOnce(() => this.unregisterLogger(logger))
  }

  private unregisterLogger(logger: EditorLogger): void {
    const index = this.loggers.indexOf(logger)
    if (index === -1) return

    this.loggers.splice(index, 1)
  }

  private registerHighlighter(provider: EditorHighlighterProvider): EditorDisposable {
    this.highlighters.push(provider)
    const disposable = disposableOnce(() => this.unregisterHighlighter(provider))
    notifyRegistrationAdded(disposable, () => this.events.onHighlighterProvidersChanged?.())

    return disposable
  }

  private unregisterHighlighter(provider: EditorHighlighterProvider): void {
    const index = this.highlighters.indexOf(provider)
    if (index === -1) return

    this.highlighters.splice(index, 1)
    this.events.onHighlighterProvidersChanged?.()
  }

  private registerSyntaxProvider(provider: EditorSyntaxProvider): EditorDisposable {
    this.syntaxProviders.push(provider)
    const disposable = disposableOnce(() => this.unregisterSyntaxProvider(provider))
    notifyRegistrationAdded(disposable, () => this.events.onSyntaxProvidersChanged?.())

    return disposable
  }

  private unregisterSyntaxProvider(provider: EditorSyntaxProvider): void {
    const index = this.syntaxProviders.indexOf(provider)
    if (index === -1) return

    this.syntaxProviders.splice(index, 1)
    this.events.onSyntaxProvidersChanged?.()
  }

  private registerViewContribution(provider: EditorViewContributionProvider): EditorDisposable {
    this.viewContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterViewContribution(provider))

    try {
      this.events.onViewContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterViewContribution(provider: EditorViewContributionProvider): void {
    const index = this.viewContributions.indexOf(provider)
    if (index === -1) return

    this.viewContributions.splice(index, 1)
    this.events.onViewContributionProviderRemoved?.(provider)
  }

  private registerCommandContribution(
    provider: EditorCommandContributionProvider,
  ): EditorDisposable {
    this.commandContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterCommandContribution(provider))

    try {
      this.events.onCommandContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterCommandContribution(provider: EditorCommandContributionProvider): void {
    const index = this.commandContributions.indexOf(provider)
    if (index === -1) return

    this.commandContributions.splice(index, 1)
    this.events.onCommandContributionProviderRemoved?.(provider)
  }

  private registerCapabilityContribution(
    provider: EditorCapabilityContributionProvider,
  ): EditorDisposable {
    this.capabilityContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterCapabilityContribution(provider))

    try {
      this.events.onCapabilityContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterCapabilityContribution(provider: EditorCapabilityContributionProvider): void {
    const index = this.capabilityContributions.indexOf(provider)
    if (index === -1) return

    this.capabilityContributions.splice(index, 1)
    this.events.onCapabilityContributionProviderRemoved?.(provider)
  }

  private registerEditContribution(provider: EditorEditContributionProvider): EditorDisposable {
    this.editContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterEditContribution(provider))

    try {
      this.events.onEditContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterEditContribution(provider: EditorEditContributionProvider): void {
    const index = this.editContributions.indexOf(provider)
    if (index === -1) return

    this.editContributions.splice(index, 1)
    this.events.onEditContributionProviderRemoved?.(provider)
  }

  private registerDecorationContribution(
    provider: EditorDecorationContributionProvider,
  ): EditorDisposable {
    this.decorationContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterDecorationContribution(provider))

    try {
      this.events.onDecorationContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterDecorationContribution(provider: EditorDecorationContributionProvider): void {
    const index = this.decorationContributions.indexOf(provider)
    if (index === -1) return

    this.decorationContributions.splice(index, 1)
    this.events.onDecorationContributionProviderRemoved?.(provider)
  }

  private registerEditorFeatureContribution(
    provider: EditorFeatureContributionProvider,
  ): EditorDisposable {
    this.editorFeatureContributions.push(provider)
    const disposable = disposableOnce(() => this.unregisterEditorFeatureContribution(provider))

    try {
      this.events.onEditorFeatureContributionProviderAdded?.(provider)
    } catch (error) {
      disposable.dispose()
      throw error
    }

    return disposable
  }

  private unregisterEditorFeatureContribution(provider: EditorFeatureContributionProvider): void {
    const index = this.editorFeatureContributions.indexOf(provider)
    if (index === -1) return

    this.editorFeatureContributions.splice(index, 1)
    this.events.onEditorFeatureContributionProviderRemoved?.(provider)
  }

  private registerGutterContribution(contribution: EditorGutterContribution): EditorDisposable {
    if (this.gutterContributions.some((registered) => registered.id === contribution.id)) {
      throw new Error(`Editor gutter contribution already registered: ${contribution.id}`)
    }

    this.gutterContributions.push(contribution)
    const disposable = disposableOnce(() => this.unregisterGutterContribution(contribution))
    notifyRegistrationAdded(disposable, () => this.events.onGutterContributionsChanged?.())

    return disposable
  }

  private unregisterGutterContribution(contribution: EditorGutterContribution): void {
    const index = this.gutterContributions.indexOf(contribution)
    if (index === -1) return

    this.gutterContributions.splice(index, 1)
    this.events.onGutterContributionsChanged?.()
  }

  private registerInlineReplacementProvider(
    provider: EditorInlineReplacementProvider,
    options: EditorInlineReplacementProviderOptions = {},
  ): EditorDisposable {
    const source = { provide: provider, trigger: options.trigger ?? 'syntax' }
    this.inlineReplacementProviders.push(source)
    const disposable = disposableOnce(() => this.unregisterInlineReplacementProvider(source))
    notifyRegistrationAdded(disposable, () => this.events.onInlineReplacementProvidersChanged?.())

    return disposable
  }

  private unregisterInlineReplacementProvider(source: EditorInlineReplacementSource): void {
    const index = this.inlineReplacementProviders.indexOf(source)
    if (index === -1) return

    this.inlineReplacementProviders.splice(index, 1)
    this.events.onInlineReplacementProvidersChanged?.()
  }

  // Read fresh on every expand, so a registration needs no invalidation event to take effect.
  private registerSelectionRangeProvider(provider: EditorSelectionRangeProvider): EditorDisposable {
    this.selectionRangeProviders.push(provider)

    return disposableOnce(() => this.unregisterSelectionRangeProvider(provider))
  }

  private unregisterSelectionRangeProvider(provider: EditorSelectionRangeProvider): void {
    const index = this.selectionRangeProviders.indexOf(provider)
    if (index === -1) return

    this.selectionRangeProviders.splice(index, 1)
  }

  private registerInjectedTextRowProvider(
    provider: EditorInjectedTextRowProvider,
  ): EditorDisposable {
    this.injectedTextRowProviders.push(provider)
    const invalidation =
      this.injectedTextRowProviderInvalidationDisposables.get(provider) ??
      new MutableEditorDisposable()
    this.injectedTextRowProviderInvalidationDisposables.set(provider, invalidation)
    invalidation.value =
      provider.onDidChangeInjectedTextRows?.(() => {
        this.events.onInjectedTextRowProvidersChanged?.()
      }) ?? null
    const disposable = disposableOnce(() => this.unregisterInjectedTextRowProvider(provider))
    notifyRegistrationAdded(disposable, () => this.events.onInjectedTextRowProvidersChanged?.())

    return disposable
  }

  private unregisterInjectedTextRowProvider(provider: EditorInjectedTextRowProvider): void {
    const index = this.injectedTextRowProviders.indexOf(provider)
    if (index === -1) return

    this.injectedTextRowProviders.splice(index, 1)
    // Every lease on the same provider shares one invalidation subscription, so only the last one
    // out may close it — releasing it earlier would leave the surviving registrations deaf to the
    // provider's own change events.
    if (!this.injectedTextRowProviders.includes(provider)) {
      this.injectedTextRowProviderInvalidationDisposables.get(provider)?.dispose()
      this.injectedTextRowProviderInvalidationDisposables.delete(provider)
    }
    this.events.onInjectedTextRowProvidersChanged?.()
  }

  /**
   * Registrations reach the host only through a plugin's own context, so this is the one place that
   * names their owner: the install or activate call that is running, else the plugin's current
   * lifetime. A registration after the plugin is gone is undone at once.
   */
  private ownRegistration(
    registrations: PluginRegistrations,
    register: () => EditorDisposable,
  ): EditorDisposable {
    if (this.disposed) return disposableOnce(() => undefined)

    const owner = registrations.scope ?? registrations.active ?? registrations.installed
    const registration = register()
    const owned: EditorDisposable = disposableOnce(() => {
      owner.delete(owned)
      registration.dispose()
    })

    return owner.add(owned)
  }
}

function lifecycleDisposableFromResult(
  result: void | EditorDisposable | readonly EditorDisposable[],
  registrations: EditorDisposableStore,
): EditorDisposable | null {
  const disposable = disposableFromActivationResult(result)
  if (!disposable && registrations.size === 0) return null

  return disposableOnce(() => {
    disposable?.dispose()
    registrations.dispose()
  })
}

function disposableFromActivationResult(
  result: void | EditorDisposable | readonly EditorDisposable[],
): EditorDisposable | null {
  if (!result) return null
  if (!isDisposableList(result)) return result

  return {
    dispose: () => disposeAll(result),
  }
}

function disposeAll(disposables: readonly EditorDisposable[]): void {
  for (const disposable of disposables.toReversed()) disposable.dispose()
}

function disposableOnce(dispose: () => void): EditorDisposable {
  let disposed = false

  return {
    dispose() {
      if (disposed) return

      disposed = true
      dispose()
    },
  }
}

function notifyRegistrationAdded(disposable: EditorDisposable, notify: () => void): void {
  try {
    notify()
  } catch (error) {
    disposable.dispose()
    throw error
  }
}

const isDisposableList = (
  value: EditorDisposable | readonly EditorDisposable[],
): value is readonly EditorDisposable[] => Array.isArray(value)

function normalizeEditorLogInput(event: EditorLogInput): EditorLogEvent {
  return {
    ...event,
    source: 'editor',
    timestamp: event.timestamp ?? new Date().toISOString(),
  }
}

function callEditorLogger(logger: EditorLogger, event: EditorLogEvent): void {
  try {
    logger(event)
  } catch {
    // Logging must never affect editor behavior.
  }
}

function pluginName(plugin: EditorPlugin): string {
  return plugin.name ?? 'anonymous'
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now()
}
