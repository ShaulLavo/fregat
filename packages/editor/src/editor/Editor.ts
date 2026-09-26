import { captureJumpLocation, JumpHistory, type JumpLocation, type JumpCause } from './jumpHistory'
import type { EditorPointHit, EditorMarkerHit } from '../pointQueries'
import { decodePaintSnapshot, encodePaintSnapshot } from './paintSnapshot'
import { detectPlatform } from '@tanstack/hotkeys'
import {
  documentSessionChangeTextSnapshot,
  getDocumentMutationLeaseState,
  subscribeDocumentMutationLeaseState,
  type DocumentSession,
  type DocumentSessionChange,
  type EditorBufferSession,
  type EditorTextBufferChange,
} from '../documentSession'
import {
  foldRangesEqual,
  projectSyntaxFoldsThroughEdit,
  projectSyntaxFoldsThroughEdits,
  rejectCrossingFoldRanges,
  type FoldRangeRejection,
} from './folds'
import { EditorFallbackFoldController } from './fallbackFoldController'
import type { IndentationFoldIndex } from './indentationFoldIndex'
import { EditorFoldState } from './foldState'
import { anchorManualFolds, resolveManualFolds, type EditorViewFoldState } from '../viewFolds'
import { guessedTabSize } from './indentationGuess'
import { EditorKeymapController } from './keymap'
import type { EditorKeymapContext } from '../keymap/conditions'
import { InputSelectionController } from './inputSelectionController'
import { defaultRtlMoveVisually } from './navigationTargets'
import { EditorSyntaxController } from './syntaxController'
import { createEditorViewSnapshot } from './viewSnapshot'
import {
  DocumentEditChain,
  type DocumentLogicalRevisionScope,
  type DocumentSyncPoint,
} from './editChain'
import { LineStartsView } from '../virtualization/lineStartIndex'
import { EditorSecondaryWorkScheduler } from './secondaryWorkScheduler'
import { appendTiming, nowMs } from './timing'
import { projectTokensThroughEdit, projectTokensThroughEdits } from './tokenProjection'
import { createTextEditBatch, type TextEditBatch } from '../textEditBatch'
import { projectRowDecorationMapThroughEdits } from '../virtualization/rowDecorationProjection'
import {
  beginEditorPerformanceBatch,
  beginEditorPerformanceCommand,
  beginEditorPerformancePass,
  beginEditorPerformanceView,
  editorPerformanceDiagnosticsEnabled,
  endEditorPerformanceInput,
  endEditorPerformancePass,
  endEditorPerformanceScope,
  measureEditorPerformance,
  markEditorPerformanceFlush,
  recordEditorPerformanceDiagnostic,
  traceEditorPerformanceTask,
} from './performanceDiagnostics'
import type { EditorCommandContext, EditorCommandId } from './commands'
import {
  EDITOR_COMMANDS,
  isEditorCommandId,
  type EditorAnyCommandId,
  type EditorCommandDeclaration,
  type EditorContributedCommandDeclaration,
} from './commandCatalog'
import { normalizeEditorEditInput } from './editInput'
import { EditorAmbientPluginController } from './ambientPlugins'
import { EditorCommandRouter } from './commandRouter'
import { EditorAnnouncer } from './announce'
import { SelectionRangeStore } from './selectionRanges'
import { EditorDecorationStore, type EditorDecorationRange } from './decorationStore'
import { EditorOperation, type EditorOperationFlush } from './operation'
import { CursorHistory, sameCursorSelections, type CursorHistoryEntry } from './cursorHistory'
import {
  EditorDisplayProjectionRegistry,
  FULL_DISPLAY_PROJECTION_INVALIDATION,
  NO_DISPLAY_PROJECTION_DISPOSAL,
  type EditorDisplayProjection,
  type EditorDisplayProjectionSource,
} from './displayProjectionRegistry'
import { getHighlightRegistry, nextEditorHighlightPrefix, recordEditorMountTiming } from './runtime'
import {
  DOCUMENT_START_SCROLL_POSITION,
  normalizeScrollOffset,
  preservedScrollPosition,
} from './scroll'
import {
  normalizeEditorDocumentMode,
  normalizeEditorSelectionSyncMode,
  type ResetOwnedDocumentOptions,
} from './editorDocument'
import { EditorDocumentController } from './documentController'
import { removeArrayItem, type SessionChangeOptions } from './editorUtils'
import { EDITOR_FIND_FEATURE, type EditorFindFeature } from './findFeature'
import { createSnippetTokensFeature, EDITOR_SNIPPET_TOKENS_FEATURE } from './snippetTokensFeature'
import {
  foldCandidateAtLocation,
  foldRangesOutsideSpans,
  manualFoldRangesForSpans,
  nestableFoldRanges,
  planFoldCommand,
  type EditorFoldCommandId,
  type EditorFoldPlanCommandId,
  type FoldCommandLocation,
  type FoldOperation,
  type ManualFoldSpan,
} from './foldOperations'
import {
  groupedRangeDecorations,
  rangeDecorationsWithProjectionStacking,
  sameEditorRangeDecorations,
} from './rangeDecorations'
import { selectionRevealOffset, type EditorSetSelectionOptions } from './selectionReveal'
import { syncTextEdit } from './textEdits'
import type {
  EditorDocumentMode,
  EditorEditInput,
  EditorEditOptions,
  EditorEditability,
  EditorOptions,
  EditorOpenDocumentOptions,
  EditorRangeDecoration,
  EditorScrollPosition,
  EditorSetTextOptions,
  EditorSessionOptions,
  EditorState,
  EditorSyntaxStatus,
} from './types'
import { registerBuiltInPasteHandlers } from './pasteHandlers'
import {
  EditorViewContributionController,
  type EditorViewContributionFailurePhase,
} from './viewContributions'
import type { FoldMap } from '../foldMap'
import { createInlineMap, inlineSpecsAtSnapshot, type InlineMap } from '../inlineMap'
import type { BracketInfo, EditorSyntaxCapture } from '../syntax/session'
import type {
  EditorInlineReplacementContext,
  EditorInlineReplacementProvider,
  EditorInlineReplacementProviderOptions,
  EditorInlineReplacementSource,
  EditorResolvedSelection,
} from '../plugins'
import { normalizeTabSize } from '../displayTransforms'
import type { InjectedTextRow } from '../displayTransforms'
import {
  anchorAt,
  offsetToPoint,
  type PieceTableAnchor,
  type PieceTableSnapshot,
  pointToOffset,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

import type { TextOffsetRange } from '../textRanges'
import {
  EDITOR_PASTE_HANDLER,
  EditorLanguageFeatureRegistry,
  EditorPluginHost,
  type EditorCapabilityContribution,
  type EditorCapabilityContributionContext,
  type EditorCapabilityContributionProvider,
  type EditorCapabilityToken,
  type EditorCommandContribution,
  type EditorCommandContributionContext,
  type EditorCommandContributionProvider,
  type EditorCommandHandler,
  type EditorDecorationContribution,
  type EditorDecorationContributionContext,
  type EditorDecorationContributionProvider,
  type EditorDisposable,
  type EditorEditContribution,
  type EditorEditContributionContext,
  type EditorEditContributionProvider,
  type EditorFeatureContribution,
  type EditorFeatureContributionContext,
  type EditorFeatureContributionProvider,
  type EditorGutterContribution,
  type EditorInjectedTextRowProviderContext,
  type EditorLanguageFeatureSelector,
  type EditorLanguageFeatureToken,
  type EditorLogError,
  type EditorLogInput,
  type EditorOverlaySide,
  type EditorPlugin,
  type EditorPressParticipant,
  type EditorSelectionRange,
  type EditorTextAnchor,
  type EditorTrackedPoint,
  type EditorTrackedRanges,
  type EditorViewContribution,
  type EditorInternalViewContributionContext,
  type EditorViewContributionProvider,
  type EditorViewContributionUpdateKind,
  type EditorViewSnapshot,
  type EditorVisibleRowSnapshot,
  type EditorViewportSnapshot,
} from '../plugins'
import { lastAddedSelectionIndex, markSelectionSetDirty, resolveSelection } from '../selections'
import { type EditorSyntaxLanguageId } from '../syntax/session'
import type { EditorSyntaxRange } from '../syntax/session'
import {
  parseMergeConflicts,
  resolveMergeConflict as resolveMergeConflictText,
  type MergeConflictRegion,
  type MergeConflictResolution,
} from '../mergeConflicts'
import type { FoldRange } from '../syntax/session'
import type { EditorTheme } from '../theme'
import { editorThemesEqual, mergeEditorThemes } from '../theme'
import { EditorTokenStore, toEditorTokenStore, type EditorTokenInput } from '../syntax/tokenStore'
import type { EditorDocument, TextEdit } from '../tokens'
import {
  createStringTextSnapshot,
  getPieceTreeSnapshot,
  type TextSnapshot,
} from '../documentTextSnapshot'
import { clamp } from '../style-utils'
import {
  VirtualizedTextView,
  type HiddenCharactersMode,
  type VirtualizedFoldMarker,
  type VirtualizedTextRowDecoration,
} from '../virtualization/virtualizedTextView'
import {
  beginRowRectMeasurements,
  endRowRectMeasurements,
  invalidateRowRectMeasurements,
} from '../virtualization/virtualizedTextViewGeometry'
import { normalizeSuspiciousCharactersOptions } from '../unicodeHighlight'
import {
  observeBrowserTextMetricsInvalidation,
  type BrowserTextMetrics,
} from '../virtualization/browserMetrics'
import { EditorDisposableStore } from './disposables'
import { createError } from '../logging/evlog'
import type { EditorPreparedDocumentPayload } from './preparedDocument'

const RAPID_INPUT_SECONDARY_WORK_DELAY_MS = 150
// A sustained typing run never leaves a 150ms gap, so a pure debounce would
// defer syntax and feature work for as long as the user keeps typing. This is
// the ceiling on that wait, measured from the first keystroke of the burst.
const RAPID_INPUT_SECONDARY_WORK_MAX_DELAY_MS = 400
const RAPID_INPUT_TIMING_NAMES = new Set([
  'input.beforeinput',
  'input.composition',
  'input.keydownFallback',
  'input.backspace',
  'input.delete',
])
const VISIBLE_SYNTAX_OVERSCAN_CHARS = 20_000
const VISIBLE_SYNTAX_TRAILING_CHARS = 50_000
const VISIBLE_SYNTAX_LEAD_CHARS = 250_000
const VISIBLE_SYNTAX_MAX_LEAD_CHARS = 750_000
const VISIBLE_SYNTAX_SCROLL_DELAY_MS = 16
const BACKGROUND_SYNTAX_WARM_DELAY_MS = 80
const SYNTAX_FOLD_PROJECTION_OWNER = 'editor.folds.syntax'
const MANUAL_FOLD_PROJECTION_OWNER = 'editor.folds.manual'
const DIRECT_RANGE_DECORATION_OWNER = 'editor.rangeDecorations.direct'
const DIRECT_ROW_DECORATION_OWNER = 'editor.rowDecorations.direct'
const FEATURE_ROW_DECORATION_OWNER_PREFIX = 'editor.rowDecorations.feature:'
const PLUGIN_GUTTER_PROJECTION_OWNER = 'editor.gutters.plugins'
const PLUGIN_INJECTED_ROWS_PROJECTION_OWNER = 'editor.injectedRows.plugins'

type SyntaxScrollDirection = -1 | 0 | 1
type EditorContributionKind = 'capability' | 'command' | 'decoration' | 'edit' | 'feature' | 'view'
type EditorContributionFailurePhase =
  | EditorViewContributionFailurePhase
  | 'factory'
  | 'press'
  | 'reserved-width'
  | 'non-caret-row'

type TrackedAnchorRange = {
  readonly start: PieceTableAnchor
  readonly end: PieceTableAnchor
}

type EditorLifecycleSummary = {
  readonly pluginNames: Set<string>
  readonly plugin: {
    activatedCount: number
    deactivatedCount: number
    disposedCount: number
    failedCount: number
    installedCount: number
    slowestActivationMs: number | null
    updatedCount: number
  }
  readonly folds: {
    firstSyntaxRejection: Record<string, unknown> | null
    syntaxRejectedCount: number
  }
  readonly syntax: {
    refreshScheduledCount: number
  }
  readonly document: {
    attachedCount: number
    clearedCount: number
    detachedCount: number
    openedCount: number
    setTextCount: number
    startedCount: number
    syncedTextCount: number
  }
  readonly content: {
    setCount: number
  }
  mountDurationMs: number | null
  mountedAt: string | null
  disposingAt: string | null
}

export class Editor {
  private readonly container: HTMLElement
  private readonly view: VirtualizedTextView
  private readonly foldState: EditorFoldState
  private readonly fallbackFolds: EditorFallbackFoldController
  private readonly el: HTMLDivElement
  private lastSyntaxScrollTop: number | null = null
  private syntaxScrollDeltaPx = 0
  private syntaxScrollDirection: SyntaxScrollDirection = 0
  private readonly options: EditorOptions
  private readonly pluginHost: EditorPluginHost
  private readonly ambientPlugins: EditorAmbientPluginController
  private readonly commandRouter: EditorCommandRouter
  private readonly document: EditorDocumentController
  private readonly editorFeatures = new Map<EditorCapabilityToken<unknown>, unknown>()
  private readonly editorFeatureTokensById = new Map<string, EditorCapabilityToken<unknown>>()
  private readonly languageFeatures = new EditorLanguageFeatureRegistry()
  private readonly rowDecorationSourceOwners = new Map<string, symbol>()
  private readonly rowDecorationSourcesByOwner = new Map<symbol, Set<string>>()
  private readonly rowDecorationContributionOwners = new Map<
    EditorDecorationContribution | EditorFeatureContribution,
    symbol
  >()
  /**
   * What the contribution being created, or the one whose context is registering, has registered.
   * A factory that fails part-way leaves no object to dispose, and a contribution whose dispose
   * forgets a registration would leave it answering for nobody; both are released from here.
   */
  private contributionClaims: ContributionClaims | null = null
  private readonly claimsByContribution = new WeakMap<object, ContributionClaims>()
  private readonly commandContributions: EditorCommandContribution[] = []
  private readonly capabilityContributions: EditorCapabilityContribution[] = []
  private readonly editContributions: EditorEditContribution[] = []
  private readonly decorationContributions: EditorDecorationContribution[] = []
  private readonly editorFeatureContributions: EditorFeatureContribution[] = []
  private readonly viewContributionsByProvider = new Map<
    EditorViewContributionProvider,
    EditorViewContribution
  >()
  private readonly editorFeatureContributionsByProvider = new Map<
    EditorFeatureContributionProvider,
    EditorFeatureContribution
  >()
  private readonly commandContributionsByProvider = new Map<
    EditorCommandContributionProvider,
    EditorCommandContribution
  >()
  private readonly capabilityContributionsByProvider = new Map<
    EditorCapabilityContributionProvider,
    EditorCapabilityContribution
  >()
  private readonly editContributionsByProvider = new Map<
    EditorEditContributionProvider,
    EditorEditContribution
  >()
  private readonly decorationContributionsByProvider = new Map<
    EditorDecorationContributionProvider,
    EditorDecorationContribution
  >()
  private readonly keymap: EditorKeymapController
  private readonly environmentRegistrations = new EditorDisposableStore()
  private readonly viewContributions: EditorViewContributionController
  private readonly secondaryWork = new EditorSecondaryWorkScheduler()
  private readonly detachedEditChain = new DocumentEditChain(0, 0)
  private unsubscribeBufferChanges: (() => void) | null = null
  private unsubscribeLeaseChanges: (() => void) | null = null
  private lineStartsViewCache: {
    textVersion: number
    view: LineStartsView
  } | null = null
  private readonly displayProjections = new EditorDisplayProjectionRegistry()
  private readonly decorations = new EditorDecorationStore()
  private readonly highlightPrefix: string
  private sessionChangeVersion = 0
  private inlineReplacementProvider: EditorInlineReplacementSource | null = null
  private syntaxInlineMap: InlineMap | null = null
  private syntaxCaptures: readonly EditorSyntaxCapture[] = []
  /**
   * Regions the user drew rather than any provider describing them. They are held here and merged in
   * at the fan-in instead of being registered as a contribution, because the contribution set is
   * refused whole when two of its ranges cross, and a hand-drawn region cannot promise anything about
   * ranges a provider has not produced yet.
   */
  private manualFolds: readonly FoldRange[] = []
  private readonly syntax: EditorSyntaxController
  private readonly inputSelection: InputSelectionController
  private readonly selectionRanges: SelectionRangeStore
  private configuredTheme: EditorTheme | null = null
  private appliedRangeDecorationNames: readonly string[] = []
  private appliedInjectedTextRows: readonly InjectedTextRow[] = []
  private readonly lifecycleSummary = createEditorLifecycleSummary()
  /** The width a host named, which no document may contradict. */
  private configuredTabSize: number
  private readonly detectIndentation: boolean
  private readonly folding: boolean
  /** The width in effect: the host's when it named one, otherwise the loaded document's own. */
  private tabSize: number
  private tabMovesFocus: boolean
  private readonly announcer: EditorAnnouncer
  private operation: EditorOperation | null = null
  private operationFlushDepth = 0
  private readonly publishedBufferSnapshots = new WeakSet<TextSnapshot>()
  private readonly pendingBufferChangeOptions = new WeakMap<
    TextSnapshot,
    {
      readonly change: DocumentSessionChange
      readonly totalName: string
      readonly totalStart: number
      readonly options: SessionChangeOptions
    }
  >()
  private readonly jumpHistory = new JumpHistory()
  private pendingJump: {
    readonly session: DocumentSession
    readonly location: JumpLocation
  } | null = null
  private pendingPointerJump: {
    readonly session: DocumentSession
    readonly location: JumpLocation
  } | null = null
  private readonly cursorHistory = new CursorHistory()
  private cursorHistorySession: DocumentSession | null = null
  private cursorHistoryBefore: {
    readonly session: DocumentSession
    readonly entry: CursorHistoryEntry
  } | null = null
  private restoringCursorHistory = false
  private snapshotAppearanceObserver: MutationObserver | null = null
  private snapshotDocumentKey: string | null = null
  private lastSnapshot: string | null = null
  private snapshotGeneration: number | null = null
  private presentationReady = true
  private snapshotSettled = false
  private pendingDocumentScroll: EditorScrollPosition | null = null
  private preparingDocument = false
  private committingPresentation = false
  private disposed = false

  private get textSnapshot(): TextSnapshot {
    return this.document.textSnapshot
  }

  private get session(): DocumentSession | null {
    return this.document.session
  }

  private get sessionOptions(): EditorSessionOptions {
    return this.document.sessionOptions
  }

  private get documentId(): string | null {
    return this.document.documentId
  }

  private get documentMode(): EditorDocumentMode {
    return this.document.documentMode
  }

  private get editability(): EditorEditability {
    return this.document.editability
  }

  private get languageId(): EditorSyntaxLanguageId | null {
    return this.document.languageId
  }

  private get documentVersion(): number {
    return this.document.documentVersion
  }

  private get textVersion(): number {
    return this.document.textVersion
  }

  // Set once a parse has described a fold for this document, and never for a language whose grammar
  // ships no fold query. Cleared with the document rather than with the parse.
  private grammarDescribedFolds = false

  private get syntaxStatus(): EditorSyntaxStatus {
    return this.syntax.status
  }

  private get tokens(): EditorTokenStore {
    return this.syntax.tokens
  }

  private get brackets(): readonly BracketInfo[] {
    return this.syntax.brackets
  }

  constructor(container: HTMLElement, options: EditorOptions = {}) {
    const mountStart = nowMs()
    this.container = container
    this.options = options
    this.presentationReady = options.presentationReady !== false
    this.configuredTabSize = normalizeTabSize(options.tabSize)
    this.detectIndentation = options.detectIndentation ?? true
    this.folding = options.folding ?? true
    this.tabSize = this.configuredTabSize
    this.tabMovesFocus = options.tabMovesFocus ?? false
    // On the host's container rather than on the scrolling element: everything under that element is
    // layers the view mounts and measures, and what the editor has to say is none of the document.
    this.announcer = new EditorAnnouncer(container)
    this.configuredTheme = options.theme ?? null
    this.pluginHost = new EditorPluginHost(options.plugins)
    this.editorFeatures.set(
      EDITOR_SNIPPET_TOKENS_FEATURE,
      createSnippetTokensFeature(this.pluginHost),
    )
    this.editorFeatureTokensById.set(
      EDITOR_SNIPPET_TOKENS_FEATURE.id,
      EDITOR_SNIPPET_TOKENS_FEATURE,
    )
    // Into the same channel a plugin registers into, so what ships and what a host adds are asked
    // in one order rather than one of them being a fallback the other cannot get in front of.
    registerBuiltInPasteHandlers(this.languageFeatures)
    this.highlightPrefix = nextEditorHighlightPrefix()
    this.document = new EditorDocumentController({
      defaultDocumentMode: options.documentMode,
      defaultEditability: options.editability,
      highlightPrefix: this.highlightPrefix,
    })
    this.setGutterProjection(this.pluginHost.getGutterContributions())
    this.view = new VirtualizedTextView(container, {
      className: 'editor',
      highlightRegistry: getHighlightRegistry(),
      gutterContributions: this.composedGutterContributions(),
      cursorLineHighlight: options.cursorLineHighlight,
      hiddenCharacters: options.hiddenCharacters,
      fontSize: options.fontSize,
      fontFamily: options.fontFamily,
      lineHeight: options.lineHeight,
      rowGap: options.rowGap,
      rowPositioning: options.rowPositioning,
      scrollMode: options.scrollMode,
      tabSize: this.tabSize,
      textMetrics: options.textMetrics,
      inputRoute: options.inputRoute,
      inputLabel: options.inputLabel,
      inputKind: options.inputKind,
      scrollPastEnd: options.scrollPastEnd,
      onContentHeightChange: (height) => this.notifyContentHeight(height),
      wrap: options.wordWrap ?? false,
      wrapBreak: options.wordWrapBreak,
      onFoldToggle: this.handleFoldToggle,
      onViewportChange: this.handleViewportChange,
      onViewportScroll: this.handleViewportScroll,
      selectionHighlightName: `${this.highlightPrefix}-selection`,
    })
    this.foldState = new EditorFoldState(
      this.view,
      () => this.session?.getSnapshot() ?? null,
      () => this.foldCommandLocations().map((location) => location.row),
      (collapsedRegions) => {
        const session = editorBufferSession(this.session)
        if (!session || this.preparingDocument) return
        session.view.setFoldState({
          ...session.view.getFoldState(),
          collapsedRegions,
        })
      },
    )
    this.el = this.view.scrollElement
    this.view.setSuspiciousCharacters(
      normalizeSuspiciousCharactersOptions(options.suspiciousCharacters),
    )
    this.environmentRegistrations.add(
      observeBrowserTextMetricsInvalidation(this.el, () => this.remeasureTextMetrics()),
    )
    this.syntax = new EditorSyntaxController({
      pluginHost: this.pluginHost,
      getDocumentVersion: () => this.documentVersion,
      getDocumentId: () => this.documentId,
      getTextVersion: () => this.textVersion,
      getCurrentSessionDocumentId: () => this.currentSessionDocumentId(),
      getLanguageId: () => this.languageId,
      getSession: () => this.session,
      getDocumentEditChain: () => this.currentDocumentEditChain(),
      getVisibleSyntaxRange: () => this.visibleSyntaxRange(),
      adoptTokens: (tokens) => {
        this.view.adoptTokens(tokens)
        this.notifyViewContributions('tokens', null)
      },
      clearSyntaxFolds: () => this.clearSyntaxFolds(),
      setSyntaxFolds: (folds) => this.setSyntaxFolds(folds),
      setSyntaxCaptures: (captures) => this.setSyntaxCaptures(captures),
      needsSyntaxCaptures: () =>
        this.inlineReplacementProviders().some((source) => source.trigger === 'syntax'),
      notifyChange: (change) => this.notifyChange(change),
      notifyViewUpdate: () => this.notifyViewContributions('tokens', null),
      onInitialPaint: (event) => {
        if (event.phase === 'highlight-settled') {
          this.snapshotSettled = true
          this.lastSnapshot = null
        }
        const name =
          event.phase === 'text'
            ? 'editor.authoritative_text_paint'
            : 'editor.authoritative_highlight_paint'
        this.recordPresentation(name)
        this.options.onInitialPaint?.(event)
      },
      notifyThemeChanged: () => this.applyResolvedTheme(),
      log: (event) => this.logSyntaxLifecycleEvent(event),
    })
    this.fallbackFolds = new EditorFallbackFoldController({
      scheduler: this.secondaryWork,
      context: () => ({
        snapshot: this.textSnapshot,
        languageId: this.languageId,
        tabSize: this.tabSize,
        documentId: this.documentId,
        documentVersion: this.documentVersion,
        selection: this.syntax.fallbackFoldSelection,
        grammarProjectionSuppression:
          this.grammarDescribedFolds || this.syntaxFoldProjection().length > 0,
        active: this.session !== null && !this.disposed && this.folding,
      }),
      publish: (index) => this.foldState.setFoldProjections(this.foldProjections(index), index),
      changed: () => this.notifyViewContributions('layout', null),
      loggingEnabled: () => this.pluginHost.hasLoggers(),
      log: (fold) => this.log({ action: 'editor.folds.fallback', level: 'debug', fold }),
    })
    // Read per press rather than copied: outdent, backspace-through-indentation and the indentation
    // a line break copies all have to measure in the width the open document actually uses, and that
    // is only known once one has been loaded.
    const effectiveTabSize = (): number => this.tabSize
    const tabMovesFocus = (): boolean => this.tabMovesFocus
    this.inputSelection = new InputSelectionController({
      el: this.el,
      announcer: this.announcer,
      rtlMoveVisually: options.rtlMoveVisually ?? defaultRtlMoveVisually(detectPlatform()),
      nonCaretOffset: (offset) => this.isNonCaretOffset(offset),
      selectionSyncMode: normalizeEditorSelectionSyncMode(options.selectionSyncMode),
      autoClosingPairs: options.autoClosingPairs,
      surroundingPairs: options.surroundingPairs,
      get tabSize(): number {
        return effectiveTabSize()
      },
      // Read per press for the same reason as the width above: this one is toggled from a key, so a
      // copy taken here is the state at mount rather than the state the reader is in.
      get tabMovesFocus(): boolean {
        return tabMovesFocus()
      },
      view: this.view,
      getLanguageId: () => this.languageId,
      getSyntaxInjections: () => this.syntax.injections,
      getSession: () => this.session,
      getSessionOptions: () => this.sessionOptions,
      getPasteHandlers: () => this.languageFeatures.ordered(EDITOR_PASTE_HANDLER, this.languageId),
      getSyntaxTokens: () => this.syntax.copyTokens,
      getEditorTheme: () => this.resolvedTheme(),
      getTextSnapshot: () => this.getTextSnapshot(),
      canEditDocument: () => this.canEditDocument(),
      beginPointerJump: () => {
        this.cursorHistoryForSession()
        const location = this.captureJump()
        this.pendingPointerJump =
          location && this.session ? { session: this.session, location } : null
      },
      cancelPointerJump: () => {
        this.pendingPointerJump = null
      },
      finishPointerJump: () => {
        this.pendingJump = this.pendingPointerJump
        this.pendingPointerJump = null
        this.recordJumpHistory()
      },
      runInOperation: (run) => this.runInOperation(run),
      applySessionChange: (change, totalName, totalStart, options) =>
        this.applySessionChange(change, totalName, totalStart, options),
      onDidType: (text) => this.notifyTyped(text),
      claimPress: (event) => this.claimPress(event),
      notifyChangeWithTiming: (change) => this.notifyChangeWithTiming(change),
      notifyViewContributions: (kind, change) => this.notifyViewContributions(kind, change),
    })
    this.selectionRanges = new SelectionRangeStore({
      getSession: () => this.session,
      getLanguageId: () => this.languageId,
      getSyntaxFolds: () => this.syntaxFoldProjection(),
      getProviders: () => this.pluginHost.getSelectionRangeProviders(),
      setSelections: (selections, timingName, revealOffset) =>
        this.applyRequestedSelections(selections, timingName, revealOffset),
    })
    this.commandRouter = new EditorCommandRouter({
      history: (command, context) => this.inputSelection.applyHistoryCommand(command, context),
      cursorHistory: (command) => this.applyCursorHistory(command),
      jumpHistory: (command) => this.applyJumpHistory(command),
      delete: (direction, context) => this.inputSelection.applyDeleteCommand(direction, context),
      indent: (direction, context) => this.inputSelection.applyIndentCommand(direction, context),
      editAction: (command, context) =>
        this.inputSelection.applyEditActionCommand(command, context),
      fold: (command) => this.applyFoldCommand(command),
      inlineSuggest: (command, context) =>
        this.inputSelection.applyInlineSuggestCommand(command, context),
      selectAll: (context) => this.inputSelection.applySelectAllCommand(context),
      smartSelect: (direction) => this.selectionRanges.apply(direction),
      addNextOccurrence: (context) => this.inputSelection.applyAddNextOccurrenceCommand(context),
      clearSecondarySelections: (context) =>
        this.inputSelection.applyClearSecondarySelections(context),
      insertCursor: (direction, context) =>
        this.inputSelection.applyInsertCursorCommand(direction, context),
      selectExactOccurrences: (command, context) =>
        this.inputSelection.applySelectExactOccurrencesCommand(command, context),
      moveSelectionToNextOccurrence: (context) =>
        this.inputSelection.applyMoveSelectionToNextOccurrenceCommand(context),
      toggleWordWrap: () => {
        this.setWordWrap(!this.isWordWrapEnabled())
        return true
      },
      toggleTabFocusMode: () => {
        const moves = this.setTabMovesFocus(!this.isTabMovesFocusEnabled())
        // Said, not shown: the reader this key exists for is the one who cannot see an indicator
        // change, and the next press of Tab is about to do something other than what it did.
        this.announcer.alert(
          moves ? 'Tab moves focus out of the editor' : 'Tab inserts indentation',
        )
        return true
      },
      navigation: (command, context) =>
        this.inputSelection.applyNavigationCommand(command, context),
    })
    this.applyResolvedTheme()
    if (this.pluginHost.hasHighlighterProviders()) this.syntax.refreshHighlighterTheme()
    this.createInitialCommandContributions(this.pluginHost.getCommandContributionProviders())
    this.createInitialCapabilityContributions(this.pluginHost.getCapabilityContributionProviders())
    this.createInitialEditContributions(this.pluginHost.getEditContributionProviders())
    this.createInitialDecorationContributions(this.pluginHost.getDecorationContributionProviders())
    this.createInitialEditorFeatureContributions(
      this.pluginHost.getEditorFeatureContributionProviders(),
    )
    this.keymap = new EditorKeymapController({
      target: this.el,
      input: this.view.inputElement,
      captureContext: () => this.getKeymapContext(),
      keymap: options.keymap,
      dispatch: (command, context) => this.dispatchCommand(command, context),
    })
    this.view.onReservedOverlayWidthChange((side) => this.notifyReservedWidth(side))
    this.viewContributions = new EditorViewContributionController(
      this.createInitialViewContributions(this.pluginHost.getViewContributionProviders()),
      () => this.createViewSnapshot(),
      (_contribution, phase, error) => this.logContributionFailure('view', phase, error),
      () => {
        if (this.view.isProvisional || this.view.isRenderingAtomically) return false
        const session = editorBufferSession(this.session)
        return !session || this.textSnapshot === session.getTextSnapshot()
      },
      (contribution) => this.releaseClaimsOf(contribution, 'view'),
    )
    this.pluginHost.setEvents({
      onPluginInstalled: (name, durationMs) =>
        this.recordPluginLifecycle('installed', name, durationMs),
      onPluginInstallFailed: (name, error, durationMs) =>
        this.logPluginFailure('editor.plugin.install_failed', name, error, durationMs),
      onPluginActivated: (name, durationMs) =>
        this.recordPluginLifecycle('activated', name, durationMs),
      onPluginActivationFailed: (name, error, durationMs) =>
        this.logPluginFailure('editor.plugin.activation_failed', name, error, durationMs),
      onPluginUpdated: (name, durationMs) =>
        this.recordPluginLifecycle('updated', name, durationMs),
      onPluginUpdateFailed: (name, error, durationMs) =>
        this.logPluginFailure('editor.plugin.update_failed', name, error, durationMs),
      onPluginDeactivated: (name, durationMs) =>
        this.recordPluginLifecycle('deactivated', name, durationMs),
      onPluginDeactivateFailed: (name, error, durationMs) =>
        this.logPluginFailure('editor.plugin.deactivate_failed', name, error, durationMs),
      onPluginDisposed: (name) => this.recordPluginLifecycle('disposed', name),
      onPluginDisposeFailed: (name, error, durationMs) =>
        this.logPluginFailure('editor.plugin.dispose_failed', name, error, durationMs),
      onHighlighterProvidersChanged: () => this.syntax.reloadHighlighterAndSyntax(),
      onSyntaxProvidersChanged: () => this.syntax.reloadSyntaxSession(),
      onViewContributionProviderAdded: (provider) => this.addViewContributionProvider(provider),
      onViewContributionProviderRemoved: (provider) =>
        this.removeViewContributionProvider(provider),
      onCommandContributionProviderAdded: (provider) =>
        this.addCommandContributionProvider(provider),
      onCommandContributionProviderRemoved: (provider) =>
        this.removeCommandContributionProvider(provider),
      onCapabilityContributionProviderAdded: (provider) =>
        this.addCapabilityContributionProvider(provider),
      onCapabilityContributionProviderRemoved: (provider) =>
        this.removeCapabilityContributionProvider(provider),
      onEditContributionProviderAdded: (provider) => this.addEditContributionProvider(provider),
      onEditContributionProviderRemoved: (provider) =>
        this.removeEditContributionProvider(provider),
      onDecorationContributionProviderAdded: (provider) =>
        this.addDecorationContributionProvider(provider),
      onDecorationContributionProviderRemoved: (provider) =>
        this.removeDecorationContributionProvider(provider),
      onEditorFeatureContributionProviderAdded: (provider) =>
        this.addEditorFeatureContributionProvider(provider),
      onEditorFeatureContributionProviderRemoved: (provider) =>
        this.removeEditorFeatureContributionProvider(provider),
      onGutterContributionsChanged: () => this.syncGutterContributions(),
      onInjectedTextRowProvidersChanged: () => this.handleInjectedTextRowProvidersChanged(),
      onInlineReplacementProvidersChanged: () => this.handleInlineReplacementProvidersChanged(),
    })
    // After the host reports provider changes to this editor: an ambient plugin installed before
    // that would register its contributions into silence.
    this.ambientPlugins = new EditorAmbientPluginController(
      this.languageFeatures,
      this.pluginHost,
      (ambient, error) =>
        this.logPluginFailure('editor.plugin.install_failed', ambient.demand.id, error, 0),
    )
    this.inputSelection.install()
    this.setSnapshot(options.snapshot ?? null, options.documentKey ?? null)
    this.initializeDefaultText()
    this.setRangeDecorations(options.rangeDecorations ?? [])
    const mountDurationMs = nowMs() - mountStart
    recordEditorMountTiming(mountDurationMs)
    this.logInitialPlugins()
    this.recordEditorMounted(mountDurationMs)
  }

  getPresentationState(): 'provisional' | 'live' | 'empty' {
    if (this.view.isProvisional) return 'provisional'
    return this.session ? 'live' : 'empty'
  }

  setPresentationReady(ready: boolean): void {
    this.presentationReady = ready
    if (ready) this.commitSnapshotIfReady()
  }

  setSnapshot(snapshot: string | null, documentKey: string | null): void {
    if (this.disposed) return
    const changedTarget = documentKey !== this.snapshotDocumentKey
    if (changedTarget) {
      this.withdrawSnapshot()
      this.snapshotDocumentKey = documentKey
      this.snapshotSettled = false
      this.lastSnapshot = null
    }
    if (snapshot === this.lastSnapshot) return
    if (snapshot === null) {
      this.lastSnapshot = null
      this.withdrawSnapshot()
      return
    }
    if (
      this.snapshotSettled ||
      (this.session && this.syntax.renderDataReady && this.presentationReady)
    ) {
      this.recordSnapshotAdmission('generation-live')
      return
    }
    this.lastSnapshot = snapshot
    const paint = decodePaintSnapshot(snapshot)
    if (!paint) {
      this.recordSnapshotAdmission('invalid-paint')
      return
    }
    this.view.measureInitialViewport()
    const appearance = this.paintAppearance()
    if (paint.appearance !== appearance) {
      // The appearance strings hold font and theme settings: the log names what differs, and
      // only the performance mark keeps the values.
      this.recordSnapshotAdmission(
        'appearance',
        { differs: appearanceDifference(paint.appearance, appearance) },
        { savedAppearance: paint.appearance, appearance },
      )
      return
    }
    // The outer box, not the viewport: an empty editor has no scrollbar yet, so its viewport is
    // wider than the one the paint was saved under, by exactly the scrollbar.
    const state = this.view.getState()
    if (
      Math.abs(paint.boxWidth - state.borderBoxWidth) > 1 ||
      Math.abs(paint.boxHeight - state.borderBoxHeight) > 1
    ) {
      this.recordSnapshotAdmission('viewport', {
        savedWidth: paint.boxWidth,
        savedHeight: paint.boxHeight,
        width: state.borderBoxWidth,
        height: state.borderBoxHeight,
      })
      return
    }
    this.snapshotGeneration = this.session ? this.documentVersion : null
    if (!this.view.restorePaint(paint)) {
      this.recordSnapshotAdmission('gutter-paint')
      return
    }
    this.syncViewEditability()
    this.options.onPresentationChange?.('provisional')
    this.observeSnapshotAppearance()
    this.recordSnapshotAdmission('admitted')
    this.recordPresentation('editor.cached_visible_paint')
  }

  captureSnapshot() {
    if (this.disposed || !this.session || this.view.isProvisional || this.preparingDocument)
      return null
    if (!this.syntax.renderDataReady || !this.presentationReady) return null
    const appearance = this.paintAppearance('refuse')
    if (appearance === null) return null
    const snapshot = this.viewContributions.captureSnapshot().toVisibleSnapshot()
    if (!snapshot || snapshot.viewport.clientWidth <= 0 || snapshot.viewport.clientHeight <= 0)
      return null
    if (snapshot.documentId !== this.documentId || snapshot.textVersion !== this.textVersion)
      return null
    const gutters = this.view.captureGutterPaint()
    if (!gutters) return null
    const json = snapshot.toJSON()
    const visible = json.rows.flatMap((row, index) =>
      row.top + row.height > json.viewport.scrollTop &&
      row.top < json.viewport.scrollTop + json.viewport.clientHeight
        ? [index]
        : [],
    )
    const backgrounds = this.view.captureRowBackgrounds()
    const paint = encodePaintSnapshot(
      {
        ...json,
        rows: visible.map((index) => json.rows[index]!),
        paintLayers: [...json.paintLayers, this.view.captureSelectionPaint()],
      },
      appearance,
      visible.map((index) => gutters[index]!),
      {
        left: this.view.reservedOverlayWidth('left'),
        right: this.view.reservedOverlayWidth('right'),
      },
      visible.map((index) => backgrounds[index]!),
    )
    if (!paint) return null
    const buffer = editorBufferSession(this.session)?.buffer ?? null
    return {
      paint,
      documentKey: this.snapshotDocumentKey,
      documentId: this.documentId,
      textVersion: this.textVersion,
      buffer,
      bufferRevision: buffer?.getRevision() ?? null,
    }
  }

  // A pending face blocks capture, which would save fallback geometry. It must not block showing
  // a paint: the saved one was taken under the loaded face, the very thing still arriving.
  private paintAppearance(pendingFonts: 'refuse' | 'allow' = 'allow'): string | null {
    const window = this.el.ownerDocument.defaultView
    if (!window) return null
    const fonts = this.el.ownerDocument.fonts
    if (pendingFonts === 'refuse' && fonts && fonts.status !== 'loaded') return null
    const style = window.getComputedStyle(this.el)
    const state = this.view.getState()
    const layers = this.viewContributions.paintConfiguration()
    if (layers === null) return null
    return JSON.stringify({
      font: [
        style.fontFamily,
        style.fontSize,
        style.fontWeight,
        style.fontStyle,
        style.letterSpacing,
        style.fontFeatureSettings,
        style.fontVariationSettings,
        style.lineHeight,
        style.zoom,
        style.color,
        style.backgroundColor,
      ],
      devicePixelRatio: window.devicePixelRatio,
      // Merged from three sources, so key order depends on which arrived first; values decide.
      theme: withSortedKeys(this.resolvedTheme()),
      // Row height only. With the font stack equal, a different cell width means a face is still
      // loading, and that must not veto the paint the loaded face is about to match.
      rowHeight: state.metrics.rowHeight,
      wrap: state.wrapActive,
      tabSize: state.tabSize,
      native: this.view.paintConfiguration(),
      gutters: this.composedGutterContributions().map((contribution) => [
        contribution.id,
        contribution.snapshotRenderer?.key,
      ]),
      layers,
    })
  }

  private withdrawSnapshot(): void {
    this.disconnectSnapshotAppearanceObserver()
    this.lastSnapshot = null
    this.snapshotGeneration = null
    this.pendingDocumentScroll = null
    if (!this.view.isProvisional) return
    this.snapshotSettled = true
    this.view.commitProvisionalPaint()
    this.syncViewEditability()
    if (this.session) this.viewContributions.notify('document', null)
    if (this.session) this.syntax.notifyBaseTextPainted()
    this.options.onPresentationChange?.(this.getPresentationState())
  }

  private commitSnapshotIfReady(): boolean {
    if (!this.view.isProvisional || this.preparingDocument || this.committingPresentation)
      return false
    if (this.snapshotGeneration !== this.documentVersion || !this.session) return false
    if (!this.syntax.renderDataReady || !this.presentationReady) return false
    this.committingPresentation = true
    const saved = this.view.savedPaint
    const pendingReveal = this.view.hasPendingReveal
    try {
      this.flushFallbackFoldProjection()
      this.disconnectSnapshotAppearanceObserver()
      this.view.commitProvisionalPaint()
      if (this.pendingDocumentScroll && !pendingReveal)
        this.applyScrollPosition(this.pendingDocumentScroll)
      this.pendingDocumentScroll = null
      this.inputSelection.syncDomSelection()
      this.viewContributions.notify('document', null)
      this.viewContributions.finishRestoration()
      this.snapshotGeneration = null
      this.lastSnapshot = null
      this.snapshotSettled = true
      this.syncViewEditability()
      this.syntax.notifyBaseTextPainted()
      this.options.onPresentationChange?.('live')
      return true
    } catch (error) {
      this.snapshotGeneration = null
      this.snapshotSettled = true
      if (saved && this.view.restorePaint(saved)) this.observeSnapshotAppearance()
      this.syncViewEditability()
      this.el.dataset.editorPresentationError = 'authoritative-commit'
      this.log({
        action: 'editor.presentation.commit_failed',
        level: 'error',
        error: {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      })
      return false
    } finally {
      this.committingPresentation = false
    }
  }

  private observeSnapshotAppearance(): void {
    this.disconnectSnapshotAppearanceObserver()
    const Observer = this.el.ownerDocument.defaultView?.MutationObserver
    if (!Observer) return
    const observer = new Observer(() => {
      if (this.invalidateIncompatibleSnapshot()) this.remeasureTextMetrics()
    })
    for (let element: HTMLElement | null = this.el; element; element = element.parentElement) {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
    }
    this.snapshotAppearanceObserver = observer
  }

  private disconnectSnapshotAppearanceObserver(): void {
    this.snapshotAppearanceObserver?.disconnect()
    this.snapshotAppearanceObserver = null
  }

  private invalidateIncompatibleSnapshot(): boolean {
    const paint = this.view.savedPaint
    if (!paint || this.preparingDocument || this.committingPresentation) return false
    const state = this.view.getState()
    const matches =
      Math.abs(state.borderBoxWidth - paint.boxWidth) <= 1 &&
      Math.abs(state.borderBoxHeight - paint.boxHeight) <= 1 &&
      this.paintAppearance() === paint.appearance
    if (matches) return false
    this.withdrawSnapshot()
    return true
  }

  private recordSnapshotAdmission(
    reason: string,
    fields: Readonly<Record<string, unknown>> = {},
    markOnly: Readonly<Record<string, unknown>> = {},
  ): void {
    const detail = {
      reason,
      documentKey: this.snapshotDocumentKey,
      documentId: this.documentId,
      generation: this.documentVersion,
      hasSession: this.session !== null,
      ...fields,
    }
    // Once per offered snapshot, so info: a rejected one is otherwise invisible after the fact.
    this.log({
      action: 'editor.snapshot.admission',
      level: 'info',
      snapshot: detail,
    })
    recordEditorPerformanceDiagnostic('editor.snapshot.admission', detail)
    this.el.ownerDocument.defaultView?.performance.mark('editor.snapshot.admission', {
      detail: { ...detail, ...markOnly },
    })
  }

  private recordPresentation(name: string): void {
    const detail = {
      documentKey: this.snapshotDocumentKey,
      documentId: this.documentId,
      documentGeneration: this.documentVersion,
      textVersion: this.textVersion,
    }
    recordEditorPerformanceDiagnostic(name, detail)
    this.el.ownerDocument.defaultView?.performance.mark(name, { detail })
  }

  /** On a buffer session this replaces the buffer's text as one undoable edit every view sees. */
  setContent(text: string): void {
    const session = editorBufferSession(this.session)
    if (!session) {
      this.renderContent(text)
      return
    }
    const to = session.getSnapshot().length
    this.editBufferSession(session, 'setContent', [{ from: 0, to, text }], null)
  }

  private renderContent(
    text: string | TextSnapshot,
    tokens: EditorTokenStore = EditorTokenStore.empty(),
  ): void {
    const savedFolds = editorBufferSession(this.session)?.view.getFoldState()
    this.fallbackFolds.reset()
    this.view.measureInitialViewport()
    const textSnapshot = typeof text === 'string' ? createStringTextSnapshot(text) : text
    this.document.setRenderedTextSnapshot(textSnapshot)
    this.recordDetachedTextChange(null)
    // One render, or the view paints the new text under the outgoing document's tokens first.
    this.view.runAtomicRender(() => {
      this.view.setText(textSnapshot)
      this.retagDisplayProjectionSources()
      this.syncInjectedTextRows()
      this.adoptTokens(tokens)
    })
    this.dropManualFolds()
    this.clearSyntaxFolds()
    this.restoreViewFolds(savedFolds)
    this.applyRangeDecorations()
    this.notifyViewContributions('content', null)
    this.recordContentSet()
  }

  setTokens(tokens: EditorTokenInput): void {
    this.adoptTokens(toEditorTokenStore(tokens))
  }

  /**
   * `textSnapshot` is the text after `edit`; a detached view renders it. On a buffer session the edit
   * goes through the session, which supplies its own.
   */
  applyEdit(edit: TextEdit, tokens: EditorTokenInput, textSnapshot: TextSnapshot): void {
    const session = editorBufferSession(this.session)
    if (!session) {
      this.renderEdit(edit, toEditorTokenStore(tokens), textSnapshot)
      return
    }
    this.editBufferSession(session, 'applyEdit', [edit], toEditorTokenStore(tokens))
  }

  private editBufferSession(
    session: EditorBufferSession,
    operation: string,
    edits: readonly TextEdit[],
    tokens: EditorTokenStore | null,
  ): void {
    const lease = getDocumentMutationLeaseState(session.buffer)
    if (lease.isLeased) {
      throw createError({
        code: 'EDITOR_BUFFER_LEASED',
        status: 409,
        message: `${operation} cannot edit the buffer while another writer holds its lease`,
        why: 'A leased buffer refuses every edit until the lease is released.',
        fix: 'Wait for the lease holder to release the buffer, then edit again.',
        internal: { operation, sessionKind: 'buffer', leaseOwner: lease.ownerId },
      })
    }
    // The same gate edit() applies, so a read-only or still-provisional view cannot write the buffer.
    if (this.view.isProvisional || !this.document.canEditDocument()) {
      throw createError({
        code: 'EDITOR_NOT_EDITABLE',
        status: 409,
        message: `${operation} cannot edit the buffer through an editor that is not editable`,
        why: 'The editor is read-only, or is still showing saved paint in place of its document.',
        fix: 'Make the editor editable, or wait until it has finished opening the document.',
        internal: {
          operation,
          provisional: this.view.isProvisional,
          editability: this.document.editability,
          documentMode: this.document.documentMode,
        },
      })
    }
    // Tokens are adopted inside the edit's operation: its listeners run when it ends, and one of
    // them may open another document that these tokens do not describe.
    this.runInOperation(() => {
      const change = session.applyEdits(edits)
      if (change.kind !== 'none') this.applySessionChange(change, `editor.${operation}`, nowMs())
      if (tokens) this.adoptTokens(tokens)
    })
  }

  private renderEdit(
    edit: TextEdit,
    tokens: EditorTokenStore,
    nextTextSnapshot: TextSnapshot,
    currentTokens = true,
  ): void {
    this.view.runAtomicRender(() => {
      const batch = createTextEditBatch(this.textSnapshot, nextTextSnapshot, [edit])
      this.document.setRenderedTextSnapshot(nextTextSnapshot)
      this.recordDetachedTextChange([edit])
      this.retagDisplayProjectionSources()
      measureEditorPerformance('editor.view.applyEdit', () =>
        this.view.applyEdit(edit, nextTextSnapshot, () => this.fallbackFolds.update(batch)),
      )
      this.syncInjectedTextRows()
      measureEditorPerformance(
        'editor.tokens.adoptProjected',
        () => this.adoptTokens(tokens, currentTokens),
        () => ({
          tokenCount: tokens.length,
        }),
      )
    })
  }

  private adoptTokens(tokens: EditorTokenStore, current = true): void {
    this.syntax.setTokens(tokens, current)
  }

  setDocument(document: EditorDocument): void {
    if (editorBufferSession(this.session)) {
      throw createError({
        code: 'EDITOR_SET_DOCUMENT_ON_BUFFER_SESSION',
        status: 409,
        message:
          'setDocument cannot replace the document of an editor attached to a buffer session',
        why: 'The attached buffer owns the text and every view of it, so this editor cannot swap it alone.',
        fix: 'Call openDocument to give this editor its own document, or edit the buffer through its session.',
        internal: { operation: 'setDocument', sessionKind: 'buffer' },
      })
    }
    this.renderDocument(document)
  }

  private renderDocument(document: EditorDocument): void {
    this.renderContent(document.text, toEditorTokenStore(document.tokens ?? []))
  }

  /** Turns soft wrap on or off. Returns the state actually in effect afterwards. */
  setWordWrap(enabled: boolean): boolean {
    this.view.setWrapEnabled(enabled)
    return this.isWordWrapEnabled()
  }

  isWordWrapEnabled(): boolean {
    return this.view.isWrapEnabled()
  }

  /**
   * Gives Tab back to the page, or takes it for indentation again. Returns the state in effect
   * afterwards. Nothing is announced from here: a host writing its own controls says what it did in
   * its own words, and the key that toggles this from inside the editor speaks for itself.
   */
  setTabMovesFocus(enabled: boolean): boolean {
    this.tabMovesFocus = enabled
    return this.tabMovesFocus
  }

  getInputElement(): HTMLElement {
    return this.view.inputElement
  }

  getKeymapContext(): EditorKeymapContext {
    return {
      ...this.contributedKeymapContext(),
      writable: this.canEditDocument(),
      hasSelection: this.inputSelection
        .resolveViewSelections()
        .some((selection) => selection.startOffset !== selection.endOffset),
      tabFocusMode: this.tabMovesFocus,
      inlineSuggestionVisible: this.inputSelection.inlineSuggestionSpecs().length > 0,
    }
  }

  /** A key is true while any of the contributions that registered it says so. */
  private contributedKeymapContext(): Record<string, boolean> {
    const context: Record<string, boolean> = {}
    for (const [key, readers] of this.keymapContextKeys) context[key] = anyReaderHolds(readers)
    return context
  }

  private readonly keymapContextKeys = new Map<string, Set<() => boolean>>()

  private registerKeymapContextKey(key: string, read: () => boolean): EditorDisposable {
    const readers = this.keymapContextKeys.get(key) ?? new Set()
    readers.add(read)
    this.keymapContextKeys.set(key, readers)
    return this.claimForContribution(
      disposableOnce(() => {
        readers.delete(read)
        if (readers.size === 0) this.keymapContextKeys.delete(key)
      }),
    )
  }

  isTabMovesFocusEnabled(): boolean {
    return this.tabMovesFocus
  }

  setFoldMap(foldMap: FoldMap | null): void {
    this.view.setFoldMap(foldMap)
  }

  /**
   * Installs the inline replacements this document renders instead of parts of its own text — the
   * entry point a markdown live-preview view drives. Passing null restores raw buffer text.
   */
  setInlineMap(inlineMap: InlineMap | null): void {
    this.view.setInlineMap(inlineMap)
  }

  /**
   * Registers a provider that turns the document's syntax captures into inline replacements. The map
   * is rebuilt whenever fresh captures land, so a markdown view stays in step with the parse without
   * the host scheduling anything itself. Passing null removes the transform.
   */
  setInlineReplacementProvider(
    provider: EditorInlineReplacementProvider | null,
    options: EditorInlineReplacementProviderOptions = {},
  ): void {
    this.inlineReplacementProvider = provider
      ? { provide: provider, trigger: options.trigger ?? 'syntax' }
      : null
    this.handleInlineReplacementProvidersChanged()
  }

  /**
   * The first provider turns raw captures on, and the last one to go turns them off again. The
   * reparse is what hands a provider the captures its map is derived from, so it has to come first.
   */
  private handleInlineReplacementProvidersChanged(): void {
    this.syntax.syncCaptureRequirement()
    this.refreshInlineMap('rerun')
  }

  private setSyntaxCaptures(captures: readonly EditorSyntaxCapture[]): void {
    this.syntaxCaptures = captures
    this.refreshInlineMap('rerun')
  }

  /**
   * Offers an inline suggestion, drawn in front of the reader as the part of it the document does
   * not already hold. Passing null takes back whatever is showing.
   */
  setInlineSuggestion(edit: TextEdit | null): boolean {
    const shown = this.inputSelection.setInlineSuggestion(edit)
    this.refreshInlineMap()
    return shown
  }

  /**
   * Syntax-triggered providers read captures, which describe the text of the last parse: they run
   * only when captures land or providers change (`'rerun'`), and between parses their map is carried
   * to the current text by its anchors (`'carry'`). A new document drops it (`'drop'`). Edit-triggered
   * providers run every time.
   */
  private refreshInlineMap(syntax: 'rerun' | 'carry' | 'drop' = 'carry'): void {
    const snapshot = this.session?.getSnapshot()
    if (!snapshot) {
      this.syntaxInlineMap = null
      this.view.setInlineMap(null)
      return
    }

    const providers = this.inlineReplacementProviders()
    const context = this.inlineReplacementContext()
    if (syntax === 'drop') this.syntaxInlineMap = null
    if (syntax === 'rerun') this.syntaxInlineMap = this.syntaxDerivedInlineMap(providers, context)
    const carried = this.syntaxInlineMap
      ? inlineSpecsAtSnapshot(this.syntaxInlineMap, snapshot)
      : []
    const derived = providers
      .filter((source) => source.trigger === 'edit')
      .flatMap((source) => source.provide(context))
    // The suggestion joins the same map rather than one of its own: a document rendering itself
    // through replacements is still that document, and ghost text has to take its columns from what
    // is on screen rather than from text the reader cannot see.
    const specs = [...carried, ...derived, ...this.inputSelection.inlineSuggestionSpecs()]
    this.view.setInlineMap(specs.length === 0 ? null : createInlineMap(snapshot, specs))
  }

  private syntaxDerivedInlineMap(
    providers: readonly EditorInlineReplacementSource[],
    context: EditorInlineReplacementContext,
  ): InlineMap | null {
    const snapshot = this.session?.getSnapshot()
    const specs = providers
      .filter((source) => source.trigger === 'syntax')
      .flatMap((source) => source.provide(context))
    return snapshot && specs.length > 0 ? createInlineMap(snapshot, specs) : null
  }

  private inlineReplacementContext(): EditorInlineReplacementContext {
    return {
      textSnapshot: this.getTextSnapshot(),
      languageId: this.languageId,
      captures: this.syntaxCaptures,
      selections: this.inputSelection.resolveViewSelections(),
    }
  }

  private editRederivesInlineMap(changes: readonly unknown[]): boolean {
    if (changes.length === 0) return false
    return this.inlineReplacementProviders().some((source) => source.trigger === 'edit')
  }

  private inlineReplacementProviders(): readonly EditorInlineReplacementSource[] {
    const registered = this.pluginHost.getInlineReplacementProviders()
    const direct = this.inlineReplacementProvider
    if (!direct) return registered
    return [direct, ...registered]
  }

  setSyntaxFolds(folds: readonly FoldRange[]): void {
    this.runInOperation(() => {
      if (folds.length > 0) this.grammarDescribedFolds = true
      this.setSyntaxFoldProjection(folds)
      this.scheduleFallbackFoldProjection()
    })
  }

  toggleFold(offset?: number): boolean {
    return this.applyFoldOperation('toggle', offset)
  }

  fold(offset?: number): boolean {
    return this.applyFoldOperation('fold', offset)
  }

  unfold(offset?: number): boolean {
    return this.applyFoldOperation('unfold', offset)
  }

  foldAll(): boolean {
    if (!this.session) return false

    this.flushFallbackFoldProjection()
    const changed = this.foldState.foldAll()
    if (changed) {
      this.announcer.status(`Folded all, ${this.foldState.collapsedFoldCount} regions collapsed`)
      this.notifyViewContributions('layout', null)
      this.log({
        action: 'editor.fold.all',
        level: 'info',
        fold: { collapsedCount: this.foldState.collapsedFoldCount },
      })
    }
    return changed
  }

  unfoldAll(): boolean {
    if (!this.session) return false

    const changed = this.foldState.unfoldAll()
    if (changed) {
      this.announcer.status('Unfolded all')
      this.notifyViewContributions('layout', null)
      this.log({
        action: 'editor.unfold.all',
        level: 'info',
        fold: { collapsedCount: this.foldState.collapsedFoldCount },
      })
    }
    return changed
  }

  setText(text: string, options: EditorSetTextOptions = {}): void {
    this.runInOperation(() => {
      const currentScrollPosition = this.getScrollPosition()
      const documentVersion = this.resetOwnedDocument(
        {
          text,
          documentMode: options.documentMode ?? this.documentMode,
          languageId: options.languageId,
          tokens: options.tokens,
        },
        {
          documentId: null,
          persistentIdentity: false,
          scrollPosition: preservedScrollPosition(currentScrollPosition, options.scrollPosition),
        },
      )
      this.notifyChange(null)
      this.refreshSyntax(documentVersion, null)
      this.lifecycleSummary.document.setTextCount += 1
    })
  }

  syncText(text: string, options: EditorSetTextOptions = {}): void {
    this.runInOperation(() => {
      const documentMode = normalizeEditorDocumentMode(options.documentMode ?? this.documentMode)
      const languageId = options.languageId ?? null
      if (!this.session || documentMode !== this.documentMode || languageId !== this.languageId) {
        this.setText(text, options)
        return
      }
      const tokens = options.tokens
      if (tokens === undefined) {
        this.syncSessionText(text, options)
        return
      }
      // One render: the edit alone would paint the old tokens projected through it first.
      this.view.runAtomicRender(() => {
        this.syncSessionText(text, options)
        this.setTokens(tokens)
      })
    })
  }

  private syncSessionText(text: string, options: EditorSetTextOptions): void {
    if (!this.session) return

    const edit = syncTextEdit(this.session.getTextSnapshot(), text)
    if (edit.from === edit.to && edit.text.length === 0) return

    const scrollPosition = preservedScrollPosition(this.getScrollPosition(), options.scrollPosition)
    const change = this.session.applyEdits([edit], {
      history: 'skip',
    })
    if (change.kind === 'none') return

    this.applySessionChange(change, 'editor.syncText', nowMs(), {
      syncDomSelection: false,
    })
    this.applyDocumentScrollPosition(scrollPosition)
    this.lifecycleSummary.document.syncedTextCount += 1
  }

  /**
   * Runs `run` as a single mutating pass. Whatever it changes, the caret is
   * revealed once, the DOM selection is written back once and listeners hear
   * once, at the end — so a sequence of edits costs one visual update instead of
   * one each. Calls made from inside a pass join it rather than opening another.
   */
  runInOperation<T>(run: () => T): T {
    const scope = beginEditorPerformanceBatch()
    try {
      return this.withOperation(() => run())
    } finally {
      endEditorPerformanceInput(scope)
    }
  }

  edit(editOrEdits: EditorEditInput, options: EditorEditOptions = {}): void {
    this.runInOperation(() => {
      if (!this.canEditDocument()) return

      this.ensureAnonymousSession()
      if (!this.session) return

      const edits = normalizeEditorEditInput(editOrEdits)
      const change = this.session.applyEdits(edits, options)
      if (change.kind === 'none') return

      this.applySessionChange(change, 'editor.edit', nowMs())
    })
  }

  openDocument(document: EditorOpenDocumentOptions): void {
    this.runDocumentReplacement(() => {
      // Content loads can resolve after teardown (e.g. a StrictMode-unmounted
      // editor whose file fetch lands later). Opening then would start a syntax
      // session nothing ever disposes, leaking a parse tree in the worker.
      if (this.disposed) return

      this.detachedEditChain.rotate()
      const documentVersion = this.resetOwnedDocument(document, {
        documentId: document.documentId ?? null,
        persistentIdentity: true,
        scrollPosition: document.scrollPosition,
      })
      this.notifyChange(null)
      this.refreshSyntax(documentVersion, null)
      this.lifecycleSummary.document.openedCount += 1
    })
  }

  private ensureAnonymousSession(): void {
    if (this.session) return

    this.resetOwnedDocument(
      { text: '', languageId: null },
      {
        documentId: null,
        persistentIdentity: false,
        scrollPosition: DOCUMENT_START_SCROLL_POSITION,
      },
    )
  }

  clearDocument(): void {
    this.clear()
    this.notifyChange(null)
  }

  /** Every selection as document offsets, primary first. */
  getSelections(): readonly EditorResolvedSelection[] {
    return this.inputSelection.resolveViewSelections()
  }

  getState(): EditorState {
    const snapshot = this.session?.getSnapshot()
    const length = snapshot?.length ?? this.textSnapshot.length
    const selection = this.session?.getSelections().selections[0]
    const resolved = snapshot && selection ? resolveSelection(snapshot, selection) : null
    const point = snapshot ? offsetToPoint(snapshot, resolved?.headOffset ?? length) : null

    return {
      documentId: this.documentId,
      documentMode: this.documentMode,
      editability: this.editability,
      languageId: this.languageId,
      syntaxStatus: this.syntaxStatus,
      initialHighlightStatus: this.syntax.initialHighlightStatus,
      cursor: {
        row: point?.row ?? 0,
        column: point?.column ?? 0,
      },
      length,
      canUndo: this.session?.canUndo() ?? false,
      canRedo: this.session?.canRedo() ?? false,
      isDirty: this.session?.isDirty() ?? false,
    }
  }

  /** O(document length) on every call, never cached; save and export are what it is for. */
  materializeFullText(): string {
    return this.getTextSnapshot().materializeFullText()
  }

  // The buffer behind the open document, when the document is backed by one. Hosts
  // that want history browsing or checkout talk to the buffer, not the editor.
  getBufferSession(): EditorBufferSession | null {
    return editorBufferSession(this.session)
  }

  getTextSnapshot(): TextSnapshot {
    return this.session?.getTextSnapshot() ?? this.textSnapshot
  }

  getMergeConflicts(): readonly MergeConflictRegion[] {
    return parseMergeConflicts(this.getTextSnapshot())
  }

  resolveMergeConflict(index: number, resolution: MergeConflictResolution): boolean {
    if (!this.canEditDocument()) return false

    const source = this.getTextSnapshot()
    const conflict = parseMergeConflicts(source)[index]
    if (!conflict) return false

    const resolved = resolveMergeConflictText(source, conflict, resolution)
    if (!resolved) return false

    this.edit(
      {
        from: resolved.range.start,
        to: resolved.range.end,
        text: resolved.replacement,
      },
      {
        selection: {
          anchor: resolved.selection.start,
          head: resolved.selection.end,
        },
      },
    )
    return true
  }

  revealMergeConflict(index: number): boolean {
    const conflict = parseMergeConflicts(this.getTextSnapshot())[index]
    if (!conflict) return false

    this.setSelection(conflict.range.start)
    return true
  }

  focus(): void {
    this.view.focusInput()
  }

  setSelection(anchor: number, head = anchor, options?: EditorSetSelectionOptions): void {
    this.runInOperation(() => {
      this.applyRequestedSelection(anchor, head, 'editor.setSelection', options, true)
    })
  }

  jumpTo(anchor: number, head = anchor, cause: JumpCause = 'provider'): void {
    this.setSelection(anchor, head, { jumpCause: cause, reveal: true })
  }

  jumpBack(): boolean {
    return this.applyJumpHistory('back')
  }

  jumpForward(): boolean {
    return this.applyJumpHistory('forward')
  }

  openFind(): boolean {
    return this.findFeature()?.openFind() ?? false
  }

  openFindReplace(): boolean {
    return this.findFeature()?.openFindReplace() ?? false
  }

  closeFind(): boolean {
    return this.findFeature()?.closeFind() ?? false
  }

  findNext(): boolean {
    return this.findFeature()?.findNext() ?? false
  }

  findPrevious(): boolean {
    return this.findFeature()?.findPrevious() ?? false
  }

  replaceOne(): boolean {
    return this.findFeature()?.replaceOne() ?? false
  }

  replaceAll(): boolean {
    return this.findFeature()?.replaceAll() ?? false
  }

  selectAllMatches(): boolean {
    return this.findFeature()?.selectAllMatches() ?? false
  }

  /** Returns the carets, and the view, to where they were before the last caret move. */
  cursorUndo(): boolean {
    return this.applyCursorHistory('undo')
  }

  cursorRedo(): boolean {
    return this.applyCursorHistory('redo')
  }

  /**
   * Called with the position after it changes, from a gesture, a programmatic move or a clamp. The
   * virtualizer has already folded the scroll in, so the position is current, and nothing throttles it.
   */
  onDidScroll(listener: (position: Required<EditorScrollPosition>) => void): EditorDisposable {
    this.scrollListeners.add(listener)
    return disposableOnce(() => this.scrollListeners.delete(listener))
  }

  /**
   * Called with the rows' total height in pixels whenever it changes: lines added or removed, wrap
   * reflowing, the font changing. A host that grows with its text sizes itself from this.
   */
  onDidChangeContentHeight(listener: (height: number) => void): EditorDisposable {
    this.contentHeightListeners.add(listener)
    return disposableOnce(() => this.contentHeightListeners.delete(listener))
  }

  getContentHeight(): number {
    return this.view.getContentHeight()
  }

  private notifyContentHeight(height: number): void {
    for (const listener of this.contentHeightListeners) listener(height)
  }

  getScrollPosition(): Required<EditorScrollPosition> {
    const provisional = this.view.provisionalScrollPosition
    if (provisional) return provisional
    const viewState = this.view.getState()
    return {
      top: viewState.scrollTop,
      left: viewState.scrollLeft,
    }
  }

  setScrollPosition(scrollPosition: EditorScrollPosition): void {
    this.applyScrollPosition(scrollPosition)
  }

  setTheme(theme: EditorTheme | null | undefined): void {
    const nextTheme = theme ?? null
    if (editorThemesEqual(this.configuredTheme, nextTheme)) return

    const replacementGeneration = this.syntax.beginThemeReplacement()
    this.configuredTheme = nextTheme
    this.applyResolvedTheme()
    const notified = this.syntax.completeThemeReplacement(replacementGeneration)
    if (!notified) this.notifyViewContributions('tokens', null)
    this.log({
      action: 'editor.theme.changed',
      level: 'info',
      theme: { configured: nextTheme !== null },
    })
  }

  setHiddenCharacters(mode: HiddenCharactersMode): void {
    this.view.setHiddenCharacters(mode)
    this.log({
      action: 'editor.rendering.hidden_characters_changed',
      level: 'info',
      rendering: { hiddenCharacters: mode },
    })
  }

  setSuspiciousCharacters(options: EditorOptions['suspiciousCharacters']): void {
    if (!this.view.setSuspiciousCharacters(normalizeSuspiciousCharactersOptions(options))) return

    this.log({
      action: 'editor.rendering.suspicious_characters_changed',
      level: 'info',
      rendering: { suspiciousCharacters: options ?? null },
    })
  }

  setKeymap(keymap: EditorOptions['keymap']): void {
    if (!this.keymap.setKeymap(keymap)) return

    this.log({
      action: 'editor.keymap.changed',
      level: 'info',
      keymap: { configured: Boolean(keymap) },
    })
  }

  setEditability(editability: EditorEditability): void {
    if (!this.document.setEditability(editability)) return

    this.syncViewEditability()
    this.notifyChange(null)
    this.log({
      action: 'editor.editability.changed',
      level: 'info',
      editability,
    })
  }

  setRangeDecorations(decorations: readonly EditorRangeDecoration[]): void {
    if (sameEditorRangeDecorations(this.directRangeDecorations(), decorations)) return

    this.runInOperation(() => {
      this.displayProjections.set({
        kind: 'rangeDecorations',
        owner: DIRECT_RANGE_DECORATION_OWNER,
        source: this.currentDisplayProjectionSource(),
        invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
        layer: 0,
        priority: 0,
        disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
        value: [...decorations],
      })
      this.applyRangeDecorations()
      this.log({
        action: 'editor.decorations.range.changed',
        level: 'info',
        decorations: { count: decorations.length },
      })
    })
  }

  setRowDecorations(decorations: ReadonlyMap<number, VirtualizedTextRowDecoration>): void {
    this.runInOperation(() => {
      this.displayProjections.set({
        kind: 'rowDecorations',
        owner: DIRECT_ROW_DECORATION_OWNER,
        source: this.currentDisplayProjectionSource(),
        invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
        layer: 0,
        priority: 0,
        disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
        value: new Map(decorations),
      })
      this.applyComposedRowDecorations()
      this.log({
        action: 'editor.decorations.row.changed',
        level: 'info',
        decorations: { count: decorations.size },
      })
    })
  }

  setLineHeight(lineHeight: number): void {
    if (!this.view.setLineHeight(lineHeight)) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.layout.line_height_changed',
      level: 'info',
      layout: { lineHeight },
    })
  }

  setRowGap(rowGap: number): void {
    if (!this.view.setRowGap(rowGap)) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.layout.row_gap_changed',
      level: 'info',
      layout: { rowGap },
    })
  }

  /**
   * Columns a tab spans, and the fallback the open document's indentation is guessed against, so a
   * document that gave no sign of its own follows the new width. Undefined is the default, 4.
   */
  setTabSize(tabSize: number | undefined): void {
    const configured = normalizeTabSize(tabSize)
    if (configured === this.configuredTabSize) return

    this.configuredTabSize = configured
    this.view.setTabSize(configured)
    this.tabSize = this.detectIndentation
      ? guessedTabSize(this.getTextSnapshot(), configured)
      : configured
    // Indentation folds are measured in the width in effect.
    this.scheduleFallbackFoldProjection()
    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.layout.tab_size_changed',
      level: 'info',
      layout: { configuredTabSize: configured, tabSize: this.tabSize },
    })
  }

  /** Undefined hands the size back to the stylesheet. */
  setFontSize(fontSize: number | undefined): void {
    this.announceFontMetrics(this.view.setFontSize(fontSize), 'font_size')
  }

  /** A CSS `font-family` list; undefined hands the face back to the stylesheet. */
  setFontFamily(fontFamily: string | undefined): void {
    this.announceFontMetrics(this.view.setFontFamily(fontFamily), 'font_family')
  }

  private remeasureTextMetrics(): void {
    this.announceFontMetrics(this.view.remeasureMetrics(), 'face_changed')
  }

  private announceFontMetrics(
    metrics: BrowserTextMetrics | null,
    cause: 'font_size' | 'font_family' | 'face_changed',
  ): void {
    if (!metrics) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.layout.text_metrics_remeasured',
      level: 'info',
      layout: {
        cause,
        rowHeight: metrics.rowHeight,
        characterWidth: metrics.characterWidth,
      },
    })
  }

  setScrollMode(scrollMode: EditorOptions['scrollMode']): void {
    if (!this.view.setScrollMode(scrollMode)) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.layout.scroll_mode_changed',
      level: 'info',
      layout: { scrollMode },
    })
  }

  addPlugin(plugin: EditorPlugin): EditorDisposable {
    return this.pluginHost.addPlugin(plugin)
  }

  removePlugin(plugin: EditorPlugin): boolean {
    return this.pluginHost.removePlugin(plugin)
  }

  setPlugins(plugins: readonly EditorPlugin[]): void {
    this.pluginHost.setPlugins(plugins)
    this.log({
      action: 'editor.plugins.set',
      level: 'info',
      plugins: plugins.map((plugin) => plugin.name ?? 'anonymous'),
    })
  }

  dispatchCommand(command: EditorAnyCommandId, context: EditorCommandContext = {}): boolean {
    if (this.view.isProvisional) return false
    if (this.refusesContributedMutation(command)) return false
    const scope = beginEditorPerformanceCommand(command)
    try {
      return this.dispatchCommandInOperation(command, context)
    } finally {
      endEditorPerformanceInput(scope)
    }
  }

  /** The commands this editor knows: every built-in, then those its plugins contribute. */
  getCommandDeclarations(): readonly (
    | EditorCommandDeclaration<EditorCommandId>
    | EditorContributedCommandDeclaration
  )[] {
    return [...EDITOR_COMMANDS, ...this.pluginHost.getContributedCommands()]
  }

  // A built-in mutation is refused by its own handler and by the keymap's writable condition; a
  // contributed one only says it mutates in its declaration.
  private refusesContributedMutation(command: EditorAnyCommandId): boolean {
    if (isEditorCommandId(command)) return false
    const declared = this.pluginHost.getContributedCommands().find((entry) => entry.id === command)
    return declared?.mutates === true && !this.canEditDocument()
  }

  private dispatchCommandInOperation(
    command: EditorAnyCommandId,
    context: EditorCommandContext,
  ): boolean {
    const start = nowMs()
    const handled = this.runInOperation(() => this.commandRouter.dispatch(command, context))
    this.log({
      action: 'editor.command.dispatched',
      level: handled ? 'info' : 'debug',
      command: {
        id: command,
        handled,
        keyboardEvent: Boolean(context.event),
      },
      durationMs: nowMs() - start,
    })
    return handled
  }

  attachSession(session: DocumentSession, options: EditorSessionOptions = {}): void {
    this.runDocumentReplacement(() => {
      this.preparingDocument = true
      const savedScroll = this.pendingDocumentScroll ?? this.view.provisionalScrollPosition
      if (!options.scrollPosition && savedScroll)
        options = { ...options, scrollPosition: savedScroll }
      const replacingDocument = this.session !== null
      this.disposeBufferSubscriptions()
      const attachment = this.document.attachSession(session, options)
      if (this.view.isProvisional) this.snapshotGeneration = attachment.documentVersion
      this.subscribeToBufferSession(session)
      const syntaxDocument = {
        documentId: attachment.internalDocumentId,
        languageId: attachment.languageId,
        textSnapshot: attachment.textSnapshot,
        snapshot: attachment.session.getSnapshot(),
      }
      const prepared = options.preparedDocument
        ? this.syntax.claimPreparedDocument(syntaxDocument, options.preparedDocument, {
            configuredTabSize: this.configuredTabSize,
            tabSizePolicy: this.detectIndentation ? 'detect-indentation' : 'fixed',
            documentConfigurationTag: options.documentConfigurationTag ?? [],
            highlighterConfigurationTag: options.highlighterConfigurationTag ?? [],
            structuralConfigurationTag: options.structuralConfigurationTag ?? [],
          })
        : null
      recordEditorPerformanceDiagnostic('editor.document.attach', {
        prepared: prepared !== null,
        structural: preparedTransferStage(prepared?.structural),
        highlighter: preparedTransferStage(prepared?.highlighter),
      })
      this.syntax.startDocument(syntaxDocument, prepared)
      this.lifecycleSummary.document.startedCount += 1
      this.syncViewEditability()
      if (prepared) this.adoptPreparedDocumentTabSize(prepared.tabSize)
      else this.adoptDocumentTabSize(attachment.textSnapshot)
      // Asked for before the text lands so the replacement renders the restored viewport directly.
      // Setting it afterwards drew the outgoing offset first and every row twice.
      this.view.requestScrollTop(options.scrollPosition?.top ?? DOCUMENT_START_SCROLL_POSITION.top)
      if (prepared) {
        this.view.runAtomicRender(() => {
          this.renderPreparedDocument(attachment.textSnapshot, prepared)
          this.syntax.adoptPreparedReadyResults(prepared)
        })
      } else {
        this.renderContent(attachment.textSnapshot)
      }
      // A host handing over its own session is replacing the document just as much as opening one is.
      if (replacingDocument) this.forgetOutgoingDocumentProjections()
      // Still applied: it settles the horizontal offset, and clamps the vertical one against the
      // rows that actually rendered. A match with the request above makes it a no-op.
      this.applyDocumentScrollPosition(options.scrollPosition)
      this.inputSelection.syncDomSelection()
      if (prepared) this.notifyViewContributions('content', null)
      this.notifyViewContributions('document', null)
      this.preparingDocument = false
      if (!this.commitSnapshotIfReady() && !this.view.isProvisional)
        this.syntax.notifyBaseTextPainted()
      this.notifyChange(null)
      this.refreshSyntax(attachment.documentVersion, null)
      this.lifecycleSummary.document.attachedCount += 1
    })
  }

  detachSession(): void {
    this.jumpHistory.clear()
    this.pendingJump = null
    this.pendingPointerJump = null
    this.fallbackFolds.reset()
    this.foldState.clear()
    this.disposeBufferSubscriptions()
    this.document.detachSession()
    this.inputSelection.clearSelectionHighlight()
    this.view.setEditable(false)
    this.lifecycleSummary.document.detachedCount += 1
  }

  clear(): void {
    this.jumpHistory.clear()
    this.pendingJump = null
    this.pendingPointerJump = null
    this.withdrawSnapshot()
    this.snapshotSettled = true
    this.detachedEditChain.rotate()
    this.disposeBufferSubscriptions()
    this.document.clear()
    this.syntax.clearDocument()
    this.inputSelection.clearSelectionHighlight()
    this.forgetOutgoingDocumentProjections()
    this.view.setEditable(false)
    this.renderContent('')
    this.applyDocumentScrollPosition()
    this.notifyViewContributions('clear', null)
    this.lifecycleSummary.document.clearedCount += 1
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.jumpHistory.clear()
    this.pendingJump = null
    this.pendingPointerJump = null
    this.lastSnapshot = null
    this.disconnectSnapshotAppearanceObserver()
    this.lifecycleSummary.disposingAt = new Date().toISOString()
    this.environmentRegistrations.dispose()
    this.secondaryWork.dispose()
    this.fallbackFolds.reset()
    this.foldState.clear()
    this.displayProjections.clear()
    this.inputSelection.dispose()
    this.viewContributions.dispose()
    this.disposeEditorFeatureContributions()
    this.disposeDecorationContributions()
    this.disposeEditContributions()
    this.disposeCapabilityContributions()
    this.disposeCommandContributions()
    this.keymap.dispose()
    this.announcer.dispose()
    this.syntax.dispose()
    this.detachSession()
    this.logLifecycleSummary()
    // The view owns listeners on window and document, so it has to come down even when a plugin
    // takes the host with it. The host contains a throwing dispose per plugin; this catches what
    // escapes that — a throwing installation disposable, or a host-owned registration.
    try {
      this.ambientPlugins.dispose()
      this.pluginHost.dispose()
    } finally {
      this.view.dispose()
    }
  }

  private resetOwnedDocument(
    document: EditorOpenDocumentOptions,
    options: ResetOwnedDocumentOptions,
  ): number {
    this.preparingDocument = true
    const savedScroll = this.pendingDocumentScroll ?? this.view.provisionalScrollPosition
    if (!options.scrollPosition && savedScroll)
      options = { ...options, scrollPosition: savedScroll }
    // Asked before the swap, because afterwards there is a document either way. An owner that
    // registered ranges before the editor ever held one meant them for the document it was waiting
    // for, and that document is the one arriving here.
    const replacingDocument = this.session !== null
    this.disposeBufferSubscriptions()
    const attachment = this.document.resetOwnedDocument(document, options)
    this.subscribeToBufferSession(attachment.session)
    if (this.view.isProvisional) this.snapshotGeneration = attachment.documentVersion
    this.syntax.startDocument({
      documentId: attachment.internalDocumentId,
      languageId: attachment.languageId,
      textSnapshot: attachment.textSnapshot,
      snapshot: attachment.session.getSnapshot(),
    })
    this.lifecycleSummary.document.startedCount += 1
    this.syncViewEditability()
    this.adoptDocumentTabSize(attachment.textSnapshot)
    // Asked for before the text lands, so the replacement renders the restored viewport directly.
    this.view.requestScrollTop(options.scrollPosition?.top ?? DOCUMENT_START_SCROLL_POSITION.top)
    this.renderContent(attachment.textSnapshot, toEditorTokenStore(document.tokens ?? []))
    // After the text is in, so what is rebuilt here is measured against the document that arrived.
    if (replacingDocument) this.forgetOutgoingDocumentProjections()
    this.applyRangeDecorations()
    this.applyDocumentScrollPosition(options.scrollPosition)
    this.inputSelection.syncDomSelection()
    this.notifyViewContributions('document', null)
    this.preparingDocument = false
    if (!this.commitSnapshotIfReady() && !this.view.isProvisional)
      this.syntax.notifyBaseTextPainted()
    return attachment.documentVersion
  }

  /**
   * Lets go of what the document being replaced was the only thing giving meaning to.
   *
   * A replacement is not an edit, so nothing carries these across it the way the flush carries a
   * decoration through a keystroke. A range registered over the old text would be redrawn across
   * whatever characters now sit at those offsets, and would then keep being carried by every later
   * edit; an editor walked through a hundred files would never shed the ranges of the ninety-nine
   * behind it. A suggestion is the same story with a shorter fuse: the view only refuses a map
   * describing text of another length, so a replacement of the same length paints the old
   * document's ghost text into the new one.
   *
   * The owners hear about the new document immediately after this and restate whatever still
   * applies to it, which is the only account of it that can be right.
   */
  private forgetOutgoingDocumentProjections(): void {
    this.decorations.clear()
    this.setInlineSuggestion(null)
  }

  /**
   * Takes the newly loaded document's indentation width as the one in effect.
   *
   * Without detection every editor would measure every file in the configured width, which is wrong
   * for all but the files that happen to use it. The guess reads a bounded sample of lines, so
   * opening a large file does not scan it.
   */
  private adoptDocumentTabSize(source: TextSnapshot): void {
    if (!this.detectIndentation) return

    this.tabSize = guessedTabSize(source, this.configuredTabSize)
  }

  private adoptPreparedDocumentTabSize(tabSize: number): void {
    if (!this.detectIndentation) return

    this.tabSize = tabSize
  }

  private renderPreparedDocument(
    textSnapshot: TextSnapshot,
    prepared: EditorPreparedDocumentPayload,
  ): void {
    const savedFolds = editorBufferSession(this.session)?.view.getFoldState()
    this.view.measureInitialViewport()
    this.document.setRenderedTextSnapshot(textSnapshot)
    this.recordDetachedTextChange(null)
    const tokens = this.syntax.stagePreparedReadyTokens(prepared)
    this.view.setText(textSnapshot, prepared.lineStarts, tokens)
    this.retagDisplayProjectionSources()
    this.syncInjectedTextRows()
    this.dropManualFolds()
    this.installPreparedFallbackFolds(prepared.fallbackFoldIndex)
    this.restoreViewFolds(savedFolds)
    this.applyRangeDecorations()
    this.recordContentSet()
  }

  private installPreparedFallbackFolds(index: IndentationFoldIndex | null): void {
    this.grammarDescribedFolds = false
    this.displayProjections.delete('folds', SYNTAX_FOLD_PROJECTION_OWNER)
    this.foldState.clear()
    this.fallbackFolds.adopt(index)
    this.foldState.setFoldProjections(this.foldProjections(), this.fallbackFolds.index)
  }

  private initializeDefaultText(): void {
    if (this.options.defaultText === undefined) return

    this.resetOwnedDocument(
      {
        text: this.options.defaultText,
        documentMode: normalizeEditorDocumentMode(this.options.documentMode),
        languageId: null,
      },
      {
        documentId: null,
        persistentIdentity: false,
        scrollPosition: DOCUMENT_START_SCROLL_POSITION,
      },
    )
  }

  private applyDocumentScrollPosition(scrollPosition?: EditorScrollPosition): void {
    this.applyScrollPosition({
      top: scrollPosition?.top ?? DOCUMENT_START_SCROLL_POSITION.top,
      left: scrollPosition?.left ?? DOCUMENT_START_SCROLL_POSITION.left,
    })
  }

  private applyScrollPosition(scrollPosition: EditorScrollPosition): void {
    if (this.view.isProvisional) {
      this.pendingDocumentScroll = scrollPosition
      return
    }
    const viewState = this.view.getState()
    const scrollTop = normalizeScrollOffset(
      scrollPosition.top,
      viewState.scrollTop,
      viewState.scrollHeight - viewState.viewportHeight,
    )
    const scrollLeft = normalizeScrollOffset(
      scrollPosition.left,
      viewState.scrollLeft,
      viewState.scrollWidth - viewState.viewportWidth,
    )
    if (scrollTop === viewState.scrollTop && scrollLeft === viewState.scrollLeft) return

    // Both axes first: the element's scrollTop setter is the virtualizer's, and on its own it would
    // publish a position with the old scrollLeft to anything following the scroll.
    this.view.setScrollMetrics(
      scrollTop,
      viewState.viewportHeight,
      viewState.viewportWidth,
      scrollLeft,
    )
    this.el.scrollTop = scrollTop
    this.el.scrollLeft = scrollLeft
  }

  private currentSessionDocumentId(): string {
    return this.document.currentSessionDocumentId()
  }

  private createInitialViewContributions(
    providers: readonly EditorViewContributionProvider[],
  ): EditorViewContribution[] {
    const contributions: EditorViewContribution[] = []
    for (const provider of providers) {
      const contribution = this.createViewContribution(provider)
      if (!contribution) continue

      contributions.push(contribution)
      this.viewContributionsByProvider.set(provider, contribution)
    }

    return contributions
  }

  private addViewContributionProvider(provider: EditorViewContributionProvider): void {
    const contribution = this.createViewContribution(provider)
    if (!contribution) return

    this.viewContributionsByProvider.set(provider, contribution)
    this.viewContributions.add(contribution)
  }

  private removeViewContributionProvider(provider: EditorViewContributionProvider): void {
    const contribution = this.viewContributionsByProvider.get(provider)
    if (!contribution) return

    this.viewContributionsByProvider.delete(provider)
    this.viewContributions.remove(contribution)
  }

  private createViewContribution(
    provider: EditorViewContributionProvider,
  ): EditorViewContribution | null {
    let owner: EditorViewContribution | null = null
    const contribution = this.createContributionSafely('view', () =>
      provider.createContribution(this.createViewContributionContext(this.container, () => owner)),
    )
    owner = contribution
    return contribution
  }

  private createInitialCommandContributions(
    providers: readonly EditorCommandContributionProvider[],
  ): void {
    for (const provider of providers) this.addCommandContributionProvider(provider)
  }

  private addCommandContributionProvider(provider: EditorCommandContributionProvider): void {
    const contribution = this.createCommandContribution(provider)
    if (!contribution) return

    this.commandContributionsByProvider.set(provider, contribution)
    this.commandContributions.push(contribution)
  }

  private createCommandContribution(
    provider: EditorCommandContributionProvider,
  ): EditorCommandContribution | null {
    return this.createContributionSafely('command', () =>
      provider.createContribution(this.createCommandContributionContext()),
    )
  }

  private removeCommandContributionProvider(provider: EditorCommandContributionProvider): void {
    const contribution = this.commandContributionsByProvider.get(provider)
    if (!contribution) return

    this.commandContributionsByProvider.delete(provider)
    removeArrayItem(this.commandContributions, contribution)
    this.disposeContributionSafely(contribution, 'command')
  }

  private disposeCommandContributions(): void {
    while (this.commandContributions.length > 0) {
      const contribution = this.commandContributions.pop()
      if (contribution) this.disposeContributionSafely(contribution, 'command')
    }
    this.commandContributionsByProvider.clear()
  }

  private createInitialCapabilityContributions(
    providers: readonly EditorCapabilityContributionProvider[],
  ): void {
    for (const provider of providers) this.addCapabilityContributionProvider(provider)
  }

  private addCapabilityContributionProvider(provider: EditorCapabilityContributionProvider): void {
    const contribution = this.createCapabilityContribution(provider)
    if (!contribution) return

    this.capabilityContributionsByProvider.set(provider, contribution)
    this.capabilityContributions.push(contribution)
  }

  private createCapabilityContribution(
    provider: EditorCapabilityContributionProvider,
  ): EditorCapabilityContribution | null {
    return this.createContributionSafely('capability', () =>
      provider.createContribution(this.createCapabilityContributionContext()),
    )
  }

  private removeCapabilityContributionProvider(
    provider: EditorCapabilityContributionProvider,
  ): void {
    const contribution = this.capabilityContributionsByProvider.get(provider)
    if (!contribution) return

    this.capabilityContributionsByProvider.delete(provider)
    removeArrayItem(this.capabilityContributions, contribution)
    this.disposeContributionSafely(contribution, 'capability')
  }

  private disposeCapabilityContributions(): void {
    while (this.capabilityContributions.length > 0) {
      const contribution = this.capabilityContributions.pop()
      if (contribution) this.disposeContributionSafely(contribution, 'capability')
    }
    this.capabilityContributionsByProvider.clear()
  }

  private createInitialEditContributions(
    providers: readonly EditorEditContributionProvider[],
  ): void {
    for (const provider of providers) this.addEditContributionProvider(provider)
  }

  private addEditContributionProvider(provider: EditorEditContributionProvider): void {
    const contribution = this.createEditContribution(provider)
    if (!contribution) return

    this.editContributionsByProvider.set(provider, contribution)
    this.editContributions.push(contribution)
  }

  private createEditContribution(
    provider: EditorEditContributionProvider,
  ): EditorEditContribution | null {
    return this.createContributionSafely('edit', () =>
      provider.createContribution(this.createEditContributionContext()),
    )
  }

  private removeEditContributionProvider(provider: EditorEditContributionProvider): void {
    const contribution = this.editContributionsByProvider.get(provider)
    if (!contribution) return

    this.editContributionsByProvider.delete(provider)
    removeArrayItem(this.editContributions, contribution)
    this.disposeContributionSafely(contribution, 'edit')
  }

  private disposeEditContributions(): void {
    while (this.editContributions.length > 0) {
      const contribution = this.editContributions.pop()
      if (contribution) this.disposeContributionSafely(contribution, 'edit')
    }
    this.editContributionsByProvider.clear()
  }

  private createInitialDecorationContributions(
    providers: readonly EditorDecorationContributionProvider[],
  ): void {
    for (const provider of providers) this.addDecorationContributionProvider(provider, false)
  }

  private addDecorationContributionProvider(
    provider: EditorDecorationContributionProvider,
    notify = true,
  ): void {
    const owner = Symbol('editor.decorationContribution')
    const contribution = this.createDecorationContribution(provider, owner)
    if (!contribution) return

    this.decorationContributionsByProvider.set(provider, contribution)
    this.rowDecorationContributionOwners.set(contribution, owner)
    this.decorationContributions.push(contribution)
    if (notify) contribution.handleEditorChange?.(null)
  }

  private createDecorationContribution(
    provider: EditorDecorationContributionProvider,
    owner: symbol,
  ): EditorDecorationContribution | null {
    const contribution = this.createContributionSafely('decoration', () =>
      provider.createContribution(this.createDecorationContributionContext(owner)),
    )
    // Rows are claimed against an owner rather than handed back as something to dispose, so they
    // are swept by that owner instead of unwinding with the rest of what the factory took.
    if (!contribution) this.clearRowDecorationSourcesForOwner(owner)

    return contribution
  }

  private removeDecorationContributionProvider(
    provider: EditorDecorationContributionProvider,
  ): void {
    const contribution = this.decorationContributionsByProvider.get(provider)
    if (!contribution) return

    this.decorationContributionsByProvider.delete(provider)
    removeArrayItem(this.decorationContributions, contribution)
    this.disposeContributionSafely(contribution, 'decoration')
    this.clearContributionRowDecorationSources(contribution)
  }

  private disposeDecorationContributions(): void {
    while (this.decorationContributions.length > 0) {
      const contribution = this.decorationContributions.pop()
      if (!contribution) continue

      this.disposeContributionSafely(contribution, 'decoration')
      this.clearContributionRowDecorationSources(contribution)
    }
    this.decorationContributionsByProvider.clear()
  }

  private createInitialEditorFeatureContributions(
    providers: readonly EditorFeatureContributionProvider[],
  ): void {
    for (const provider of providers) this.addEditorFeatureContributionProvider(provider, false)
  }

  private addEditorFeatureContributionProvider(
    provider: EditorFeatureContributionProvider,
    notify = true,
  ): void {
    const owner = Symbol('editor.featureContribution')
    const contribution = this.createEditorFeatureContribution(provider, owner)
    if (!contribution) return

    this.editorFeatureContributionsByProvider.set(provider, contribution)
    this.rowDecorationContributionOwners.set(contribution, owner)
    this.editorFeatureContributions.push(contribution)
    if (notify) contribution.handleEditorChange?.(null)
  }

  private createEditorFeatureContribution(
    provider: EditorFeatureContributionProvider,
    owner: symbol,
  ): EditorFeatureContribution | null {
    const contribution = this.createContributionSafely('feature', () =>
      provider.createContribution(
        this.createEditorFeatureContributionContext(this.container, owner),
      ),
    )
    if (!contribution) this.clearRowDecorationSourcesForOwner(owner)

    return contribution
  }

  private removeEditorFeatureContributionProvider(
    provider: EditorFeatureContributionProvider,
  ): void {
    const contribution = this.editorFeatureContributionsByProvider.get(provider)
    if (!contribution) return

    this.editorFeatureContributionsByProvider.delete(provider)
    removeArrayItem(this.editorFeatureContributions, contribution)
    this.disposeContributionSafely(contribution, 'feature')
    this.clearContributionRowDecorationSources(contribution)
  }

  private disposeEditorFeatureContributions(): void {
    while (this.editorFeatureContributions.length > 0) {
      const contribution = this.editorFeatureContributions.pop()
      if (!contribution) continue

      this.disposeContributionSafely(contribution, 'feature')
      this.clearContributionRowDecorationSources(contribution)
    }
    this.editorFeatureContributionsByProvider.clear()
  }

  private logInitialPlugins(): void {
    for (const name of this.pluginHost.getActivePluginNames()) {
      this.recordPluginLifecycle('activated', name)
    }
  }

  private recordEditorMounted(durationMs: number): void {
    this.lifecycleSummary.mountDurationMs = durationMs
    this.lifecycleSummary.mountedAt = new Date().toISOString()

    for (const name of this.pluginHost.getActivePluginNames()) {
      this.lifecycleSummary.pluginNames.add(name)
    }
  }

  private recordContentSet(): void {
    this.lifecycleSummary.content.setCount += 1
  }

  private recordPluginLifecycle(
    phase: 'activated' | 'deactivated' | 'disposed' | 'installed' | 'updated',
    name: string,
    durationMs?: number,
  ): void {
    this.lifecycleSummary.pluginNames.add(name)
    if (phase === 'activated') this.recordPluginActivation(durationMs)
    if (phase === 'deactivated') this.lifecycleSummary.plugin.deactivatedCount += 1
    if (phase === 'disposed') this.lifecycleSummary.plugin.disposedCount += 1
    if (phase === 'installed') this.lifecycleSummary.plugin.installedCount += 1
    if (phase === 'updated') this.lifecycleSummary.plugin.updatedCount += 1
  }

  private recordPluginActivation(durationMs?: number): void {
    this.lifecycleSummary.plugin.activatedCount += 1
    if (durationMs === undefined) return

    const slowest = this.lifecycleSummary.plugin.slowestActivationMs
    if (slowest !== null && slowest >= durationMs) return

    this.lifecycleSummary.plugin.slowestActivationMs = durationMs
  }

  private logPluginFailure(
    action:
      | 'editor.plugin.activation_failed'
      | 'editor.plugin.deactivate_failed'
      | 'editor.plugin.dispose_failed'
      | 'editor.plugin.install_failed'
      | 'editor.plugin.update_failed',
    name: string,
    error: unknown,
    durationMs: number,
  ): void {
    this.lifecycleSummary.pluginNames.add(name)
    this.lifecycleSummary.plugin.failedCount += 1
    this.log({
      action,
      level: 'error',
      durationMs,
      error: editorLogError(error),
      plugin: { name },
    })
  }

  private logSyntaxLifecycleEvent(event: EditorLogInput): void {
    if (event.action === 'editor.syntax.refresh_scheduled') {
      this.lifecycleSummary.syntax.refreshScheduledCount += 1
      return
    }

    this.log(event)
  }

  private logLifecycleSummary(): void {
    const disposingPluginNames = this.pluginHost.getActivePluginNames()
    this.log({
      action: 'editor.lifecycle.summary',
      level: 'info',
      content: this.lifecycleSummary.content,
      document: this.lifecycleSummary.document,
      folds: this.lifecycleSummary.folds,
      lifecycle: {
        disposingAt: this.lifecycleSummary.disposingAt,
        mountDurationMs: this.lifecycleSummary.mountDurationMs,
        mountedAt: this.lifecycleSummary.mountedAt,
      },
      plugin: {
        ...this.lifecycleSummary.plugin,
        deactivatedCount:
          this.lifecycleSummary.plugin.deactivatedCount + disposingPluginNames.length,
        disposedCount: this.lifecycleSummary.plugin.disposedCount + disposingPluginNames.length,
        names: [...this.lifecycleSummary.pluginNames].toSorted(),
      },
      syntax: this.lifecycleSummary.syntax,
    })
  }

  private log(event: EditorLogInput): void {
    if (!this.pluginHost.hasLoggers()) return

    this.pluginHost.log({
      ...event,
      editor: {
        ...event.editor,
        documentId: this.documentId,
        documentMode: this.documentMode,
        documentVersion: this.documentVersion,
        editability: this.editability,
        instanceId: this.highlightPrefix,
        languageId: this.languageId,
        textVersion: this.textVersion,
      },
      source: 'editor',
      timestamp: event.timestamp ?? new Date().toISOString(),
    })
  }

  private logContributionFailure(
    kind: EditorContributionKind,
    phase: EditorContributionFailurePhase,
    error: unknown,
  ): void {
    this.log({
      action: editorContributionFailureAction(phase),
      level: 'error',
      error: editorLogError(error),
      contribution: { kind, phase },
    })
  }

  /** Builds one contribution, unwinding whatever it registered if it never hands one back. */
  private createContributionSafely<T>(
    kind: EditorContributionKind,
    create: () => T | null,
  ): T | null {
    // A factory is free to build a second contribution while it runs, and the inner one's claims
    // are its own; restoring the list rather than clearing it keeps them apart.
    const enclosing = this.contributionClaims
    const claims = new ContributionClaims()
    this.contributionClaims = claims
    try {
      const contribution = create()
      if (!contribution) this.releaseContributionClaims(claims, kind)
      else this.claimsByContribution.set(contribution, claims)
      return contribution
    } catch (error) {
      this.releaseContributionClaims(claims, kind)
      this.logContributionFailure(kind, 'factory', error)
      return null
    } finally {
      this.contributionClaims = enclosing
    }
  }

  private claimForContribution(registration: EditorDisposable): EditorDisposable {
    return this.contributionClaims?.add(registration) ?? registration
  }

  /** A context's registration, made at any time, belongs to the contribution the context serves. */
  private claimedBy<T>(claims: ContributionClaims, register: () => T): T {
    const enclosing = this.contributionClaims
    this.contributionClaims = claims
    try {
      return register()
    } finally {
      this.contributionClaims = enclosing
    }
  }

  private currentClaims(): ContributionClaims {
    return this.contributionClaims ?? new ContributionClaims()
  }

  private releaseContributionClaims(
    claims: ContributionClaims,
    kind: EditorContributionKind,
  ): void {
    for (const claim of claims.release()) this.disposeContributionSafely(claim, kind)
  }

  private disposeContributionSafely(
    contribution: EditorDisposable,
    kind: EditorContributionKind,
  ): void {
    try {
      contribution.dispose()
    } catch (error) {
      this.logContributionFailure(kind, 'dispose', error)
    }
    this.releaseClaimsOf(contribution, kind)
  }

  private releaseClaimsOf(contribution: object, kind: EditorContributionKind): void {
    const claims = this.claimsByContribution.get(contribution)
    if (!claims) return

    this.claimsByContribution.delete(contribution)
    this.releaseContributionClaims(claims, kind)
  }

  private syncGutterContributions(): void {
    const contributions = this.pluginHost.getGutterContributions()
    if (!this.setGutterProjection(contributions)) return
    if (!this.view.setGutterContributions(this.composedGutterContributions())) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.plugins.gutters.changed',
      level: 'info',
      plugins: {
        gutterContributionCount: this.composedGutterContributions().length,
      },
    })
  }

  private setGutterProjection(contributions: readonly EditorGutterContribution[]): boolean {
    if (sameGutterContributions(this.pluginGutterContributions(), contributions)) return false
    if (contributions.length === 0) {
      return this.displayProjections.delete('gutters', PLUGIN_GUTTER_PROJECTION_OWNER)
    }

    this.displayProjections.set({
      kind: 'gutters',
      owner: PLUGIN_GUTTER_PROJECTION_OWNER,
      source: this.currentDisplayProjectionSource(),
      invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
      layer: 0,
      priority: 0,
      disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
      value: [...contributions],
    })
    return true
  }

  private pluginGutterContributions(): readonly EditorGutterContribution[] {
    return this.displayProjections.get('gutters', PLUGIN_GUTTER_PROJECTION_OWNER)?.value ?? []
  }

  private composedGutterContributions(): readonly EditorGutterContribution[] {
    const contributions: EditorGutterContribution[] = []
    for (const projection of this.displayProjections.values('gutters')) {
      contributions.push(...projection.value)
    }

    return contributions
  }

  private setSyntaxFoldProjection(folds: readonly FoldRange[]): boolean {
    const result = rejectCrossingFoldRanges(folds)
    if (result.rejected.length > 0) this.logRejectedSyntaxFoldProjection(result.rejected)

    const acceptedFolds = result.folds
    if (foldRangesEqual(this.syntaxFoldProjection(), acceptedFolds)) return false
    if (acceptedFolds.length === 0) {
      return this.displayProjections.delete('folds', SYNTAX_FOLD_PROJECTION_OWNER)
    }

    this.displayProjections.set({
      kind: 'folds',
      owner: SYNTAX_FOLD_PROJECTION_OWNER,
      source: this.currentDisplayProjectionSource(),
      invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
      layer: 0,
      priority: 0,
      disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
      value: [...acceptedFolds],
    })
    return true
  }

  private logRejectedSyntaxFoldProjection(rejected: readonly FoldRangeRejection[]): void {
    const first = rejected[0]
    if (!first) return

    this.lifecycleSummary.folds.syntaxRejectedCount += rejected.length
    if (this.lifecycleSummary.folds.firstSyntaxRejection) return

    this.lifecycleSummary.folds.firstSyntaxRejection = {
      message: 'Rejected invalid syntax fold projection ranges',
      syntax: {
        firstRejectedFold: foldLogContext(first.fold),
        previousFold: first.previous ? foldLogContext(first.previous) : null,
        reason: first.kind,
        rejectedFoldCount: rejected.length,
      },
    }
  }

  private syntaxFoldProjection(): readonly FoldRange[] {
    return this.displayProjections.get('folds', SYNTAX_FOLD_PROJECTION_OWNER)?.value ?? []
  }

  /**
   * Hand-drawn regions join the contributed ones here, and only the ones that still take a place in
   * the nesting: a provider is free to describe a block that half-overlaps one the user drew, and
   * when it does, the drawn region sits out rather than leaving the set with a range that has no
   * level. Its collapse outlives the eclipse, so the region comes back folded when the parse moves on.
   */
  private foldProjections(
    index = this.fallbackFolds.index,
  ): readonly EditorDisplayProjection<'folds'>[] {
    if (!this.folding) return []

    const contributed = this.displayProjections.values('folds')
    if (this.manualFolds.length === 0) return contributed

    const contributedFolds = contributed.flatMap((projection) => [...projection.value])
    const compatibleManualFolds = this.manualFolds.filter(
      (fold) =>
        !index || nestableFoldRanges([fold], index.ranges(fold.startLine, fold.endLine)).length > 0,
    )
    const manualFolds = nestableFoldRanges(compatibleManualFolds, contributedFolds)
    if (manualFolds.length === 0) return contributed

    return [
      ...contributed,
      {
        kind: 'folds',
        owner: MANUAL_FOLD_PROJECTION_OWNER,
        source: this.currentDisplayProjectionSource(),
        invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
        layer: 0,
        priority: 2,
        disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
        value: manualFolds,
      },
    ]
  }

  private syncFoldStateFromProjections(): void {
    this.fallbackFolds.flush()
    this.foldState.setFoldProjections(this.foldProjections(), this.fallbackFolds.index)
  }

  private flushFallbackFoldProjection(): void {
    this.fallbackFolds.flush()
  }

  private scheduleFallbackFoldProjection(): void {
    this.fallbackFolds.schedule()
  }

  private handleInjectedTextRowProvidersChanged(): void {
    if (!this.syncInjectedTextRows()) return

    this.notifyViewContributions('layout', null)
    this.inputSelection.syncDomSelection()
    this.log({
      action: 'editor.plugins.injected_rows.changed',
      level: 'info',
      plugins: {
        injectedTextRowProviderCount: this.pluginHost.getInjectedTextRowProviders().length,
        rowCount: this.appliedInjectedTextRows.length,
      },
    })
  }

  private syncInjectedTextRows(): boolean {
    const rows = this.injectedTextRowsForProviders()
    if (!this.setInjectedRowsProjection(rows)) return false

    this.appliedInjectedTextRows = this.composedInjectedTextRows()
    this.view.setInjectedTextRows(this.appliedInjectedTextRows)
    return true
  }

  private setInjectedRowsProjection(rows: readonly InjectedTextRow[]): boolean {
    if (sameInjectedTextRows(this.pluginInjectedTextRows(), rows)) return false
    if (rows.length === 0) {
      return this.displayProjections.delete('injectedRows', PLUGIN_INJECTED_ROWS_PROJECTION_OWNER)
    }

    this.displayProjections.set({
      kind: 'injectedRows',
      owner: PLUGIN_INJECTED_ROWS_PROJECTION_OWNER,
      source: this.currentDisplayProjectionSource(),
      invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
      layer: 0,
      priority: 0,
      disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
      value: [...rows],
    })
    return true
  }

  private pluginInjectedTextRows(): readonly InjectedTextRow[] {
    return (
      this.displayProjections.get('injectedRows', PLUGIN_INJECTED_ROWS_PROJECTION_OWNER)?.value ??
      []
    )
  }

  private composedInjectedTextRows(): readonly InjectedTextRow[] {
    const rows: InjectedTextRow[] = []
    for (const projection of this.displayProjections.values('injectedRows')) {
      rows.push(...projection.value)
    }

    return rows
  }

  private injectedTextRowsForProviders(): readonly InjectedTextRow[] {
    const providers = this.pluginHost.getInjectedTextRowProviders()
    if (providers.length === 0) return []

    const context = this.createInjectedTextRowProviderContext()
    const rows: InjectedTextRow[] = []
    for (const provider of providers) rows.push(...provider.getInjectedTextRows(context))
    return rows
  }

  private createInjectedTextRowProviderContext(): EditorInjectedTextRowProviderContext {
    return {
      documentId: this.documentId,
      textSnapshot: this.getTextSnapshot(),
      lineCount: this.view.getLineCount(),
    }
  }

  private setSourceRowDecorations(
    sourceId: string,
    decorations: ReadonlyMap<number, VirtualizedTextRowDecoration>,
    owner: symbol,
  ): void {
    if (sourceId.length === 0) return
    this.claimRowDecorationSource(sourceId, owner)

    this.displayProjections.set({
      kind: 'rowDecorations',
      owner: sourceRowDecorationOwner(sourceId),
      source: this.currentDisplayProjectionSource(),
      invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION,
      layer: 10,
      priority: 0,
      disposal: NO_DISPLAY_PROJECTION_DISPOSAL,
      value: new Map(decorations),
    })
    this.applyComposedRowDecorations()
  }

  private clearSourceRowDecorations(sourceId: string, owner: symbol): void {
    if (this.rowDecorationSourceOwners.get(sourceId) !== owner) return

    this.releaseRowDecorationSource(sourceId, owner)
    if (!this.displayProjections.delete('rowDecorations', sourceRowDecorationOwner(sourceId)))
      return

    this.applyComposedRowDecorations()
  }

  private claimRowDecorationSource(sourceId: string, owner: symbol): void {
    const currentOwner = this.rowDecorationSourceOwners.get(sourceId)
    if (currentOwner === owner) return
    if (currentOwner)
      throw new Error(`Editor row decoration source already registered: ${sourceId}`)

    this.rowDecorationSourceOwners.set(sourceId, owner)
    let sources = this.rowDecorationSourcesByOwner.get(owner)
    if (!sources) {
      sources = new Set()
      this.rowDecorationSourcesByOwner.set(owner, sources)
    }
    sources.add(sourceId)
  }

  private releaseRowDecorationSource(sourceId: string, owner: symbol): void {
    this.rowDecorationSourceOwners.delete(sourceId)
    const sources = this.rowDecorationSourcesByOwner.get(owner)
    if (!sources) return

    sources.delete(sourceId)
    if (sources.size === 0) this.rowDecorationSourcesByOwner.delete(owner)
  }

  private clearContributionRowDecorationSources(
    contribution: EditorDecorationContribution | EditorFeatureContribution,
  ): void {
    const owner = this.rowDecorationContributionOwners.get(contribution)
    if (!owner) return

    this.rowDecorationContributionOwners.delete(contribution)
    this.clearRowDecorationSourcesForOwner(owner)
  }

  private clearRowDecorationSourcesForOwner(owner: symbol): void {
    const sources = this.rowDecorationSourcesByOwner.get(owner)
    if (!sources) return

    for (const sourceId of Array.from(sources)) this.clearSourceRowDecorations(sourceId, owner)
  }

  private applyComposedRowDecorations(): void {
    this.view.setRowDecorations(this.composedRowDecorations())
    this.view.refreshGutterWidth()
    this.notifyViewContributions('layout', null)
  }

  private composedRowDecorations(): ReadonlyMap<number, VirtualizedTextRowDecoration> {
    const composed = new Map<number, VirtualizedTextRowDecoration>()
    for (const projection of this.displayProjections.values('rowDecorations')) {
      mergeRowDecorationMap(composed, projection.value)
    }

    return composed
  }

  private projectRowDecorationsThroughLineEdit(
    edit: TextEdit,
    previousText: TextSnapshot,
    lineStarts: LineStartsView,
  ): boolean {
    const rowDelta = editLineDelta(edit, previousText)
    if (rowDelta === 0) return false

    const projections = this.displayProjections.values('rowDecorations')
    if (projections.length === 0) return false

    const startRow = lineStarts.indexForOffset(edit.from)
    const endRow = lineStarts.indexForOffset(edit.to)
    const source = this.currentDisplayProjectionSource()
    const invalidationRange = { kind: 'rows' as const, startRow, endRow }
    for (const projection of projections) {
      this.displayProjections.replaceValue(
        'rowDecorations',
        projection.owner,
        projectRowDecorationMapThroughLineEdit(projection.value, startRow, endRow, rowDelta),
        { source, invalidationRange },
      )
    }

    return true
  }

  private projectRowDecorationsThroughBatch(batch: TextEditBatch): boolean {
    if (!batch.changes.some((change) => change.lineDelta !== 0)) return false

    const projections = this.displayProjections.values('rowDecorations')
    const source = this.currentDisplayProjectionSource()
    for (const projection of projections) {
      this.displayProjections.replaceValue(
        'rowDecorations',
        projection.owner,
        projectRowDecorationMapThroughEdits(projection.value, batch),
        { source, invalidationRange: FULL_DISPLAY_PROJECTION_INVALIDATION },
      )
    }
    return projections.length > 0
  }

  private createViewContributionContext(
    container: HTMLElement,
    owner: () => EditorViewContribution | null,
  ): EditorInternalViewContributionContext {
    const claims = this.currentClaims()
    return {
      unstableEditor: this,
      getSelections: () => this.inputSelection.resolveViewSelections(),
      applyEdits: (edits, timingName, selection) =>
        this.inputSelection.applyFindEdits(edits, timingName, selection),
      registerCommand: (command, handler) =>
        this.claimedBy(claims, () => this.registerCommandHandler(command, handler)),
      refreshInputs: () => this.viewContributions?.refreshInputs(),
      container,
      scrollElement: this.el,
      contentElement: this.view.contentElement,
      highlightPrefix: this.highlightPrefix,
      hasDocument: () => this.session !== null,
      getSnapshot: () => this.createViewSnapshot(),
      requestViewUpdate: () => this.requestViewUpdate(owner()),
      onDidType: (listener) => this.claimedBy(claims, () => this.addTypedTextListener(listener)),
      registerPressParticipant: (participant) =>
        this.claimedBy(claims, () => this.registerPressParticipant(participant)),
      registerNonCaretRows: (isNonCaret) =>
        this.claimedBy(claims, () => this.registerNonCaretRows(isNonCaret)),
      registerKeymapContextKey: (key, read) =>
        this.claimedBy(claims, () => this.registerKeymapContextKey(key, read)),
      getFeature: (key) => this.getFeature(key),
      getProviders: (token, languageId) => this.languageFeatures.ordered(token, languageId),
      registerProvider: (token, selector, provider) =>
        this.claimedBy(claims, () =>
          this.registerLanguageFeatureProvider(token, selector, provider),
        ),
      log: (event) => this.log(event),
      revealLine: (row) => this.view.scrollToRow(row),
      announce: (message) => this.announcer.status(message),
      focusEditor: () => this.focus(),
      setSelection: (anchor, head, timingName, options) =>
        this.applyRequestedSelection(anchor, head, timingName, options),
      setSelections: (selections, timingName, revealOffset) =>
        this.applyRequestedSelections(selections, timingName, revealOffset),
      reserveOverlayWidth: (side, width) => this.reserveOverlayWidth(side, width),
      getReservedOverlayWidth: (side) => this.view.reservedOverlayWidth(side),
      onDidChangeReservedOverlayWidth: (listener) =>
        this.claimedBy(claims, () => this.addReservedWidthListener(listener)),
      setScrollPosition: (position) => this.applyScrollPosition(position),
      getRowPresentation: (displayRow) => this.view.getRowPresentation(displayRow),
      rowAtPoint: (clientX, clientY) => this.rowAtPoint(clientX, clientY),
      markerAtPoint: (clientX, clientY) => this.markerAtPoint(clientX, clientY),
      textOffsetFromPoint: (clientX, clientY) =>
        this.inputSelection.textOffsetFromPoint(clientX, clientY),
      getRangeClientRect: (start, end) => this.inputSelection.rangeClientRect(start, end),
      trackPoint: (anchor) => this.trackDocumentPoint(anchor),
      trackRanges: (ranges, bias) => this.trackDocumentRanges(ranges, bias),
      setRangeHighlight: (name, ranges, style) => this.view.setRangeHighlight(name, ranges, style),
      clearRangeHighlight: (name) => this.view.clearRangeHighlight(name),
    }
  }

  /**
   * A caller that names no bias asked for a region of the document rather than for the characters
   * that were in it, so text arriving at either edge belongs to the span it gets back.
   */
  private trackDocumentRanges(
    ranges: readonly TextOffsetRange[],
    bias: Pick<EditorDecorationRange, 'startBias' | 'endBias'> = {
      startBias: 'left',
      endBias: 'right',
    },
  ): EditorTrackedRanges {
    const snapshot = this.session?.getSnapshot()
    const tracked = snapshot
      ? ranges.map((range) => ({
          start: anchorAt(snapshot, range.start, bias.startBias),
          end: anchorAt(snapshot, range.end, bias.endBias),
        }))
      : []

    return { resolve: () => this.resolveTrackedRanges(tracked) }
  }

  private trackDocumentPoint(
    descriptor: Extract<EditorTextAnchor, { readonly kind: 'point' }>,
  ): EditorTrackedPoint {
    const snapshot = this.session?.getSnapshot()
    const anchor = snapshot ? anchorAt(snapshot, descriptor.offset, descriptor.bias) : null

    return {
      resolve: () => {
        const current = this.session?.getSnapshot()
        if (!current || !anchor) return null

        const resolved = resolveAnchor(current, anchor)
        if (resolved.liveness === 'deleted') return { kind: 'deleted' }

        return { kind: 'live', offset: resolved.offset }
      },
    }
  }

  private resolveTrackedRanges(tracked: readonly TrackedAnchorRange[]): readonly TextOffsetRange[] {
    const snapshot = this.session?.getSnapshot()
    if (!snapshot) return []

    const resolved: TextOffsetRange[] = []
    for (const range of tracked) {
      const start = resolveAnchor(snapshot, range.start).offset
      const end = resolveAnchor(snapshot, range.end).offset
      // A span whose text is gone has nothing left to hold, and the point it collapsed onto is a
      // range the caller never asked about.
      if (end > start) resolved.push({ start, end })
    }

    return resolved
  }

  private createCommandContributionContext(): EditorCommandContributionContext {
    const claims = this.currentClaims()
    return {
      registerCommand: (command, handler) =>
        this.claimedBy(claims, () => this.registerCommandHandler(command, handler)),
    }
  }

  private createCapabilityContributionContext(): EditorCapabilityContributionContext {
    const claims = this.currentClaims()
    return {
      registerFeature: (key, feature) =>
        this.claimedBy(claims, () => this.registerFeature(key, feature)),
      registerProvider: (token, selector, provider) =>
        this.claimedBy(claims, () =>
          this.registerLanguageFeatureProvider(token, selector, provider),
        ),
    }
  }

  private createEditContributionContext(): EditorEditContributionContext {
    const claims = this.currentClaims()
    return {
      hasDocument: () => this.session !== null,
      log: (event) => this.log(event),
      materializeFullText: () => this.materializeFullText(),
      getTextSnapshot: () => this.session?.getTextSnapshot() ?? null,
      getDocumentSyncPoint: () => this.currentDocumentEditChain().point,
      changesSinceDocumentSyncPoint: (point, scope) =>
        this.currentDocumentEditChain().changesSince(point, scope),
      getSelections: () => this.inputSelection.resolveViewSelections(),
      registerFeature: (key, feature) =>
        this.claimedBy(claims, () => this.registerFeature(key, feature)),
      registerProvider: (token, selector, provider) =>
        this.claimedBy(claims, () =>
          this.registerLanguageFeatureProvider(token, selector, provider),
        ),
      focusEditor: () => this.focus(),
      applyEdits: (edits, timingName, selection) =>
        this.inputSelection.applyFindEdits(edits, timingName, selection),
      startSnippetSession: (stops) => this.inputSelection.startSnippetSession(stops),
    }
  }

  private createDecorationContributionContext(owner: symbol): EditorDecorationContributionContext {
    return {
      decorations: this.decorations,
      hasDocument: () => this.session !== null,
      log: (event) => this.log(event),
      materializeFullText: () => this.materializeFullText(),
      getTextSnapshot: () => this.session?.getTextSnapshot() ?? null,
      getDocumentSyncPoint: () => this.currentDocumentEditChain().point,
      changesSinceDocumentSyncPoint: (point, scope) =>
        this.currentDocumentEditChain().changesSince(point, scope),
      setRangeHighlight: (name, ranges, style) => this.view.setRangeHighlight(name, ranges, style),
      clearRangeHighlight: (name) => this.view.clearRangeHighlight(name),
      setRowDecorations: (sourceId, decorations) =>
        this.setSourceRowDecorations(sourceId, decorations, owner),
      clearRowDecorations: (sourceId) => this.clearSourceRowDecorations(sourceId, owner),
    }
  }

  private createEditorFeatureContributionContext(
    container: HTMLElement,
    owner: symbol,
  ): EditorFeatureContributionContext {
    const claims = this.currentClaims()
    return {
      container,
      scrollElement: this.el,
      contentElement: this.view.contentElement,
      highlightPrefix: this.highlightPrefix,
      hasDocument: () => this.session !== null,
      log: (event) => this.log(event),
      materializeFullText: () => this.materializeFullText(),
      getTextSnapshot: () => this.session?.getTextSnapshot() ?? null,
      getDocumentSyncPoint: () => this.currentDocumentEditChain().point,
      changesSinceDocumentSyncPoint: (point, scope) =>
        this.currentDocumentEditChain().changesSince(point, scope),
      getSelections: () => this.inputSelection.resolveViewSelections(),
      focusEditor: () => this.focus(),
      setSelection: (anchor, head, timingName, options) =>
        this.applyRequestedSelection(anchor, head, timingName, options),
      setSelections: (selections, timingName, revealOffset) =>
        this.applyRequestedSelections(selections, timingName, revealOffset),
      applyEdits: (edits, timingName, selection) =>
        this.inputSelection.applyFindEdits(edits, timingName, selection),
      startSnippetSession: (stops) => this.inputSelection.startSnippetSession(stops),
      setRangeHighlight: (name, ranges, style) => this.view.setRangeHighlight(name, ranges, style),
      clearRangeHighlight: (name) => this.view.clearRangeHighlight(name),
      setRowDecorations: (sourceId, decorations) =>
        this.setSourceRowDecorations(sourceId, decorations, owner),
      clearRowDecorations: (sourceId) => this.clearSourceRowDecorations(sourceId, owner),
      registerCommand: (command, handler) =>
        this.claimedBy(claims, () => this.registerCommandHandler(command, handler)),
      registerFeature: (key, feature) =>
        this.claimedBy(claims, () => this.registerFeature(key, feature)),
      registerProvider: (token, selector, provider) =>
        this.claimedBy(claims, () =>
          this.registerLanguageFeatureProvider(token, selector, provider),
        ),
    }
  }

  private canEditDocument(): boolean {
    if (this.view.isProvisional) return false
    if (!this.document.canEditDocument()) return false
    const session = editorBufferSession(this.session)
    if (!session) return true
    return !getDocumentMutationLeaseState(session.buffer).isLeased
  }

  private recordDetachedTextChange(edits: readonly TextEdit[] | null): void {
    if (editorBufferSession(this.session)) return

    const point = this.detachedEditChain.point
    this.detachedEditChain.record({
      edits,
      logicalRevisionCount: 1,
      logicalRevisionScope: null,
      revisionAfter: point.revision + 1,
      revisionBefore: point.revision,
      textChanged: true,
    })
  }

  private currentDocumentEditChain(): Pick<DocumentEditChain, 'changesSince' | 'point'> {
    const session = editorBufferSession(this.session)
    if (!session) return this.detachedEditChain
    return {
      point: session.buffer.getDocumentSyncPoint(),
      changesSince: (point, scope) => session.buffer.changesSinceDocumentSyncPoint(point, scope),
    }
  }

  private subscribeToBufferSession(session: DocumentSession): void {
    const bufferSession = editorBufferSession(session)
    if (!bufferSession) return

    this.unsubscribeBufferChanges = bufferSession.buffer.subscribe((event) =>
      this.handleBufferChange(bufferSession, event),
    )
    this.unsubscribeLeaseChanges = subscribeDocumentMutationLeaseState(bufferSession.buffer, () =>
      this.syncViewEditability(),
    )
  }

  private handleBufferChange(session: EditorBufferSession, event: EditorTextBufferChange): void {
    if (this.session !== session) return
    const pending = this.pendingBufferChangeOptions.get(event.change.textSnapshot)
    if (event.change.kind !== 'synchronize' && event.sourceViewId !== session.view.viewId) {
      session.view.acceptBufferSelections(markSelectionSetDirty(session.view.getSelections()))
    }
    this.pendingBufferChangeOptions.delete(event.change.textSnapshot)
    const change = {
      ...event.change,
      timings: pending?.change.timings ?? event.change.timings,
      selections: session.view.getSelections(),
    }
    if (isTextSessionChange(change)) this.publishedBufferSnapshots.add(change.textSnapshot)
    this.applyPublishedSessionChange(
      change,
      pending?.totalName ?? 'editor.bufferChange',
      pending?.totalStart ?? nowMs(),
      pending?.options ?? {},
    )
  }

  private disposeBufferSubscriptions(): void {
    this.unsubscribeBufferChanges?.()
    this.unsubscribeLeaseChanges?.()
    this.unsubscribeBufferChanges = null
    this.unsubscribeLeaseChanges = null
  }

  private syncViewEditability(): void {
    const editable = this.canEditDocument()
    this.view.setEditable(editable)
    this.inputSelection.syncNativeInputHandlers(editable)
  }

  private applyRangeDecorations(): void {
    const decorations = this.composedRangeDecorations()
    if (this.textSnapshot.length === 0 || decorations.length === 0) {
      this.clearAppliedRangeDecorations()
      return
    }

    const groups = groupedRangeDecorations(decorations, this.highlightPrefix)
    const names: string[] = []

    for (const group of groups) {
      names.push(group.name)
      this.view.setRangeHighlight(group.name, group.ranges, group.style)
    }

    this.clearStaleAppliedRangeDecorations(new Set(names))
    this.appliedRangeDecorationNames = names
  }

  private clearAppliedRangeDecorations(): void {
    for (const name of this.appliedRangeDecorationNames) this.view.clearRangeHighlight(name)
    this.appliedRangeDecorationNames = []
  }

  private clearStaleAppliedRangeDecorations(nextNames: ReadonlySet<string>): void {
    for (const name of this.appliedRangeDecorationNames) {
      if (!nextNames.has(name)) this.view.clearRangeHighlight(name)
    }
  }

  private directRangeDecorations(): readonly EditorRangeDecoration[] {
    return (
      this.displayProjections.get('rangeDecorations', DIRECT_RANGE_DECORATION_OWNER)?.value ?? []
    )
  }

  private composedRangeDecorations(): readonly EditorRangeDecoration[] {
    return rangeDecorationsWithProjectionStacking(
      this.displayProjections.values('rangeDecorations').map((projection) => projection.value),
    )
  }

  private retagDisplayProjectionSources(): void {
    const source = this.currentDisplayProjectionSource()
    this.displayProjections.retagKind('folds', source)
    this.displayProjections.retagKind('rangeDecorations', source)
    this.displayProjections.retagKind('rowDecorations', source)
    this.displayProjections.retagKind('injectedRows', source)
    this.displayProjections.retagKind('gutters', source)
  }

  private currentDisplayProjectionSource(): EditorDisplayProjectionSource {
    return {
      documentId: this.documentId,
      documentVersion: this.documentVersion,
      textVersion: this.textVersion,
    }
  }

  private createViewSnapshot(): EditorViewSnapshot {
    const viewState = this.view.getState()
    const textSnapshot = this.textSnapshot
    const viewport = {
      scrollTop: viewState.scrollTop,
      scrollRow: viewState.scrollRow,
      scrollLeft: viewState.scrollLeft,
      scrollHeight: viewState.scrollHeight,
      scrollWidth: viewState.scrollWidth,
      clientHeight: viewState.viewportHeight,
      clientWidth: viewState.viewportWidth,
      borderBoxHeight: viewState.borderBoxHeight,
      borderBoxWidth: viewState.borderBoxWidth,
      visibleRange: viewState.visibleRange,
    }

    // One view per text version: repeat snapshots share the same lazily
    // materialized array instead of rebuilding it.
    const cachedView = this.lineStartsViewCache
    const lineStartsView =
      cachedView && cachedView.textVersion === this.textVersion
        ? cachedView.view
        : new LineStartsView(textSnapshot)
    this.lineStartsViewCache = {
      textVersion: this.textVersion,
      view: lineStartsView,
    }
    const sync = this.currentDocumentEditChain()
    const deferredMarkerSource = this.view.captureDeferredFoldMarkerSource()
    let visibleFoldMarkers: ReadonlyMap<number, VirtualizedFoldMarker> | undefined
    const visibleRows: EditorVisibleRowSnapshot[] = viewState.mountedRows.map((row) => {
      const snapshotRow: EditorVisibleRowSnapshot = {
        index: row.index,
        bufferRow: row.bufferRow,
        source: row.source,
        injectedTextRowId: row.injectedTextRowId,
        metadata: row.metadata,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
        text: row.text,
        kind: row.kind,
        primaryText: row.source === 'document',
        firstWrapSegment: row.primaryText,
        top: row.top,
        height: row.height,
        leftSpacerWidth: row.leftSpacerWidth,
        contentCursorLine: row.cursorLineContentActive,
        gutterNumberCursorLine: row.gutterNumberCursorLine,
        gutterCursorLineBackgroundLaneIds: [...row.gutterCursorLineBackgroundLaneIds],
        mountedPaintSupport: row.mountedPaintSupport,
        chunks: row.chunks.map((chunk) => ({
          sourceStartOffset: chunk.startOffset,
          sourceEndOffset: chunk.endOffset,
          rowLocalStart: chunk.localStart,
          rowLocalEnd: chunk.localEnd,
          text: chunk.text,
          mountedPaint: chunk.mountedPaint,
        })),
        foldMarker: row.foldMarker,
      }
      if (!deferredMarkerSource || !snapshotRow.firstWrapSegment) return snapshotRow
      Object.defineProperty(snapshotRow, 'foldMarker', {
        enumerable: true,
        get: () => {
          visibleFoldMarkers ??= deferredMarkerSource.readRows(
            visibleRows
              .filter((visibleRow) => visibleRow.firstWrapSegment)
              .map((visibleRow) => visibleRow.bufferRow),
          )
          return visibleFoldMarkers.get(snapshotRow.bufferRow) ?? null
        },
      })
      return snapshotRow
    })
    return createEditorViewSnapshot(
      {
        documentId: this.documentId,
        languageId: this.languageId,
        theme: this.resolvedTheme(),
        textSnapshot,
        textVersion: this.textVersion,
        initialHighlightStatus: this.syntax.initialHighlightStatus,
        syntaxStatus: this.syntax.status,
        geometryCommitted: !this.view.isProvisional,
        documentSyncPoint: sync.point,
        changesSinceDocumentSyncPoint: (
          point: DocumentSyncPoint,
          scope: DocumentLogicalRevisionScope | null,
        ) => sync.changesSince(point, scope),
        // Materializing per snapshot costs O(lines) on every keystroke for
        // large documents; consumers that need the array pay lazily instead.
        get lineStarts() {
          return lineStartsView.toArray()
        },
        lineStartsView,
        tokens: this.tokens,
        brackets: this.brackets,
        selections: this.inputSelection.resolveViewSelections(),
        metrics: viewState.metrics,
        lineCount: viewState.lineCount,
        contentWidth: viewState.contentWidth,
        totalHeight: viewState.totalHeight,
        gutterWidth: viewState.gutterWidth,
        gutterLayout: viewState.gutterLayout,
        // The width in effect, not the one the view lays tab characters out on: contributions divide
        // an indent column by this to get a nesting level, so a guide has to be drawn one per level
        // the document actually writes.
        tabSize: this.tabSize,
        get foldMarkers() {
          return viewState.foldMarkers
        },
        visibleRows,
        viewport,
      },
      { paintPending: true },
    )
  }

  private readonly typedTextListeners = new Set<(text: string) => void>()

  private addTypedTextListener(listener: (text: string) => void): EditorDisposable {
    this.typedTextListeners.add(listener)
    return this.claimForContribution(disposableOnce(() => this.typedTextListeners.delete(listener)))
  }

  private notifyTyped(text: string): void {
    for (const listener of [...this.typedTextListeners]) listener(text)
  }

  private readonly scrollListeners = new Set<(position: Required<EditorScrollPosition>) => void>()
  private readonly contentHeightListeners = new Set<(height: number) => void>()
  private reportedScroll: Required<EditorScrollPosition> | null = null

  private reportScroll(): void {
    if (this.scrollListeners.size === 0) return
    const { scrollTop: top, scrollLeft: left } = this.view.getState()
    const reported = this.reportedScroll
    if (reported?.top === top && reported.left === left) return

    this.reportedScroll = { top, left }
    for (const listener of [...this.scrollListeners]) this.deliverScroll(listener, { top, left })
  }

  private deliverScroll(
    listener: (position: Required<EditorScrollPosition>) => void,
    position: Required<EditorScrollPosition>,
  ): void {
    try {
      listener(position)
    } catch (error) {
      this.log({
        action: 'editor.scroll_listener_failed',
        level: 'error',
        error: editorLogError(error),
      })
    }
  }

  private readonly reservedWidthListeners = new Set<(side: EditorOverlaySide) => void>()
  private readonly pendingReservedWidthSides: EditorOverlaySide[] = []
  private notifyingReservedWidth = false

  private addReservedWidthListener(listener: (side: EditorOverlaySide) => void): EditorDisposable {
    this.reservedWidthListeners.add(listener)
    return this.claimForContribution(
      disposableOnce(() => this.reservedWidthListeners.delete(listener)),
    )
  }

  // A change made by a listener queues behind the one being delivered; nothing is dropped.
  private notifyReservedWidth(side: EditorOverlaySide): void {
    this.pendingReservedWidthSides.push(side)
    if (this.notifyingReservedWidth) return

    this.notifyingReservedWidth = true
    try {
      for (let next = this.pendingReservedWidthSides.shift(); next;) {
        this.deliverReservedWidth(next)
        next = this.pendingReservedWidthSides.shift()
      }
    } finally {
      this.notifyingReservedWidth = false
    }
  }

  private deliverReservedWidth(side: EditorOverlaySide): void {
    for (const listener of [...this.reservedWidthListeners]) {
      try {
        listener(side)
      } catch (error) {
        this.logContributionFailure('view', 'reserved-width', error)
      }
    }
  }

  private readonly nonCaretRowFilters = new Set<(bufferRow: number) => boolean>()

  private registerNonCaretRows(isNonCaret: (bufferRow: number) => boolean): EditorDisposable {
    this.nonCaretRowFilters.add(isNonCaret)
    return this.claimForContribution(
      disposableOnce(() => this.nonCaretRowFilters.delete(isNonCaret)),
    )
  }

  private isNonCaretOffset(offset: number): boolean {
    if (this.nonCaretRowFilters.size === 0) return false
    const snapshot = this.session?.getSnapshot()
    if (!snapshot) return false

    const row = offsetToPoint(snapshot, offset).row
    for (const isNonCaret of [...this.nonCaretRowFilters]) {
      if (this.rowRefusedBy(isNonCaret, row)) return true
    }
    return false
  }

  private rowRefusedBy(isNonCaret: (bufferRow: number) => boolean, row: number): boolean {
    try {
      return isNonCaret(row)
    } catch (error) {
      this.logContributionFailure('view', 'non-caret-row', error)
      return false
    }
  }

  private readonly pressParticipants = new Set<EditorPressParticipant>()

  private registerPressParticipant(participant: EditorPressParticipant): EditorDisposable {
    this.pressParticipants.add(participant)
    return this.claimForContribution(
      disposableOnce(() => this.pressParticipants.delete(participant)),
    )
  }

  private claimPress(event: MouseEvent): boolean {
    for (const participant of [...this.pressParticipants]) {
      if (this.pressClaimedBy(participant, event)) return true
    }
    return false
  }

  private pressClaimedBy(participant: EditorPressParticipant, event: MouseEvent): boolean {
    try {
      return participant(event)
    } catch (error) {
      this.logContributionFailure('view', 'press', error)
      return false
    }
  }

  private notifyViewContributions(
    kind: EditorViewContributionUpdateKind,
    change?: DocumentSessionChange | null,
    also: readonly EditorViewContributionUpdateKind[] = [],
  ): void {
    if (!this.viewContributions || this.committingPresentation) return
    if (this.view.isProvisional) {
      if (this.invalidateIncompatibleSnapshot()) return
      this.commitSnapshotIfReady()
      return
    }
    this.viewContributions.notify(kind, change ?? null, also)
  }

  private requestViewUpdate(contribution: EditorViewContribution | null): void {
    if (!this.viewContributions || this.committingPresentation) return
    if (this.view.isProvisional) {
      this.notifyViewContributions('layout', null)
      return
    }
    this.viewContributions.requestUpdate(contribution)
  }

  private notifyEditorFeatureContributions(change: DocumentSessionChange | null): void {
    for (const contribution of Array.from(this.decorationContributions))
      this.notifyContributionChange(contribution, change, 'decoration')

    for (const contribution of Array.from(this.editorFeatureContributions))
      this.notifyContributionChange(contribution, change, 'feature')
  }

  private notifyContributionChange(
    contribution: EditorDecorationContribution | EditorFeatureContribution,
    change: DocumentSessionChange | null,
    kind: 'decoration' | 'feature',
  ): void {
    try {
      contribution.handleEditorChange?.(change)
    } catch (error) {
      this.removeFailedEditorContribution(contribution, kind, error)
    }
  }

  private removeFailedEditorContribution(
    contribution: EditorDecorationContribution | EditorFeatureContribution,
    kind: 'decoration' | 'feature',
    error: unknown,
  ): void {
    this.logContributionFailure(kind, 'update', error)
    if (kind === 'decoration') {
      this.removeFailedDecorationContribution(contribution as EditorDecorationContribution)
      return
    }

    this.removeFailedFeatureContribution(contribution as EditorFeatureContribution)
  }

  private removeFailedDecorationContribution(contribution: EditorDecorationContribution): void {
    removeArrayItem(this.decorationContributions, contribution)
    deleteMapValue(this.decorationContributionsByProvider, contribution)
    this.disposeContributionSafely(contribution, 'decoration')
    this.clearContributionRowDecorationSources(contribution)
  }

  private removeFailedFeatureContribution(contribution: EditorFeatureContribution): void {
    removeArrayItem(this.editorFeatureContributions, contribution)
    deleteMapValue(this.editorFeatureContributionsByProvider, contribution)
    this.disposeContributionSafely(contribution, 'feature')
    this.clearContributionRowDecorationSources(contribution)
  }

  private registerCommandHandler(
    command: EditorAnyCommandId,
    handler: EditorCommandHandler,
  ): EditorDisposable {
    return this.claimForContribution(this.commandRouter.registerCommandHandler(command, handler))
  }

  private registerFeature<T>(token: EditorCapabilityToken<T>, feature: T): EditorDisposable {
    if (this.editorFeatureTokensById.has(token.id)) {
      throw new Error(`Editor feature already registered: ${token.id}`)
    }

    this.editorFeatures.set(token, feature)
    this.editorFeatureTokensById.set(token.id, token)

    return this.claimForContribution(disposableOnce(() => this.unregisterFeature(token, feature)))
  }

  private registerLanguageFeatureProvider<T>(
    token: EditorLanguageFeatureToken<T>,
    selector: EditorLanguageFeatureSelector,
    provider: T,
  ): EditorDisposable {
    return this.claimForContribution(this.languageFeatures.register(token, selector, provider))
  }

  private unregisterFeature<T>(token: EditorCapabilityToken<T>, feature: T): void {
    if (this.editorFeatures.get(token) !== feature) return

    this.editorFeatures.delete(token)
    this.editorFeatureTokensById.delete(token.id)
  }

  private getFeature<T>(token: EditorCapabilityToken<T>): T | null {
    if (this.editorFeatures.has(token)) {
      return (this.editorFeatures.get(token) as T | undefined) ?? null
    }

    const registeredToken = this.editorFeatureTokensById.get(token.id)
    if (!registeredToken) return null

    return (this.editorFeatures.get(registeredToken) as T | undefined) ?? null
  }

  private findFeature(): EditorFindFeature | null {
    return this.getFeature(EDITOR_FIND_FEATURE)
  }

  private reserveOverlayWidth(side: EditorOverlaySide, width: number): void {
    if (!this.view.reserveOverlayWidth(side, width)) return

    this.notifyViewContributions('layout', null)
  }

  rowAtPoint(clientX: number, clientY: number): EditorPointHit | null {
    return this.view.rowAtPoint(clientX, clientY)
  }

  markerAtPoint(clientX: number, clientY: number): EditorMarkerHit | null {
    return this.view.markerAtPoint(clientX, clientY)
  }

  textOffsetFromPoint(clientX: number, clientY: number): number | null {
    return this.view.textOffsetFromPoint(clientX, clientY)
  }

  private readonly readViewport = (): EditorViewportSnapshot => this.view.getViewport()

  private readonly handleViewportScroll = (): void => {
    if (this.committingPresentation || this.view.isProvisional) return
    this.reportScroll()
    this.viewContributions?.notifyViewport(this.readViewport)
  }

  private readonly handleViewportChange = (): void => {
    this.updateSyntaxScrollTracking()
    const visibleRange = this.visibleSyntaxRange()
    this.syntax.refreshVisibleRange(this.documentVersion, {
      delayMs: 0,
      range: visibleRange,
    })
    this.syntax.prefetchVisibleRange(this.documentVersion, this.visibleSyntaxPrefetchRange(), {
      delayMs: VISIBLE_SYNTAX_SCROLL_DELAY_MS,
    })
    this.syntax.warmSyntaxAroundRange(this.documentVersion, visibleRange, {
      delayMs: BACKGROUND_SYNTAX_WARM_DELAY_MS,
    })
    this.notifyViewContributions('viewport', null)
    this.log({
      action: 'editor.viewport.changed',
      level: 'debug',
      syntax: {
        visibleRange,
      },
      viewport: this.viewportLogContext(),
    })
  }

  private visibleSyntaxRange(): EditorSyntaxRange | null {
    return this.syntaxRangeAroundMountedRows(
      VISIBLE_SYNTAX_OVERSCAN_CHARS,
      VISIBLE_SYNTAX_OVERSCAN_CHARS,
    )
  }

  private visibleSyntaxPrefetchRange(): EditorSyntaxRange | null {
    const viewState = this.view.getState()
    const rows = viewState.mountedRows
    const first = rows[0]
    const last = rows.at(-1)
    if (!first || !last) return null

    const lead = this.visibleSyntaxLeadChars(first, last)
    const before = this.syntaxScrollDirection <= 0 ? lead : VISIBLE_SYNTAX_TRAILING_CHARS
    const after = this.syntaxScrollDirection >= 0 ? lead : VISIBLE_SYNTAX_TRAILING_CHARS

    return this.syntaxRangeAroundMountedRows(before, after)
  }

  private syntaxRangeAroundMountedRows(before: number, after: number): EditorSyntaxRange | null {
    if (this.view.isProvisional) {
      const range = this.view.preparedVisibleRange()
      return {
        startIndex: Math.max(0, range.startIndex - before),
        endIndex: Math.min(this.textSnapshot.length, range.endIndex + after),
      }
    }
    const rows = this.view.getState().mountedRows
    const first = rows[0]
    const last = rows.at(-1)
    if (!first || !last) return null

    return {
      startIndex: Math.max(0, first.startOffset - before),
      endIndex: Math.min(this.textSnapshot.length, last.endOffset + after),
    }
  }

  private updateSyntaxScrollTracking(): void {
    const scrollTop = this.view.getState().scrollTop
    const previousScrollTop = this.lastSyntaxScrollTop
    this.lastSyntaxScrollTop = scrollTop
    if (previousScrollTop === null) {
      this.syntaxScrollDeltaPx = 0
      this.syntaxScrollDirection = 0
      return
    }

    const delta = scrollTop - previousScrollTop
    this.syntaxScrollDeltaPx = Math.abs(delta)
    this.syntaxScrollDirection = syntaxScrollDirection(delta)
  }

  private visibleSyntaxLeadChars(
    first: { readonly startOffset: number; readonly top: number },
    last: {
      readonly endOffset: number
      readonly top: number
      readonly height: number
    },
  ): number {
    const textSpan = Math.max(1, last.endOffset - first.startOffset)
    const pixelSpan = Math.max(1, last.top + last.height - first.top)
    const velocityLead = Math.ceil(this.syntaxScrollDeltaPx * (textSpan / pixelSpan) * 2)
    return clamp(
      Math.max(VISIBLE_SYNTAX_LEAD_CHARS, velocityLead),
      VISIBLE_SYNTAX_LEAD_CHARS,
      Math.min(VISIBLE_SYNTAX_MAX_LEAD_CHARS, this.textSnapshot.length),
    )
  }

  private applySessionChange(
    change: DocumentSessionChange,
    totalName = 'editor.change',
    totalStart = nowMs(),
    options: SessionChangeOptions = {},
  ): void {
    if (editorBufferSession(this.session) && isTextSessionChange(change)) {
      if (this.operation?.amend(change, totalName, totalStart, options)) return
      if (this.publishedBufferSnapshots.has(change.textSnapshot)) return
      this.pendingBufferChangeOptions.set(change.textSnapshot, {
        change,
        totalName,
        totalStart,
        options,
      })
      return
    }
    this.applyPublishedSessionChange(change, totalName, totalStart, options)
  }

  private applyPublishedSessionChange(
    change: DocumentSessionChange,
    totalName: string,
    totalStart: number,
    options: SessionChangeOptions,
  ): void {
    const scope = this.beginPerformanceView()
    try {
      this.updateSessionView(change, totalName, totalStart, options)
    } finally {
      endEditorPerformanceScope(scope)
    }
  }

  private updateSessionView(
    change: DocumentSessionChange,
    totalName: string,
    totalStart: number,
    options: SessionChangeOptions,
  ): void {
    if (change.edits.length > 0 && editorPerformanceDiagnosticsEnabled()) {
      recordEditorPerformanceDiagnostic('editor.document.committed', () => ({
        kind: change.kind,
        editCount: change.edits.length,
        timingName: totalName,
      }))
    }
    this.withOperation((operation) => {
      this.syntax.projectCacheForChange(change)
      const renderStart = nowMs()
      measureEditorPerformance('editor.renderSessionChange', () => this.renderSessionChange(change))
      invalidateRowRectMeasurements()
      operation.record(
        appendTiming(change, 'editor.render', renderStart),
        totalName,
        totalStart,
        options,
      )
    })
  }

  private withOperation<T>(run: (operation: EditorOperation) => T): T {
    const open = this.operation
    if (open) return run(open)

    const operation = new EditorOperation()
    this.operation = operation
    // Read before the pass runs: by the time it ends the caret has been revealed
    // somewhere else, and it is the view the user is leaving that cursor history
    // has to be able to hand back.
    this.cursorHistoryBefore = this.captureCursorHistoryBefore()
    beginRowRectMeasurements()
    const performancePass = beginEditorPerformancePass()
    try {
      return run(operation)
    } finally {
      // Cleared before the flush so a listener that edits from inside it opens
      // a pass of its own rather than appending to one nobody will drain again,
      // and in a finally so a pass that throws part-way still closes instead of
      // leaving the editor wedged inside it.
      this.operation = null
      markEditorPerformanceFlush(performancePass)
      try {
        this.flushOperation(operation)
      } finally {
        endRowRectMeasurements()
        endEditorPerformancePass(performancePass)
      }
    }
  }

  private runDocumentReplacement<T>(run: () => T): T {
    if (this.operationFlushDepth > 0) return this.runInOperation(run)
    return run()
  }

  private flushOperation(operation: EditorOperation): void {
    const scope = this.beginPerformanceView()
    this.operationFlushDepth += 1
    try {
      this.flushViewOperation(operation)
    } finally {
      this.operationFlushDepth -= 1
      endEditorPerformanceScope(scope)
    }
  }

  private beginPerformanceView(): ReturnType<typeof beginEditorPerformanceView> {
    if (!editorPerformanceDiagnosticsEnabled()) return null

    return beginEditorPerformanceView(
      this.highlightPrefix,
      this.documentId,
      this.documentVersion,
      editorBufferSession(this.session)?.buffer.getRevision() ?? this.textVersion,
    )
  }

  private flushViewOperation(operation: EditorOperation): void {
    const flush = operation.flush()
    if (!flush) return
    const documentVersion = this.documentVersion

    // Ahead of the fan-out below, because a listener that moves the caret from
    // inside it opens a pass of its own and that pass belongs after this one.
    this.recordCursorHistory(flush)

    // Every range this pass moved is moved before anything outside the editor is
    // told about it: a listener that edits from inside the fan-out opens a pass
    // of its own that projects the moment it closes, and edits still waiting here
    // would then be applied over a range that later edit has already carried.
    for (const pending of flush.changes) this.decorations.applyEdits(pending.change.edits)

    let timedChange = flush.latest.change
    const suggestionMoved = this.inputSelection.syncInlineSuggestion(timedChange.snapshot)
    if (suggestionMoved || this.editRederivesInlineMap(flush.changes)) this.refreshInlineMap()
    if (flush.revealOffset !== null) {
      const revealStart = nowMs()
      if (flush.revealAffinity) {
        this.view.revealCaret(flush.revealOffset, flush.revealAffinity, flush.revealBlock)
      } else {
        this.view.revealOffset(flush.revealOffset, flush.revealBlock)
      }
      invalidateRowRectMeasurements()
      timedChange = appendTiming(timedChange, 'editor.reveal', revealStart)
    }

    this.recordJumpHistory()

    if (flush.syncDomSelection) {
      const selectionStart = nowMs()
      // Its `selection` rides on this pass's notification below, so one operation is one pass.
      this.inputSelection.syncDomSelection({ notify: false })
      timedChange = appendTiming(timedChange, 'editor.syncDomSelection', selectionStart)
    }
    const finalChange = appendTiming(timedChange, flush.latest.totalName, flush.latest.totalStart)
    // Queue syntax before listeners can commit the next document generation.
    for (const pending of flush.changes) {
      if (!this.isCurrentSecondaryDocument(documentVersion)) return
      const recorded = pending === flush.latest ? finalChange : pending.change
      this.logSessionChange(recorded, pending.totalName)
      this.sessionChangeVersion += 1
      this.scheduleSecondarySessionChangeWork(
        recorded,
        pending.totalName,
        this.sessionChangeVersion,
        documentVersion,
      )
    }
    const passChange = coalescedPassChange(flush, finalChange)
    this.sessionOptions.onChange?.(passChange)
    measureEditorPerformance('editor.notifyViewContributions', () =>
      this.notifyViewContributions(
        flush.contributionKind,
        passChange,
        flush.syncDomSelection ? ['selection'] : [],
      ),
    )
    measureEditorPerformance('editor.notifyChangeWithTiming', () =>
      this.notifyChangeWithTiming(passChange),
    )
    if (editorPerformanceDiagnosticsEnabled()) {
      recordEditorPerformanceDiagnostic('editor.view.updated', () => ({
        kind: passChange.kind,
        editCount: passChange.edits.length,
        timingName: flush.latest.totalName,
      }))
    }
  }

  /**
   * A pass either moved the carets or changed the text; only the first is a
   * place worth being able to return to, and the second makes every place
   * already recorded meaningless.
   */
  private recordCursorHistory(flush: EditorOperationFlush): void {
    // A restore is itself a pass of caret moves. Recording it would make going
    // back and forward the same single step.
    if (this.restoringCursorHistory) return

    const before = this.cursorHistoryBefore
    const history = this.cursorHistoryForSession()
    if (flush.changes.some((pending) => pending.change.edits.length > 0)) {
      history.clear()
      return
    }
    // A pass that swapped the document leaves a reading of the one before it,
    // which addresses nothing here.
    if (!before || before.session !== this.cursorHistorySession) return
    // Plenty of passes flush without moving a caret — a decoration update, a
    // theme change, an arrow key at the end of the document. Recording those
    // spends a step of history that then walks back to where the user already
    // is, and fills the stack with steps that look broken when taken.
    if (sameCursorSelections(before.entry, this.captureCursorHistoryEntry())) return

    history.record(before.entry)
  }

  private cursorHistoryForSession(): CursorHistory {
    // Entries are offsets into one document; against another they address text
    // that has nothing to do with them.
    if (this.cursorHistorySession !== this.session) {
      this.cursorHistorySession = this.session
      this.cursorHistory.clear()
      this.jumpHistory.clear()
      this.pendingJump = null
      this.pendingPointerJump = null
    }

    return this.cursorHistory
  }

  private captureCursorHistoryBefore(): {
    readonly session: DocumentSession
    readonly entry: CursorHistoryEntry
  } | null {
    const session = this.session
    if (!session) return null

    return { entry: this.captureCursorHistoryEntry(), session }
  }

  private captureCursorHistoryEntry(): CursorHistoryEntry {
    const scrollPosition = this.getScrollPosition()
    const selectionSet = this.session?.getSelections()
    return {
      lastAddedIndex: selectionSet ? lastAddedSelectionIndex(selectionSet) : 0,
      scrollLeft: scrollPosition.left,
      scrollTop: scrollPosition.top,
      selections: this.inputSelection.resolveViewSelections().map((selection) => ({
        anchor: selection.anchorOffset,
        head: selection.headOffset,
        affinity: selection.affinity,
      })),
    }
  }

  private captureJump(): JumpLocation | null {
    const session = this.session
    if (!session) return null
    const cursor = this.captureCursorHistoryEntry()
    const rows = this.view.getState().mountedRows
    const first = rows.find((row) => row.top + row.height > cursor.scrollTop)
    return captureJumpLocation(
      session.getSnapshot(),
      cursor,
      first?.startOffset ?? 0,
      cursor.scrollTop - (first?.top ?? 0),
    )
  }

  private beginJump(): void {
    this.cursorHistoryForSession()
    if (this.pendingJump) return
    const location = this.captureJump()
    if (!location || !this.session) return
    this.pendingJump = { session: this.session, location }
  }

  private recordJumpHistory(): void {
    const pending = this.pendingJump
    this.pendingJump = null
    if (!pending || pending.session !== this.session) return
    const destination = this.captureJump()
    if (!destination) return
    this.jumpHistory.record(pending.session.getSnapshot(), pending.location, destination)
  }

  private applyJumpHistory(direction: 'back' | 'forward'): boolean {
    this.cursorHistoryForSession()
    const current = this.captureJump()
    if (!current || !this.session) return false
    const entry = this.jumpHistory.move(this.session.getSnapshot(), direction, current)
    if (!entry) return false
    this.runInOperation(() =>
      this.applyRequestedSelections(
        entry.selections,
        'editor.jumpHistory',
        undefined,
        entry.lastAddedIndex,
      ),
    )
    this.applyScrollPosition({
      top: this.view.topForOffset(entry.viewportOffset) + entry.topDelta,
      left: entry.scrollLeft,
    })
    return true
  }

  private applyCursorHistory(direction: 'undo' | 'redo'): boolean {
    if (!this.session) return false

    const current = this.captureCursorHistoryEntry()
    const history = this.cursorHistoryForSession()
    const entry = direction === 'undo' ? history.undo(current) : history.redo(current)
    if (!entry) return false

    const timingName = direction === 'undo' ? 'editor.cursorUndo' : 'editor.cursorRedo'
    this.restoringCursorHistory = true
    try {
      this.runInOperation(() => {
        this.applyRequestedSelections(entry.selections, timingName, undefined, entry.lastAddedIndex)
      })
    } finally {
      this.restoringCursorHistory = false
      // An enclosing pass has now walked the stack rather than moved the caret
      // once, so where it started is not a place to be handed back to.
      this.cursorHistoryBefore = null
    }
    // After the pass, so the recorded position is the one that survives rather
    // than whatever settling the restored carets scrolled the view to.
    this.applyScrollPosition({ top: entry.scrollTop, left: entry.scrollLeft })
    return true
  }

  private renderSessionChange(change: DocumentSessionChange): void {
    const edit = change.edits[0]
    if (change.kind === 'selection' || change.kind === 'synchronize' || change.kind === 'none') {
      return
    }

    const renderedSnapshot = getPieceTreeSnapshot(this.textSnapshot)
    if (renderedSnapshot === change.snapshot) return
    const transaction = change.transaction
    const expectedSnapshot =
      change.kind === 'undo' ? transaction?.snapshotAfter : transaction?.snapshotBefore
    if (renderedSnapshot && expectedSnapshot && renderedSnapshot !== expectedSnapshot) {
      recordEditorPerformanceDiagnostic('editor.document.projectionReset', {
        kind: change.kind,
        renderedLength: renderedSnapshot.length,
        expectedLength: expectedSnapshot.length,
        targetLength: change.snapshot.length,
      })
      this.renderContent(change.textSnapshot)
      return
    }

    if (edit && change.edits.length === 1) {
      const previousTextSnapshot = this.textSnapshot
      const syntaxFolds = this.syntaxFoldProjection()
      const foldProjection = measureEditorPerformance(
        'editor.projectSyntaxFolds',
        () => projectSyntaxFoldsThroughEdit(syntaxFolds, edit, previousTextSnapshot),
        () => ({ foldCount: syntaxFolds.length }),
      )
      const projectedTokens = measureEditorPerformance(
        'editor.projectTokens',
        () => projectTokensThroughEdit(this.tokens, edit, previousTextSnapshot),
        () => ({ tokenCount: this.tokens.length }),
      )
      const rowDecorationsProjected = this.projectRowDecorationsThroughLineEdit(
        edit,
        previousTextSnapshot,
        this.view.getLineStartsView(),
      )
      const manualFolds = projectSyntaxFoldsThroughEdit(
        this.manualFolds,
        edit,
        previousTextSnapshot,
      )
      if (manualFolds) this.manualFolds = manualFolds
      if (foldProjection) this.setSyntaxFoldProjection(foldProjection)
      this.renderEdit(edit, projectedTokens, documentSessionChangeTextSnapshot(change), false)
      this.scheduleFallbackFoldProjection()
      if (rowDecorationsProjected) this.view.setRowDecorations(this.composedRowDecorations())
      return
    }

    if (edit) {
      this.renderSessionBatch(
        createTextEditBatch(this.textSnapshot, change.textSnapshot, change.edits),
      )
      return
    }

    this.renderContent(change.textSnapshot)
  }

  private renderSessionBatch(batch: TextEditBatch): void {
    const folds = projectSyntaxFoldsThroughEdits(this.syntaxFoldProjection(), batch)
    const manualFolds = projectSyntaxFoldsThroughEdits(this.manualFolds, batch)
    const tokens = measureEditorPerformance('editor.projectTokens', () =>
      projectTokensThroughEdits(this.tokens, batch),
    )
    this.view.runAtomicRender(() => {
      this.document.setRenderedTextSnapshot(batch.after)
      this.recordDetachedTextChange(batch.edits)
      this.retagDisplayProjectionSources()
      measureEditorPerformance('editor.view.applyEditBatch', () => this.view.applyEditBatch(batch))
      this.syncInjectedTextRows()
      if (manualFolds) this.manualFolds = manualFolds
      if (folds) this.setSyntaxFoldProjection(folds)
      this.fallbackFolds.update(batch)
      this.scheduleFallbackFoldProjection()
      if (this.projectRowDecorationsThroughBatch(batch)) {
        this.view.setRowDecorations(this.composedRowDecorations())
      }
      this.adoptTokens(tokens, false)
    })
  }

  private logSessionChange(change: DocumentSessionChange, timingName: string): void {
    this.log({
      action: 'editor.session.changed',
      level: sessionChangeLogLevel(change),
      change: {
        canRedo: change.canRedo,
        canUndo: change.canUndo,
        editCount: change.edits.length,
        edits: summarizeTextEdits(change.edits),
        isDirty: change.isDirty,
        kind: change.kind,
        selectionCount: change.selections.selections.length,
        textLength: change.snapshot.length,
        timingName,
        timings: change.timings,
        transaction: change.transaction
          ? {
              intent: change.transaction.metadata.intent,
              source: change.transaction.metadata.source,
              undoGroup: change.transaction.metadata.undoGroup ?? null,
            }
          : null,
      },
    })
  }

  private viewportLogContext(): Record<string, unknown> {
    const viewState = this.view.getState()
    return {
      clientHeight: viewState.viewportHeight,
      clientWidth: viewState.viewportWidth,
      contentWidth: viewState.contentWidth,
      lineCount: viewState.lineCount,
      mountedRowCount: viewState.mountedRows.length,
      scrollHeight: viewState.scrollHeight,
      scrollLeft: viewState.scrollLeft,
      scrollTop: viewState.scrollTop,
      scrollWidth: viewState.scrollWidth,
      totalHeight: viewState.totalHeight,
      visibleRange: viewState.visibleRange,
    }
  }

  private notifyChange(change: DocumentSessionChange | null): void {
    this.notifyEditorFeatureContributions(change)
    this.options.onChange?.(this.getState(), change)
  }

  private notifyChangeWithTiming(change: DocumentSessionChange): void {
    const notifyStart = nowMs()
    const state = this.getState()
    const timedChange = appendTiming(change, 'editor.notify', notifyStart)
    this.options.onChange?.(state, timedChange)
  }

  private refreshSyntax(
    documentVersion: number,
    change: DocumentSessionChange | null,
    options: { readonly delayMs?: number } = {},
  ): void {
    // A new document: edit-triggered replacements are derived from its text at once, and the old
    // document's syntax-derived ones go.
    if (!change) this.refreshInlineMap('drop')
    this.syntax.refresh(documentVersion, change, options)
  }

  private scheduleSecondarySessionChangeWork(
    change: DocumentSessionChange,
    timingName: string,
    sessionChangeVersion: number,
    documentVersion: number,
  ): void {
    if (!this.shouldDeferSecondarySessionWork(change, timingName)) {
      this.runSecondarySessionChangeWork(documentVersion, change)
      return
    }

    this.secondaryWork.schedule({
      key: 'editor.syntaxRefresh',
      delayMs: RAPID_INPUT_SECONDARY_WORK_DELAY_MS,
      maxDelayMs: RAPID_INPUT_SECONDARY_WORK_MAX_DELAY_MS,
      version: sessionChangeVersion,
      isCurrent: (version) =>
        version === this.sessionChangeVersion && this.isCurrentSecondaryDocument(documentVersion),
      run: traceEditorPerformanceTask('editor.secondary.syntax', () =>
        measureEditorPerformance('editor.refreshSyntax', () =>
          this.refreshSyntax(documentVersion, change, { delayMs: 0 }),
        ),
      ),
    })
    this.secondaryWork.schedule({
      key: 'editor.featureContributions',
      delayMs: RAPID_INPUT_SECONDARY_WORK_DELAY_MS,
      maxDelayMs: RAPID_INPUT_SECONDARY_WORK_MAX_DELAY_MS,
      version: sessionChangeVersion,
      isCurrent: (version) =>
        version === this.sessionChangeVersion && this.isCurrentSecondaryDocument(documentVersion),
      run: traceEditorPerformanceTask('editor.secondary.features', () =>
        measureEditorPerformance('editor.notifyEditorFeatureContributions', () =>
          this.notifyEditorFeatureContributions(change),
        ),
      ),
    })
  }

  private isCurrentSecondaryDocument(documentVersion: number): boolean {
    return this.session !== null && documentVersion === this.documentVersion
  }

  private runSecondarySessionChangeWork(
    documentVersion: number,
    change: DocumentSessionChange,
  ): void {
    measureEditorPerformance('editor.refreshSyntax', () =>
      this.refreshSyntax(documentVersion, change),
    )
    measureEditorPerformance('editor.notifyEditorFeatureContributions', () =>
      this.notifyEditorFeatureContributions(change),
    )
  }

  private shouldDeferSecondarySessionWork(
    change: DocumentSessionChange,
    timingName: string,
  ): boolean {
    if (change.kind === 'selection' || change.kind === 'synchronize' || change.kind === 'none') {
      return false
    }
    return RAPID_INPUT_TIMING_NAMES.has(timingName)
  }

  private handleFoldToggle = (marker: VirtualizedFoldMarker): void => {
    if (!this.foldState.toggle(marker)) return

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.fold.toggled',
      level: 'info',
      fold: foldLogContext(marker),
    })
  }

  private applyFoldCommand(command: EditorFoldCommandId): boolean {
    this.flushFallbackFoldProjection()
    if (command === 'editor.foldAll') return this.foldAll()
    if (command === 'editor.unfoldAll') return this.unfoldAll()
    if (command === 'editor.createFoldingRangeFromSelection') return this.createManualFolds()
    if (command === 'editor.removeManualFoldingRanges') return this.removeManualFolds()

    return this.applyFoldPlan(command)
  }

  private applyFoldPlan(command: EditorFoldPlanCommandId): boolean {
    const locations = this.foldCommandLocations()
    if (locations.length === 0) return false

    const plan = planFoldCommand(command, {
      folds: this.foldState.folds,
      locations,
      isCollapsed: (fold) => this.foldState.isCollapsed(fold),
    })
    let collapsed = 0
    let expanded = 0
    for (const fold of plan.collapse) if (this.foldState.fold(fold)) collapsed += 1
    for (const fold of plan.expand) if (this.foldState.unfold(fold)) expanded += 1
    if (collapsed === 0 && expanded === 0) return false

    this.announceFoldChange(collapsed, expanded)
    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.fold.command',
      level: 'info',
      fold: {
        collapsedCount: this.foldState.collapsedFoldCount,
        command,
        foldCount: plan.collapse.length + plan.expand.length,
      },
    })
    return true
  }

  /**
   * Moves the selection somewhere this editor was asked to go, opening whatever hides it on the way.
   *
   * A caret can never be asked afterwards whether it is on a row nobody is shown: one that would land
   * there is pulled back onto the header of the region hiding it before it is ever stored, so by then
   * the answer is always no. This is the last place the position that was asked for still exists, and
   * opening the regions here means the landing is the one the request named rather than the nearest
   * row that happened to be on screen.
   *
   * Nothing is deferred behind a scheduler: there is one call per request rather than a stream of
   * cursor movements to coalesce, and someone who asked to be taken somewhere is waiting to see it.
   */
  private applyRequestedSelection(
    anchor: number,
    head: number,
    timingName: string,
    options?: EditorSetSelectionOptions,
    revealByDefault = false,
  ): void {
    if (options?.jumpCause) this.beginJump()
    this.revealFoldedOffset(head)
    this.inputSelection.applyFindSelection(anchor, head, timingName, {
      affinity: options?.affinity,
      revealBlock: options?.revealBlock,
      revealOffset: selectionRevealOffset(options, head, revealByDefault),
    })
  }

  /** The primary selection is the one reveal follows, so it is the one that has to end up on screen. */
  private applyRequestedSelections(
    selections: readonly EditorSelectionRange[],
    timingName: string,
    revealOffset?: number,
    lastAddedIndex?: number,
  ): void {
    const primary = selections[0]
    if (primary) this.revealFoldedOffset(primary.head)
    this.inputSelection.applyFindSelections(selections, timingName, revealOffset, lastAddedIndex)
  }

  /**
   * Only a request that names a destination opens anything. Walking into a region with the arrow keys
   * is the reader moving through a document they folded themselves, and motion already steps over the
   * rows a region hides rather than stalling on its header — a key that opened them would be undoing
   * the fold on the way past.
   */
  private revealFoldedOffset(offset: number): void {
    const location = this.foldLocation(offset)
    if (!location) return

    const expanded = this.foldState.revealRow(location.row)
    if (expanded === 0) return

    this.announceFoldChange(0, expanded)
    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.fold.revealed',
      level: 'info',
      fold: {
        collapsedCount: this.foldState.collapsedFoldCount,
        foldCount: expanded,
      },
    })
  }

  /**
   * Rows leave the document without the caret moving, so a reader who cannot see the rows go has
   * nothing to tell them how much of the file just stopped being there.
   */
  private announceFoldChange(collapsed: number, expanded: number): void {
    const parts: string[] = []
    if (collapsed > 0) parts.push(`Folded ${collapsed} ${collapsed === 1 ? 'region' : 'regions'}`)
    if (expanded > 0) parts.push(`Unfolded ${expanded} ${expanded === 1 ? 'region' : 'regions'}`)

    this.announcer.status(parts.join(', '))
  }

  /**
   * The caret goes to the head row of each region drawn, which stays visible when the region folds.
   * Left where the gesture ended it would be inside rows the fold hides, and a caret in hidden rows
   * is what unfolds them again — the fold would come back open the moment it was made.
   */
  private createManualFolds(): boolean {
    if (!this.folding) return false

    const snapshot = this.session?.getSnapshot()
    if (!snapshot) return false

    const created = manualFoldRangesForSpans(
      this.selectionFoldSpans(snapshot),
      this.foldState.folds,
    )
    if (created.length === 0) return false

    const carets = created.map((fold) =>
      pointToOffset(snapshot, { row: fold.startLine, column: 0 }),
    )
    this.applyRequestedSelections(
      carets.map((offset) => ({ anchor: offset, head: offset })),
      'editor.fold.manual',
      carets[0],
    )
    this.manualFolds = this.manualFolds.concat(created)
    this.persistManualFolds()
    this.syncFoldStateFromProjections()
    for (const fold of created) this.foldState.fold(fold)

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.fold.manual.created',
      level: 'info',
      fold: {
        collapsedCount: this.foldState.collapsedFoldCount,
        foldCount: created.length,
      },
    })
    return true
  }

  private removeManualFolds(): boolean {
    const snapshot = this.session?.getSnapshot()
    if (!snapshot || this.manualFolds.length === 0) return false

    const kept = foldRangesOutsideSpans(this.manualFolds, this.selectionFoldSpans(snapshot))
    if (kept.length === this.manualFolds.length) return false

    const removedCount = this.manualFolds.length - kept.length
    this.manualFolds = kept
    this.persistManualFolds()
    this.syncFoldStateFromProjections()

    this.notifyViewContributions('layout', null)
    this.log({
      action: 'editor.fold.manual.removed',
      level: 'info',
      fold: {
        collapsedCount: this.foldState.collapsedFoldCount,
        foldCount: removedCount,
      },
    })
    return true
  }

  /** Text this editor did not arrive at one edit at a time is text those regions no longer describe. */
  private dropManualFolds(): void {
    this.manualFolds = []
  }

  private persistManualFolds(): void {
    const session = editorBufferSession(this.session)
    if (!session) return
    session.view.setFoldState({
      ...session.view.getFoldState(),
      manualFolds: anchorManualFolds(session.getSnapshot(), this.manualFolds),
    })
  }

  private restoreViewFolds(state: EditorViewFoldState | undefined): void {
    const session = editorBufferSession(this.session)
    if (!session || !state) return
    session.view.setFoldState(state)
    this.manualFolds = resolveManualFolds(session.getSnapshot(), state.manualFolds)
    this.foldState.restore(state.collapsedRegions)
    this.foldState.setFoldProjections(this.foldProjections(), this.fallbackFolds.index)
  }

  private foldCommandLocations(): readonly FoldCommandLocation[] {
    const snapshot = this.session?.getSnapshot()
    if (!snapshot) return []

    return this.inputSelection.resolveViewSelections().map((selection) => ({
      offset: selection.headOffset,
      row: offsetToPoint(snapshot, selection.headOffset).row,
    }))
  }

  private selectionFoldSpans(snapshot: PieceTableSnapshot): readonly ManualFoldSpan[] {
    return this.inputSelection.resolveViewSelections().map((selection) => {
      const startRow = offsetToPoint(snapshot, selection.startOffset).row
      const end = offsetToPoint(snapshot, selection.endOffset)
      // A selection stopping at the head of a row has not taken any of that row's text with it.
      const endRow = end.column === 0 ? Math.max(startRow, end.row - 1) : end.row

      return {
        startRow,
        endRow,
        startIndex: rowEndOffset(snapshot, startRow),
        endIndex: rowEndOffset(snapshot, endRow),
      }
    })
  }

  private applyFoldOperation(operation: FoldOperation, offset?: number): boolean {
    this.flushFallbackFoldProjection()
    const location = this.foldLocation(offset)
    if (!location) return false

    const fold = foldCandidateAtLocation(
      this.foldState.ranges(location.row, location.row),
      location.row,
      location.offset,
      (candidate) => this.foldState.isCollapsed(candidate),
      operation,
    )
    if (!fold) return false

    const changed = this.applyFoldStateChange(operation, fold)
    if (changed) {
      this.notifyViewContributions('layout', null)
      this.log({
        action: `editor.fold.${operation}`,
        level: 'info',
        fold: foldLogContext(fold),
      })
    }
    return changed
  }

  private foldLocation(offset?: number): { readonly offset: number; readonly row: number } | null {
    const snapshot = this.session?.getSnapshot()
    if (!snapshot) return null

    const locationOffset = clamp(
      offset ?? this.primarySelectionHeadOffsetFromSession(),
      0,
      snapshot.length,
    )
    return {
      offset: locationOffset,
      row: offsetToPoint(snapshot, locationOffset).row,
    }
  }

  private primarySelectionHeadOffsetFromSession(): number {
    const snapshot = this.session?.getSnapshot()
    const selection = this.session?.getSelections().selections[0]
    if (!snapshot || !selection) return this.getTextSnapshot().length

    return resolveSelection(snapshot, selection).headOffset
  }

  private applyFoldStateChange(operation: FoldOperation, fold: FoldRange): boolean {
    if (operation === 'fold') return this.foldState.fold(fold)
    if (operation === 'unfold') return this.foldState.unfold(fold)
    return this.foldState.toggleFold(fold)
  }

  private clearSyntaxFolds(): void {
    this.grammarDescribedFolds = false
    this.displayProjections.delete('folds', SYNTAX_FOLD_PROJECTION_OWNER)
    this.foldState.clear()
    if (!this.session || !this.syntax.usesFallbackFolds) {
      this.syncFoldStateFromProjections()
      return
    }

    this.scheduleFallbackFoldProjection()
  }

  private applyResolvedTheme(): void {
    this.view.setTheme(this.resolvedTheme())
    if (this.viewContributions) this.invalidateIncompatibleSnapshot()
  }

  private resolvedTheme(): EditorTheme | null {
    return mergeEditorThemes(this.syntax.providerTheme, this.syntax.theme, this.configuredTheme)
  }
}

function createEditorLifecycleSummary(): EditorLifecycleSummary {
  return {
    pluginNames: new Set<string>(),
    plugin: {
      activatedCount: 0,
      deactivatedCount: 0,
      disposedCount: 0,
      failedCount: 0,
      installedCount: 0,
      slowestActivationMs: null,
      updatedCount: 0,
    },
    folds: {
      firstSyntaxRejection: null,
      syntaxRejectedCount: 0,
    },
    syntax: {
      refreshScheduledCount: 0,
    },
    document: {
      attachedCount: 0,
      clearedCount: 0,
      detachedCount: 0,
      openedCount: 0,
      setTextCount: 0,
      startedCount: 0,
      syncedTextCount: 0,
    },
    content: {
      setCount: 0,
    },
    mountDurationMs: null,
    mountedAt: null,
    disposingAt: null,
  }
}

function mergeRowDecorationMap(
  target: Map<number, VirtualizedTextRowDecoration>,
  source: ReadonlyMap<number, VirtualizedTextRowDecoration>,
): void {
  for (const [row, decoration] of source) {
    target.set(row, mergeRowDecoration(target.get(row), decoration))
  }
}

function sourceRowDecorationOwner(sourceId: string): string {
  return `${FEATURE_ROW_DECORATION_OWNER_PREFIX}${sourceId}`
}

function projectRowDecorationMapThroughLineEdit(
  source: ReadonlyMap<number, VirtualizedTextRowDecoration>,
  startRow: number,
  endRow: number,
  rowDelta: number,
): Map<number, VirtualizedTextRowDecoration> {
  const projected = new Map<number, VirtualizedTextRowDecoration>()
  for (const [row, decoration] of source) {
    if (row <= startRow) {
      projected.set(row, decoration)
      continue
    }

    if (row > endRow) projected.set(Math.max(0, row + rowDelta), decoration)
  }

  return projected
}

function editLineDelta(edit: TextEdit, previousText: TextSnapshot): number {
  return countLineBreaks(edit.text) - countLineBreaks(previousText.readRange(edit.from, edit.to))
}

function countLineBreaks(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') count += 1
  }
  return count
}

function syntaxScrollDirection(delta: number): SyntaxScrollDirection {
  if (delta > 0) return 1
  if (delta < 0) return -1
  return 0
}

function sessionChangeLogLevel(change: DocumentSessionChange): 'debug' | 'info' {
  if (change.kind === 'selection' || change.kind === 'synchronize' || change.kind === 'none') {
    return 'debug'
  }
  return 'info'
}

function editorBufferSession(session: DocumentSession | null): EditorBufferSession | null {
  if (!session || !('buffer' in session) || !('view' in session)) return null
  return session as EditorBufferSession
}

function summarizeTextEdits(edits: readonly TextEdit[]): readonly Record<string, number>[] {
  return edits.map((edit) => ({
    from: edit.from,
    insertedLength: edit.text.length,
    removedLength: edit.to - edit.from,
    to: edit.to,
  }))
}

/**
 * Where a row's text ends. A fold starting here keeps its own row on screen and hides the rest, which
 * is what a region drawn over whole rows means.
 */
function rowEndOffset(snapshot: PieceTableSnapshot, row: number): number {
  return pointToOffset(snapshot, { row, column: Number.MAX_SAFE_INTEGER })
}

function foldLogContext(fold: FoldRange | VirtualizedFoldMarker): Record<string, unknown> {
  if ('startOffset' in fold) {
    return {
      collapsed: fold.collapsed,
      endIndex: fold.endOffset,
      endLine: fold.endRow,
      startIndex: fold.startOffset,
      startLine: fold.startRow,
    }
  }

  return {
    endIndex: fold.endIndex,
    endLine: fold.endLine,
    startIndex: fold.startIndex,
    startLine: fold.startLine,
  }
}

function editorLogError(error: unknown): EditorLogError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

function anyReaderHolds(readers: ReadonlySet<() => boolean>): boolean {
  for (const read of readers) {
    if (read()) return true
  }
  return false
}

function editorContributionFailureAction(phase: EditorContributionFailurePhase): string {
  if (phase === 'factory') return 'editor.contribution.factory_failed'
  if (phase === 'dispose') return 'editor.contribution.dispose_failed'
  if (phase === 'press') return 'editor.contribution.press_failed'
  if (phase === 'reserved-width') return 'editor.contribution.reserved_width_failed'
  if (phase === 'non-caret-row') return 'editor.contribution.non_caret_row_failed'
  if (phase === 'capture-visible-paint') return 'editor.contribution.capture_visible_paint_failed'
  return 'editor.contribution.update_failed'
}

function deleteMapValue<Key, Value>(map: Map<Key, Value>, value: Value): void {
  for (const [key, entry] of map) {
    if (entry !== value) continue

    map.delete(key)
    return
  }
}

function sameInjectedTextRows(
  left: readonly InjectedTextRow[],
  right: readonly InjectedTextRow[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((row, index) => row === right[index])
}

function sameGutterContributions(
  left: readonly EditorGutterContribution[],
  right: readonly EditorGutterContribution[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((contribution, index) => contribution === right[index])
}

function mergeRowDecoration(
  base: VirtualizedTextRowDecoration | undefined,
  next: VirtualizedTextRowDecoration,
): VirtualizedTextRowDecoration {
  if (!base) return next

  return {
    snapshotStyle:
      base.snapshotStyle === 'colors' && next.snapshotStyle === 'colors' ? 'colors' : undefined,
    className: joinClassNames(base.className, next.className),
    gutterClassName: joinClassNames(base.gutterClassName, next.gutterClassName),
  }
}

function joinClassNames(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right
  if (!right) return left
  return `${left} ${right}`
}

function preparedTransferStage(
  transfer: { readonly readyResult: unknown } | null | undefined,
): 'absent' | 'pending' | 'ready' {
  if (!transfer) return 'absent'
  return transfer.readyResult ? 'ready' : 'pending'
}

/**
 * The one change a coalesced pass reports.
 *
 * A pass shows only its net result, so its listeners get the newest snapshot and
 * selections — but they also get every edit that produced them, in order, under
 * the kind of the last change that carried edits. Reporting the final change
 * alone would tell a listener the text stood still whenever a pass happened to
 * end on a caret move.
 */
function coalescedPassChange(
  flush: EditorOperationFlush,
  latest: DocumentSessionChange,
): DocumentSessionChange {
  const edits = flush.changes.flatMap((pending) => pending.change.edits)
  if (edits.length === latest.edits.length) return latest

  const lastEditing = flush.changes.findLast((pending) => pending.change.edits.length > 0)
  return { ...latest, edits, kind: lastEditing?.change.kind ?? latest.kind }
}

/** What one contribution registered; a registration arriving after release is undone at once. */
class ContributionClaims {
  private readonly claims = new Set<EditorDisposable>()
  private released = false

  add(registration: EditorDisposable): EditorDisposable {
    if (this.released) {
      registration.dispose()
      return registration
    }
    const claim = disposableOnce(() => {
      this.claims.delete(claim)
      registration.dispose()
    })
    this.claims.add(claim)
    return claim
  }

  release(): readonly EditorDisposable[] {
    this.released = true
    const claims = [...this.claims].toReversed()
    this.claims.clear()
    return claims
  }
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

function isTextSessionChange(change: DocumentSessionChange): boolean {
  return (
    change.kind === 'edit' ||
    change.kind === 'undo' ||
    change.kind === 'redo' ||
    change.kind === 'checkout'
  )
}

function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, entry]) => [key, withSortedKeys(entry)]),
  )
}

function appearanceDifference(saved: string, live: string | null): readonly string[] {
  if (live === null) return ['unavailable']
  try {
    const before: Record<string, unknown> = JSON.parse(saved)
    const after: Record<string, unknown> = JSON.parse(live)
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
  } catch {
    return ['unreadable']
  }
}
