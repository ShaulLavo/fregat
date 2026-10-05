import { setRetainedSyntaxDisplayDemand } from './documentAnalysis'
import type {
  EditorDocumentAnalysis,
  EditorRetainedSyntaxSession,
  EditorRetainedHighlighterSession,
  EditorAnalysisDisplayDemand,
} from './documentAnalysis'
import type { DocumentSession, DocumentSessionChange } from '../documentSession'
import type { DocumentEditChain, DocumentSyncPoint } from './editChain'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type {
  EditorInitialHighlightStatus,
  EditorInitialPaintEvent,
  EditorLogInput,
  EditorPluginHost,
} from '../plugins'
import type { EditorHighlightResult, EditorHighlighterSession } from '../syntax/highlighter'
import { createEmptySyntaxResult } from '../syntax/session'
import type {
  BracketInfo,
  EditorSyntaxCapture,
  EditorSyntaxInjection,
  EditorSyntaxRange,
  EditorSyntaxResult,
  EditorSyntaxSession,
} from '../syntax/session'
import type { EditorSyntaxLanguageId, FoldRange } from '../syntax/session'
import type { EditorTheme } from '../theme'
import { editorThemesEqual } from '../theme'
import { EditorTokenStore, toEditorTokenStore, type EditorTokenInput } from '../syntax/tokenStore'
import type { TextEdit } from '../tokens'
import { foldRangeKey } from './folds'
import type { EditorSyntaxStatus } from './types'
import { LatestAsyncRequest } from './latestAsyncRequest'
import { getEditorSyntaxSessionFactory } from './runtime'
import { syntaxRefreshDelay, SYNTAX_REFRESH_MAX_DELAY_MS } from './editorUtils'
import type {
  EditorPreparedDocument,
  EditorPreparedDocumentPayload,
  EditorPreparedHighlighterBorrow,
  EditorPreparedStructuralConfiguration,
  EditorPreparedStructuralBorrow,
  EditorPreparedTagValue,
  EditorPreparedTabSizePolicy,
} from './preparedDocument'
import { nowMs } from './timing'
import {
  editorPerformanceDiagnosticsEnabled,
  recordEditorPerformanceDiagnostic,
  traceEditorPerformanceTask,
} from './performanceDiagnostics'

export type EditorSyntaxDocumentStartOptions = {
  readonly analysis?: EditorDocumentAnalysis | null
  readonly structuralConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly documentId: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly snapshot: PieceTableSnapshot
  readonly textSnapshot: DocumentTextSnapshot
}

export type EditorPreparedDocumentBorrowOptions = {
  readonly configuredTabSize: number
  readonly tabSizePolicy: EditorPreparedTabSizePolicy
  readonly documentConfigurationTag: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag: readonly EditorPreparedTagValue[]
  readonly structuralConfigurationTag: readonly EditorPreparedTagValue[]
}

export type EditorSyntaxControllerOptions = {
  readonly pluginHost: EditorPluginHost
  getDocumentVersion(): number
  getDocumentId(): string | null
  getTextVersion(): number
  getCurrentSessionDocumentId(): string
  getLanguageId(): EditorSyntaxLanguageId | null
  getSession(): DocumentSession | null
  getDocumentEditChain(): Pick<DocumentEditChain, 'changesSince' | 'point'>
  getVisibleSyntaxRange(): EditorSyntaxRange | null
  adoptTokens(tokens: EditorTokenStore): void
  clearSyntaxFolds(): void
  setSyntaxFolds(folds: readonly FoldRange[]): void
  notifyChange(change: DocumentSessionChange | null): void
  notifyViewUpdate(): void
  onInitialPaint?(event: EditorInitialPaintEvent): void
  setSyntaxCaptures?(
    captures: readonly EditorSyntaxCapture[],
    records?: EditorSyntaxResult['records'],
  ): void
  /**
   * Whether anything downstream reads raw captures. Captures cost payload on every parse, so a
   * session asks for them only while an inline replacement provider is registered to consume them.
   */
  needsSyntaxCaptures?(): boolean
  notifyThemeChanged(): void
  log?(event: EditorLogInput): void
}

export type EditorSyntaxRefreshOptions = {
  readonly delayMs?: number
  readonly range?: EditorSyntaxRange | null
}

export type EditorFallbackFoldReason =
  | 'no-language'
  | 'no-session'
  | 'unsupported'
  | 'structural-error'

export function fallbackFoldReason(options: {
  readonly languageId: EditorSyntaxLanguageId | null
  readonly session: Pick<EditorSyntaxSession, 'foldingSupport'> | null
  readonly status: EditorSyntaxStatus
}): EditorFallbackFoldReason | null {
  if (!options.session) return options.languageId ? 'no-session' : 'no-language'
  if (options.status === 'error') return 'structural-error'
  if (options.session.foldingSupport === 'unsupported') return 'unsupported'
  return null
}

type EditorSyntaxLoadResult = {
  readonly contentVersion: number
  readonly range: EditorSyntaxRange | null
  readonly result: EditorSyntaxResult
  readonly source: EditorSyntaxLoadSource
  readonly skipApply?: boolean
  readonly suppressWarm?: boolean
  readonly updatesDocument?: boolean
}

type EditorSyntaxLoadSource = 'full' | 'visible' | 'prefetch' | 'warm'

type PendingSyntaxPrefetch = {
  readonly contentVersion: number
  readonly documentVersion: number
  readonly options: EditorSyntaxRefreshOptions
  readonly range: EditorSyntaxRange
}

type PendingSyntaxWarm = {
  readonly configurationGeneration: number
  readonly contentVersion: number
  readonly delayMs: number
  readonly documentVersion: number
  readonly generation: number
  readonly seedRange: EditorSyntaxRange
}

type CachedSyntaxFoldRange = {
  readonly range: EditorSyntaxRange
  readonly folds: readonly FoldRange[]
  readonly result: EditorSyntaxResult
  readonly snapshot: DocumentTextSnapshot
  readonly tokenRanges: readonly EditorSyntaxRange[]
}

type InitialHighlightReplacement = 'all' | 'syntax' | 'theme'

type PendingInitialHighlightReplacement = {
  readonly generation: number
  readonly kind: InitialHighlightReplacement
}

type SettledHighlightStatus = Exclude<EditorInitialHighlightStatus, 'idle' | 'loading'>

type PendingInitialHighlightThemeTerminal = {
  readonly configurationGeneration: number
  readonly status: SettledHighlightStatus
}

const BACKGROUND_SYNTAX_TILE_CHARS = 120_000

// Backoff before each retry of a failed highlight refresh. The last rung retries on a new
// highlighter session; the failure after it is terminal.
const HIGHLIGHT_RETRY_DELAYS_MS: readonly number[] = [100, 400]

const syntaxWorkTags = (
  documentVersion: number,
  contentVersion: number,
  source: EditorSyntaxLoadSource,
  range?: EditorSyntaxRange,
) => ({
  version: documentVersion,
  snapshotVersion: contentVersion,
  configuration: source,
  viewport: range ? `${range.startIndex}:${range.endIndex}` : null,
})

export class EditorSyntaxController {
  private analysis: EditorDocumentAnalysis | null = null
  private retainedSyntax: EditorRetainedSyntaxSession | null = null
  private retainedHighlighter: EditorRetainedHighlighterSession | null = null
  private structuralConfigurationTag: readonly EditorPreparedTagValue[] = []
  private highlighterConfigurationTag: readonly EditorPreparedTagValue[] = []
  private disposed = false
  private syntaxStatus: EditorSyntaxStatus = 'plain'
  private applyingRenderData = false
  private initialHighlightState: EditorInitialHighlightStatus = 'idle'
  private initialPaintDocumentVersion = 0
  private initialTextPainted = false
  private initialTextPaintEmitted = false
  private initialHighlightPaintEmitted = false
  private initialHighlightConfigurationGeneration = 0
  private pendingInitialHighlightReplacement: PendingInitialHighlightReplacement | null = null
  private pendingInitialHighlightThemeTerminal: PendingInitialHighlightThemeTerminal | null = null
  private highlighterThemePending = false
  private lastInitialHighlightTerminalStatus: SettledHighlightStatus | null = 'plain'
  private syntaxSession: EditorSyntaxSession | null = null
  private syntaxSessionIncludesCaptures = false
  private highlighterSession: EditorHighlighterSession | null = null
  // Refresh failures since the last success or re-entry (document, provider or highlighter theme).
  private failedHighlightRefreshes = 0
  private unsubscribeHighlighterTheme: (() => void) | null = null
  private preparedSyntaxDisposer: (() => void) | null = null
  private preparedHighlighterDisposer: (() => void) | null = null
  private preparedInitialTokensInstalled = false
  private preparedStructuralContentVersion: number | null = null
  private preparedHighlighterContentVersion: number | null = null
  private highlightDispatchPoint: DocumentSyncPoint | null = null
  private structuralDispatchPoint: DocumentSyncPoint | null = null
  private providerHighlighterTheme: EditorTheme | null = null
  private highlighterTheme: EditorTheme | null = null
  private foldCoverage:
    | { readonly kind: 'full' }
    | { readonly kind: 'range'; readonly range: EditorSyntaxRange }
    | null = null
  private cachedSyntaxRanges: readonly EditorSyntaxRange[] = []
  private cachedSyntaxFoldRanges: readonly CachedSyntaxFoldRange[] = []
  private readonly syntaxRequests = new LatestAsyncRequest<EditorSyntaxLoadResult>({
    key: 'editor.syntax.document',
    taskClass: 'background-derived',
  })
  private readonly rangeRequests = new LatestAsyncRequest<EditorSyntaxLoadResult>({
    key: 'editor.syntax.visibleRange',
    taskClass: 'viewport-derived',
  })
  private readonly prefetchRangeRequests = new LatestAsyncRequest<EditorSyntaxLoadResult>({
    key: 'editor.syntax.prefetchRange',
    taskClass: 'idle-cache',
  })
  private readonly warmRangeRequests = new LatestAsyncRequest<EditorSyntaxLoadResult>({
    key: 'editor.syntax.warmRange',
    taskClass: 'idle-cache',
  })
  private readonly highlightRequests = new LatestAsyncRequest<EditorHighlightResult>({
    key: 'editor.syntax.highlight',
    taskClass: 'background-derived',
  })
  private readonly highlighterThemeRequests = new LatestAsyncRequest<
    EditorTheme | null | undefined
  >({
    key: 'editor.syntax.highlighterTheme',
    taskClass: 'background-derived',
  })
  private currentTokens = EditorTokenStore.empty()
  private rangeTokenOwner: {
    readonly store: EditorTokenStore
    readonly snapshot: DocumentTextSnapshot
  } | null = null
  private rangeCopyOwner: {
    readonly store: EditorTokenStore
    readonly contributor: CachedSyntaxFoldRange
  } | null = null
  private rangeScopeOwner: CachedSyntaxFoldRange | null = null
  private stoppedWarm: {
    readonly snapshot: DocumentTextSnapshot
    readonly configurationGeneration: number
  } | null = null
  private lastRangeTrim: {
    readonly snapshot: DocumentTextSnapshot
    readonly ranges: readonly EditorSyntaxRange[]
    readonly cache: readonly CachedSyntaxFoldRange[]
    readonly store: EditorTokenStore
  } | null = null
  private acceptedCopyTokens = EditorTokenStore.empty()
  private acceptedTokensDocumentVersion = -1
  private acceptedTokensTextVersion = -1
  private currentBrackets: readonly BracketInfo[] = []
  private currentInjections: readonly EditorSyntaxInjection[] = []
  private syntaxContentVersion = 0
  private parsedSyntaxContentVersion: number | null = null
  private pendingSyntaxContentVersion: number | null = null
  private pendingVisibleRange: {
    readonly documentVersion: number
    readonly contentVersion: number
    readonly range: EditorSyntaxRange
  } | null = null
  private pendingPrefetch: PendingSyntaxPrefetch | null = null
  private pendingWarm: PendingSyntaxWarm | null = null
  private warmGeneration = 0

  constructor(private readonly options: EditorSyntaxControllerOptions) {}

  setDisplayDemand(demand: EditorAnalysisDisplayDemand): void {
    const changed = this.trimRangeCache(demand)
    if (this.retainedSyntax)
      setRetainedSyntaxDisplayDemand(this.retainedSyntax, demand, this.rangeContributors(demand))
    if (changed) this.options.adoptTokens(this.currentTokens)
  }

  private rangeContributors(
    demand: EditorAnalysisDisplayDemand,
  ): readonly CachedSyntaxFoldRange[] | null {
    if (demand.kind !== 'frame' || demand.snapshot !== this.options.getSession()?.getTextSnapshot())
      return null
    const contributors = this.cachedSyntaxFoldRanges.slice()
    if (this.rangeCopyOwner?.store === this.copyTokens)
      contributors.push(this.rangeCopyOwner.contributor)
    if (this.rangeScopeOwner) contributors.push(this.rangeScopeOwner)
    return contributors.filter((contributor) => contributor.snapshot === demand.snapshot)
  }

  private trimRangeCache(demand: EditorAnalysisDisplayDemand): boolean {
    if (demand.kind !== 'frame') return false
    if (demand.snapshot !== this.options.getSession()?.getTextSnapshot()) return false
    if (this.applyingRenderData) return false
    const visible = this.options.getVisibleSyntaxRange()
    const ranges = visible ? appendCachedSyntaxRange(demand.ranges, visible) : demand.ranges
    const previous = this.lastRangeTrim
    if (
      previous?.snapshot === demand.snapshot &&
      previous.cache === this.cachedSyntaxFoldRanges &&
      previous.store === this.currentTokens &&
      sameSyntaxRanges(previous.ranges, ranges)
    )
      return false
    const oldCache = this.cachedSyntaxFoldRanges
    const rangeOwned =
      !this.highlighterSession &&
      this.rangeTokenOwner?.store === this.currentTokens &&
      this.rangeTokenOwner.snapshot === demand.snapshot
    const tokenContributors = rangeOwned
      ? oldCache.filter((cached) => syntaxRangeListsIntersect(cached.tokenRanges, ranges))
      : []
    const foldContributors = activeFoldContributors(oldCache, ranges)
    const retained = new Set([...tokenContributors, ...foldContributors])
    const scope = this.rangeScopeOwner
    const copy =
      this.rangeCopyOwner?.store === this.copyTokens ? this.rangeCopyOwner.contributor : null
    const currentOwners = [scope, copy].filter(
      (owner): owner is CachedSyntaxFoldRange =>
        owner !== null && owner.snapshot === demand.snapshot,
    )
    for (const cached of oldCache) {
      if (
        currentOwners.some(
          (owner) => owner.result === cached.result && sameSyntaxRange(owner.range, cached.range),
        )
      )
        retained.add(cached)
    }
    const nextCache = oldCache.filter((cached) => retained.has(cached))
    const completeRanges = nextCache.reduce<readonly EditorSyntaxRange[]>(
      (coverage, cached) => appendCachedSyntaxRange(coverage, cached.range),
      [],
    )
    const coverage = rangeOwned
      ? completeRanges
      : intersectSyntaxRanges(this.cachedSyntaxRanges, completeRanges)
    const discardedOffDemand = oldCache.some(
      (cached) => !retained.has(cached) && !syntaxRangeListsIntersect([cached.range], ranges),
    )
    const removed =
      nextCache.length !== oldCache.length || !sameSyntaxRanges(this.cachedSyntaxRanges, coverage)
    this.cachedSyntaxFoldRanges = nextCache
    this.cachedSyntaxRanges = coverage
    let changed = false
    if (removed && rangeOwned) {
      const tokens = compactSyntaxRangeTokens(this.currentTokens, coverage)
      this.currentTokens = tokens
      this.rangeTokenOwner = { store: tokens, snapshot: demand.snapshot }
      changed = true
    }
    if (discardedOffDemand) this.stopOptionalWarm(demand.snapshot)
    this.lastRangeTrim = {
      snapshot: demand.snapshot,
      ranges,
      cache: nextCache,
      store: this.currentTokens,
    }
    return changed
  }

  private stopOptionalWarm(snapshot: DocumentTextSnapshot): void {
    this.stoppedWarm = {
      snapshot,
      configurationGeneration: this.initialHighlightConfigurationGeneration,
    }
    this.nextWarmGeneration()
    this.pendingWarm = null
    this.warmRangeRequests.cancel()
  }

  get status(): EditorSyntaxStatus {
    if (this.syntaxStatus !== 'ready' && this.syntaxStatus !== 'degraded') return this.syntaxStatus
    if (this.usesFallbackFolds || this.foldsCoverViewport()) return this.syntaxStatus
    return 'loading'
  }

  get usesFallbackFolds(): boolean {
    return this.fallbackFoldReason !== null
  }

  get fallbackFoldReason(): EditorFallbackFoldReason | null {
    return fallbackFoldReason({
      languageId: this.options.getLanguageId(),
      session: this.syntaxSession,
      status: this.syntaxStatus,
    })
  }

  get fallbackFoldSelection() {
    return {
      reason: this.fallbackFoldReason,
      provider: this.structuralProviderKind(),
      foldingSupport: this.syntaxSession?.foldingSupport ?? null,
      structuralStatus: this.syntaxStatus,
      structuralSession: this.syntaxSession !== null,
      structuralSuppression: this.fallbackFoldReason === null,
      configurationGeneration: this.initialHighlightConfigurationGeneration,
    }
  }

  private structuralProviderKind(): 'plugin' | 'factory' | null {
    if (this.options.pluginHost.hasSyntaxProviders()) return 'plugin'
    if (getEditorSyntaxSessionFactory()) return 'factory'
    return null
  }

  private foldsCoverViewport(): boolean {
    const coverage = this.foldCoverage
    if (!coverage) return false
    if (coverage.kind === 'full') return true
    const range = this.options.getVisibleSyntaxRange()
    return range !== null && syntaxRangeCoverage(range, [coverage.range]) === 'full'
  }

  get renderDataReady(): boolean {
    return (
      !this.applyingRenderData &&
      this.initialHighlightState !== 'loading' &&
      this.status !== 'loading'
    )
  }

  get initialHighlightStatus(): EditorInitialHighlightStatus {
    return this.initialHighlightState
  }

  get copyTokens(): EditorTokenStore {
    if (
      this.acceptedTokensDocumentVersion !== this.options.getDocumentVersion() ||
      this.acceptedTokensTextVersion !== this.options.getTextVersion()
    )
      return EditorTokenStore.empty()
    return this.acceptedCopyTokens
  }

  get tokens(): EditorTokenStore {
    return this.currentTokens
  }

  /**
   * Bracket positions from the last structural parse, sorted by offset. Empty while a windowed
   * parse is in flight, because a partial list would pair brackets across a hole it cannot see.
   */
  get brackets(): readonly BracketInfo[] {
    return this.currentBrackets
  }

  /**
   * The stretches the last structural parse handed to another grammar, so that anything acting on a
   * position can ask which language actually owns it instead of assuming the file's own.
   */
  get injections(): readonly EditorSyntaxInjection[] {
    return this.currentInjections
  }

  get providerTheme(): EditorTheme | null {
    return this.providerHighlighterTheme
  }

  get theme(): EditorTheme | null {
    return this.highlighterTheme
  }

  setTokens(tokens: EditorTokenStore, current = true, copyTokens = tokens): void {
    if (this.rangeTokenOwner?.store !== tokens) this.rangeTokenOwner = null
    if (!current || this.rangeCopyOwner?.store !== copyTokens) this.rangeCopyOwner = null
    if (!current && tokens !== this.currentTokens)
      this.acceptedCopyTokens = EditorTokenStore.empty()
    this.currentTokens = tokens
    if (current) {
      this.acceptedCopyTokens = copyTokens
      this.acceptedTokensDocumentVersion = this.options.getDocumentVersion()
      this.acceptedTokensTextVersion = this.options.getTextVersion()
    }
    if (this.preparedInitialTokensInstalled) {
      this.preparedInitialTokensInstalled = false
      return
    }
    this.options.adoptTokens(tokens)
  }

  stagePreparedReadyTokens(prepared: EditorPreparedDocumentPayload | null): EditorTokenStore {
    const highlighterResult = prepared?.highlighter?.readyResult
    const structuralResult = prepared?.structural?.readyResult
    const structuralTokens = prepared?.highlighter ? undefined : structuralResult?.tokens
    const tokens = highlighterResult?.tokens ?? toEditorTokenStore(structuralTokens ?? [])

    this.currentTokens = tokens
    const structural = prepared?.structural
    const read = structural?.session.read(structural.range)
    this.rangeTokenOwner =
      !prepared?.highlighter && read?.kind === 'ready' && read.result === structuralResult
        ? { store: tokens, snapshot: read.snapshot }
        : null
    this.preparedInitialTokensInstalled = Boolean(highlighterResult || structuralTokens)
    if (highlighterResult?.theme !== undefined) this.setHighlighterTheme(highlighterResult.theme)
    return tokens
  }

  borrowPreparedDocument(
    document: EditorSyntaxDocumentStartOptions,
    preparedDocument: EditorPreparedDocument,
    tags: EditorPreparedDocumentBorrowOptions,
  ): EditorPreparedDocumentPayload | null {
    const highlighterProvider = this.options.pluginHost.getHighlighterProvider()
    const structuralProvider = this.options.pluginHost.getSyntaxProvider()
    const structuralConfiguration = this.preparedStructuralConfiguration(
      document.languageId,
      structuralProvider !== null,
      highlighterProvider !== null,
    )
    return preparedDocument.borrow({
      configuredTabSize: tags.configuredTabSize,
      tabSizePolicy: tags.tabSizePolicy,
      documentId: document.documentId,
      languageId: document.languageId,
      snapshot: document.snapshot,
      documentConfigurationTag: tags.documentConfigurationTag,
      structuralProvider,
      highlighterProvider,
      structuralConfiguration,
      structuralConfigurationTag: tags.structuralConfigurationTag,
      highlighterConfigurationTag: tags.highlighterConfigurationTag,
    })
  }

  startDocument(
    document: EditorSyntaxDocumentStartOptions,
    prepared: EditorPreparedDocumentPayload | null = null,
  ): void {
    if (this.disposed) return

    this.advanceInitialHighlightConfigurationGeneration()
    this.disposeSyntaxSession()
    this.disposeHighlighterSession()
    this.clearSyntaxRangeCache()
    this.resetSyntaxContentVersion()
    this.currentBrackets = []
    this.currentInjections = []
    this.analysis = document.analysis ?? null
    this.structuralConfigurationTag = document.structuralConfigurationTag ?? []
    this.highlighterConfigurationTag = document.highlighterConfigurationTag ?? []
    this.failedHighlightRefreshes = 0
    this.highlighterSession =
      prepared?.highlighter?.session ??
      this.createHighlighterSession(
        document.documentId,
        document.languageId,
        document.textSnapshot,
        document.snapshot,
      )
    if (prepared?.highlighter) this.retainedHighlighter = prepared.highlighter.session
    this.preparedHighlighterDisposer = prepared?.highlighter?.dispose ?? null
    this.observeHighlighterTheme()
    this.syntaxSession = prepared?.structural?.session ?? this.createSyntaxSession(document)
    if (prepared?.structural) this.retainedSyntax = prepared.structural.session
    this.retainedSyntax?.setDisplayDemand({ kind: 'unknown' })
    this.preparedSyntaxDisposer = prepared?.structural?.dispose ?? null
    this.preparedStructuralContentVersion = prepared?.structural ? this.syntaxContentVersion : null
    this.preparedHighlighterContentVersion = prepared?.highlighter
      ? this.syntaxContentVersion
      : null
    if (prepared?.structural) {
      this.syntaxSessionIncludesCaptures = prepared.structural.configuration.includeCaptures
    }
    this.syntaxStatus = this.syntaxSession ? 'loading' : 'plain'
    this.initialPaintDocumentVersion = this.options.getDocumentVersion()
    this.initialTextPainted = false
    this.initialTextPaintEmitted = false
    this.initialHighlightPaintEmitted = false
    this.pendingInitialHighlightReplacement = null
    this.preparedInitialTokensInstalled = false
    this.initialHighlightState =
      this.highlighterSession || this.syntaxSession || this.highlighterThemePending
        ? 'loading'
        : 'plain'
    this.lastInitialHighlightTerminalStatus =
      this.initialHighlightState === 'plain' ? 'plain' : null
    this.observePreparedResults(prepared)
    this.logSyntaxStatus('editor.syntax.document_started')
  }

  adoptPreparedReadyResults(prepared: EditorPreparedDocumentPayload | null): void {
    if (!prepared) return

    const documentVersion = this.options.getDocumentVersion()
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    const contentVersion = this.syntaxContentVersion
    if (prepared.structural?.readyResult) {
      this.applyPreparedStructuralResult(
        prepared.structural,
        prepared.structural.readyResult,
        documentVersion,
        configurationGeneration,
        contentVersion,
      )
    }
    if (prepared.highlighter?.readyResult) {
      this.applyHighlightResult(
        prepared.highlighter.readyResult,
        documentVersion,
        nowMs(),
        configurationGeneration,
      )
    }
  }

  adoptReadyAnalysis(): void {
    const documentVersion = this.options.getDocumentVersion()
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    const range = this.options.getVisibleSyntaxRange()
    const structural = this.retainedSyntax?.read(range ?? undefined)
    if (structural?.kind === 'ready') {
      this.applySyntaxResult(
        {
          contentVersion: this.syntaxContentVersion,
          range,
          result: structural.result,
          source: range ? 'visible' : 'full',
          suppressWarm: true,
          updatesDocument: true,
        },
        documentVersion,
        nowMs(),
        configurationGeneration,
      )
    }
    const highlighter = this.retainedHighlighter?.read()
    if (highlighter?.kind === 'ready')
      this.applyHighlightResult(
        highlighter.result,
        documentVersion,
        nowMs(),
        configurationGeneration,
      )
  }

  notifyBaseTextPainted(): void {
    if (this.initialPaintDocumentVersion !== this.options.getDocumentVersion()) return

    this.initialTextPainted = true
    if (!this.initialTextPaintEmitted) {
      this.initialTextPaintEmitted = true
      this.options.onInitialPaint?.({ ...this.initialPaintEventBase(), phase: 'text' })
    }
    this.emitInitialHighlightPaintIfReady()
  }

  clearDocument(): void {
    this.advanceInitialHighlightConfigurationGeneration()
    this.syntaxStatus = 'plain'
    this.initialHighlightState = 'idle'
    this.failedHighlightRefreshes = 0
    this.initialPaintDocumentVersion = this.options.getDocumentVersion()
    this.initialTextPainted = false
    this.initialTextPaintEmitted = false
    this.initialHighlightPaintEmitted = false
    this.pendingInitialHighlightReplacement = null
    this.preparedInitialTokensInstalled = false
    this.lastInitialHighlightTerminalStatus = 'plain'
    this.clearSyntaxRangeCache()
    this.resetSyntaxContentVersion()
    this.disposeSyntaxSession()
    this.disposeHighlighterSession()
    this.analysis = null
    this.logSyntaxStatus('editor.syntax.document_cleared')
  }

  dispose(): void {
    this.disposed = true
    this.analysis = null
    this.highlighterThemeRequests.dispose()
    this.disposeSyntaxSession()
    this.disposeHighlighterSession()
  }

  /**
   * Reparses when the capture requirement flips. A provider that registers after the document
   * started — plugin activation is async — would otherwise wait for the next edit to see captures,
   * and the first one it ever gets is the one it needs to paint the file it was opened on.
   */
  syncCaptureRequirement(): void {
    if (this.disposed) return
    if ((this.options.needsSyntaxCaptures?.() ?? false) === this.syntaxSessionIncludesCaptures)
      return

    this.reloadSyntaxSession()
  }

  reloadHighlighterAndSyntax(): void {
    this.beginInitialHighlightReplacement('all')
    this.failedHighlightRefreshes = 0
    this.reloadHighlighterSession()
    this.reloadSyntaxSession(false)
    this.settlePlainInitialHighlightIfNeeded()
  }

  reloadSyntaxSession(resetInitialHighlight = true): void {
    // Plugin activation resolves async; a provider-changed callback can land
    // after dispose (StrictMode tears the editor down before tree-sitter
    // registers). Recreating a session then leaks an undisposed worker parse.
    if (this.disposed) return

    if (resetInitialHighlight) this.beginInitialHighlightReplacement('syntax')

    this.disposeSyntaxSession()
    this.clearSyntaxRangeCache()

    const session = this.options.getSession()
    if (!session) {
      this.settlePlainInitialHighlightIfNeeded()
      return
    }

    this.syntaxSession = this.createSyntaxSession({
      documentId: this.options.getCurrentSessionDocumentId(),
      languageId: this.options.getLanguageId(),
      textSnapshot: session.getTextSnapshot(),
      snapshot: session.getSnapshot(),
    })
    this.syntaxStatus = this.syntaxSession ? 'loading' : 'plain'
    this.options.clearSyntaxFolds()
    this.logSyntaxStatus('editor.syntax.reloaded')
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    if (
      !this.syntaxSession &&
      this.highlighterSession &&
      this.pendingReplacementMatches('syntax', configurationGeneration)
    ) {
      const terminalStatus = this.lastInitialHighlightTerminalStatus ?? 'painted'
      this.commitInitialHighlightStatus(
        terminalStatus,
        () => this.setTokens(this.currentTokens, false),
        configurationGeneration,
      )
    }
    const documentVersion = this.options.getDocumentVersion()
    if (resetInitialHighlight) this.refresh(documentVersion, null)
    else this.refreshStructuralSyntax(documentVersion, null)
    this.options.notifyChange(null)
    this.settlePlainInitialHighlightIfNeeded()
  }

  beginThemeReplacement(): number {
    return this.beginInitialHighlightReplacement('theme')
  }

  completeThemeReplacement(configurationGeneration: number): boolean {
    if (!this.options.getSession()) return false
    if (!this.pendingReplacementMatches('theme', configurationGeneration)) return false

    const status = this.lastInitialHighlightTerminalStatus ?? this.currentApplicableTerminalStatus()
    if (status === null) return false
    this.commitInitialHighlightStatus(
      status,
      () => this.setTokens(this.currentTokens, false),
      configurationGeneration,
    )
    return true
  }

  refreshHighlighterTheme(): void {
    if (!this.options.pluginHost.hasHighlighterProviders()) {
      this.highlighterThemeRequests.cancel()
      this.completeProviderHighlighterTheme(null)
      return
    }

    this.highlighterThemePending = true
    this.highlighterThemeRequests.schedule({
      tags: { configuration: 'highlighterTheme' },
      run: () => this.options.pluginHost.loadHighlighterTheme(),
      apply: (theme) => this.completeProviderHighlighterTheme(theme),
      fail: () => this.completeProviderHighlighterTheme(null),
    })
  }

  refresh(
    documentVersion: number,
    change: DocumentSessionChange | null,
    options: EditorSyntaxRefreshOptions = {},
  ): void {
    if (!this.options.getSession()) return
    if (
      change &&
      (change.kind === 'none' || change.kind === 'selection' || change.kind === 'synchronize')
    ) {
      return
    }

    this.options.log?.({
      action: 'editor.syntax.refresh_scheduled',
      level: 'debug',
      syntax: {
        ...this.fallbackFoldSelection,
        changeKind: change?.kind ?? null,
        documentVersion,
        range: options.range ?? null,
      },
    })
    if (this.syntaxContentVersion !== this.preparedStructuralContentVersion) {
      this.refreshStructuralSyntax(documentVersion, change, options)
    }
    if (
      this.syntaxContentVersion !== this.preparedHighlighterContentVersion &&
      (!this.retainedHighlighter || change === null)
    ) {
      this.refreshHighlightTokens(documentVersion, change, options)
    }
  }

  acceptChange(change: DocumentSessionChange): void {
    if (change.kind === 'none' || change.kind === 'selection' || change.kind === 'synchronize') {
      return
    }
    this.stoppedWarm = null
    this.syntaxContentVersion += 1
    this.foldCoverage = null
    this.parsedSyntaxContentVersion = null
    this.projectSyntaxRangeCache(change)
    if (this.retainedHighlighter) {
      this.refreshHighlightTokens(this.options.getDocumentVersion(), change, { delayMs: 0 })
    }
  }

  refreshVisibleRange(documentVersion: number, options: EditorSyntaxRefreshOptions = {}): void {
    if (!this.syntaxSession?.queryRange) return
    if (!this.options.getSession()) return

    const range = options.range ?? this.options.getVisibleSyntaxRange()
    if (!range) return
    if (this.repaintCachedVisibleSyntaxRange(range)) return
    if (!this.canQueryCurrentSyntaxRange()) return

    const uncoveredRange = firstUncoveredSyntaxRange(range, this.cachedSyntaxRanges)
    if (!uncoveredRange) return
    const pending = this.pendingVisibleRange
    if (
      this.rangeRequests.isActive() &&
      pending?.documentVersion === documentVersion &&
      pending.contentVersion === this.syntaxContentVersion &&
      syntaxRangeCoverage(uncoveredRange, [pending.range]) === 'full'
    )
      return
    this.pendingVisibleRange = {
      documentVersion,
      contentVersion: this.syntaxContentVersion,
      range: uncoveredRange,
    }

    this.scheduleSyntaxRangeRequest(
      this.rangeRequests,
      documentVersion,
      uncoveredRange,
      options,
      'visible',
    )
  }

  prefetchVisibleRange(
    documentVersion: number,
    range: EditorSyntaxRange | null,
    options: EditorSyntaxRefreshOptions = {},
  ): boolean {
    if (!this.syntaxSession?.queryRange) return false
    if (!this.options.getSession()) return false
    if (!this.canQueryCurrentSyntaxRange()) return false
    if (!range || syntaxRangeCoverage(range, this.cachedSyntaxRanges) === 'full') return false
    if (this.rangeRequests.isActive()) {
      this.pendingPrefetch = {
        contentVersion: this.syntaxContentVersion,
        documentVersion,
        options,
        range,
      }
      return true
    }

    this.scheduleSyntaxRangeRequest(
      this.prefetchRangeRequests,
      documentVersion,
      range,
      options,
      'prefetch',
    )
    return true
  }

  warmSyntaxAroundRange(
    documentVersion: number,
    seedRange: EditorSyntaxRange | null,
    options: EditorSyntaxRefreshOptions = {},
  ): void {
    if (!this.syntaxSession?.queryRange) return
    if (!this.options.getSession()) return
    if (!this.canQueryCurrentSyntaxRange()) return
    if (!seedRange) return
    const snapshot = this.options.getSession()?.getTextSnapshot()
    if (
      this.stoppedWarm &&
      this.stoppedWarm.snapshot === snapshot &&
      this.stoppedWarm.configurationGeneration === this.initialHighlightConfigurationGeneration
    )
      return

    const pendingWarm = {
      configurationGeneration: this.initialHighlightConfigurationGeneration,
      contentVersion: this.syntaxContentVersion,
      delayMs: options.delayMs ?? 120,
      documentVersion,
      generation: this.nextWarmGeneration(),
      seedRange,
    }
    this.pendingWarm = pendingWarm
    this.warmRangeRequests.cancel()
    this.scheduleNextWarmRange(pendingWarm)
  }

  private reloadHighlighterSession(options: EditorSyntaxRefreshOptions = {}): void {
    if (this.disposed) return

    this.disposeHighlighterSession()

    const session = this.options.getSession()
    if (!session) return

    this.highlighterSession = this.createHighlighterSession(
      this.options.getCurrentSessionDocumentId(),
      this.options.getLanguageId(),
      session.getTextSnapshot(),
      session.getSnapshot(),
    )
    this.refreshHighlighterTheme()
    this.refreshHighlightTokens(this.options.getDocumentVersion(), null, options)
    this.observeHighlighterTheme()
  }

  private createSyntaxSession(
    document: EditorSyntaxDocumentStartOptions,
  ): EditorSyntaxSession | null {
    if (!document.languageId) return null

    const includeCaptures = this.options.needsSyntaxCaptures?.() ?? false
    this.syntaxSessionIncludesCaptures = includeCaptures
    const sessionOptions = {
      documentId: document.documentId,
      languageId: document.languageId,
      includeHighlights: !this.highlighterSession,
      includeCaptures,
      syntaxMode: 'range' as const,
      textSnapshot: document.textSnapshot,
      snapshot: document.snapshot,
    }
    const provider = this.options.pluginHost.getSyntaxProvider()
    this.retainedSyntax =
      this.analysis && provider
        ? this.analysis.borrowStructural({
            ...sessionOptions,
            provider,
            configurationTag: this.structuralConfigurationTag,
          })
        : null
    this.retainedSyntax?.setDisplayDemand({ kind: 'unknown' })
    const session =
      this.retainedSyntax ??
      this.options.pluginHost.createSyntaxSession(sessionOptions) ??
      getEditorSyntaxSessionFactory()?.(sessionOptions) ??
      null
    if (session) {
      recordEditorPerformanceDiagnostic('editor.syntax.session_created', {
        family: 'structural',
      })
    }
    return session
  }

  private observeHighlighterTheme(): void {
    this.unsubscribeHighlighterTheme?.()
    this.unsubscribeHighlighterTheme =
      this.highlighterSession?.onDidChangeTheme?.(() => {
        this.failedHighlightRefreshes = 0
        this.refreshHighlightTokens(this.options.getDocumentVersion(), null, { delayMs: 0 })
      }) ?? null
  }

  private preparedStructuralConfiguration(
    languageId: EditorSyntaxLanguageId | null,
    hasStructuralProvider: boolean,
    hasHighlighterProvider: boolean,
  ): EditorPreparedStructuralConfiguration | null {
    if (!languageId || !hasStructuralProvider) return null

    return {
      includeCaptures: this.options.needsSyntaxCaptures?.() ?? false,
      includeHighlights: !hasHighlighterProvider,
      syntaxMode: 'range',
    }
  }

  private observePreparedResults(prepared: EditorPreparedDocumentPayload | null): void {
    if (!prepared) return

    const documentVersion = this.options.getDocumentVersion()
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    const contentVersion = this.syntaxContentVersion
    const structural = prepared.structural
    if (structural && !structural.readyResult) {
      void structural.result.then(
        (result) =>
          this.applyPreparedStructuralResult(
            structural,
            result,
            documentVersion,
            configurationGeneration,
            contentVersion,
          ),
        () => this.recoverPreparedStructural(structural, documentVersion, configurationGeneration),
      )
    }
    const highlighter = prepared.highlighter
    if (!highlighter || highlighter.readyResult) return
    void highlighter.result.then(
      (result) =>
        this.applyPreparedHighlighterResult(
          highlighter,
          result,
          documentVersion,
          configurationGeneration,
          contentVersion,
        ),
      () => this.recoverPreparedHighlighter(highlighter, documentVersion, configurationGeneration),
    )
  }

  private applyPreparedHighlighterResult(
    transfer: EditorPreparedHighlighterBorrow,
    result: EditorHighlightResult,
    documentVersion: number,
    configurationGeneration: number,
    contentVersion: number,
  ): void {
    if (
      !this.preparedResultStillCurrent(transfer.session, documentVersion, configurationGeneration)
    ) {
      return
    }
    if (contentVersion !== this.syntaxContentVersion) return

    this.applyHighlightResult(result, documentVersion, nowMs(), configurationGeneration)
  }

  private applyPreparedStructuralResult(
    transfer: EditorPreparedStructuralBorrow,
    result: EditorSyntaxResult,
    documentVersion: number,
    configurationGeneration: number,
    contentVersion: number,
  ): void {
    if (this.syntaxSession !== transfer.session) return

    this.applySyntaxResult(
      {
        contentVersion,
        range: transfer.range,
        result,
        source: 'visible',
        suppressWarm: true,
        updatesDocument: true,
      },
      documentVersion,
      nowMs(),
      configurationGeneration,
    )
  }

  private recoverPreparedStructural(
    transfer: EditorPreparedStructuralBorrow,
    documentVersion: number,
    configurationGeneration: number,
  ): void {
    if (
      !this.preparedResultStillCurrent(transfer.session, documentVersion, configurationGeneration)
    ) {
      return
    }

    this.disposeSyntaxSession()
    const session = this.options.getSession()
    if (!session) return
    this.syntaxSession = this.createSyntaxSession({
      documentId: this.options.getCurrentSessionDocumentId(),
      languageId: this.options.getLanguageId(),
      textSnapshot: session.getTextSnapshot(),
      snapshot: session.getSnapshot(),
    })
    this.syntaxStatus = this.syntaxSession ? 'loading' : 'plain'
    this.refreshStructuralSyntax(documentVersion, null)
  }

  private recoverPreparedHighlighter(
    transfer: EditorPreparedHighlighterBorrow,
    documentVersion: number,
    configurationGeneration: number,
  ): void {
    if (
      !this.preparedResultStillCurrent(transfer.session, documentVersion, configurationGeneration)
    ) {
      return
    }

    this.disposeHighlighterSession()
    const session = this.options.getSession()
    if (!session) return
    this.highlighterSession = this.createHighlighterSession(
      this.options.getCurrentSessionDocumentId(),
      this.options.getLanguageId(),
      session.getTextSnapshot(),
      session.getSnapshot(),
    )
    this.refreshHighlightTokens(documentVersion, null)
    this.observeHighlighterTheme()
  }

  private preparedResultStillCurrent(
    session: EditorSyntaxSession | EditorHighlighterSession,
    documentVersion: number,
    configurationGeneration: number,
  ): boolean {
    if (documentVersion !== this.options.getDocumentVersion()) return false
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return false
    return this.syntaxSession === session || this.highlighterSession === session
  }

  private createHighlighterSession(
    documentId: string,
    languageId: EditorSyntaxLanguageId | null,
    textSnapshot: DocumentTextSnapshot,
    snapshot: PieceTableSnapshot,
  ): EditorHighlighterSession | null {
    const provider = this.options.pluginHost.getHighlighterProvider()
    this.retainedHighlighter =
      this.analysis && provider
        ? this.analysis.borrowHighlighter({
            provider,
            languageId,
            configurationTag: this.highlighterConfigurationTag,
          })
        : null
    const session =
      this.retainedHighlighter ??
      this.options.pluginHost.createHighlighterSession({
        documentId,
        languageId,
        textSnapshot,
        snapshot,
      })
    if (session) {
      recordEditorPerformanceDiagnostic('editor.syntax.session_created', {
        family: 'highlighter',
      })
    }
    return session
  }

  private disposeSyntaxSession(): void {
    this.stoppedWarm = null
    this.syntaxRequests.cancel()
    this.rangeRequests.cancel()
    this.prefetchRangeRequests.cancel()
    this.warmRangeRequests.cancel()
    this.pendingPrefetch = null
    this.pendingWarm = null
    this.clearSyntaxRangeCache()
    this.parsedSyntaxContentVersion = null
    this.pendingSyntaxContentVersion = null
    if (this.preparedSyntaxDisposer) this.preparedSyntaxDisposer()
    else this.syntaxSession?.dispose()
    this.preparedSyntaxDisposer = null
    this.preparedStructuralContentVersion = null
    this.syntaxSession = null
    this.retainedSyntax = null
    this.structuralDispatchPoint = null
    this.syntaxSessionIncludesCaptures = false
  }

  private scheduleSyntaxRangeRequest(
    request: LatestAsyncRequest<EditorSyntaxLoadResult>,
    documentVersion: number,
    range: EditorSyntaxRange,
    options: EditorSyntaxRefreshOptions,
    kind: 'visible' | 'prefetch',
  ): void {
    const contentVersion = this.syntaxContentVersion
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    request.schedule({
      delayMs: options.delayMs ?? 50,
      tags: syntaxWorkTags(documentVersion, contentVersion, kind, range),
      run: traceEditorPerformanceTask('editor.syntax.range.request', (signal: AbortSignal) =>
        this.loadSyntaxRangeResult(range, kind, { contentVersion, signal }),
      ),
      apply: traceEditorPerformanceTask('editor.syntax.range.apply', (result, startedAt) => {
        const applied = this.applySyntaxResult(
          result,
          documentVersion,
          startedAt,
          configurationGeneration,
        )
        if (applied && kind === 'visible' && this.foldsCoverViewport()) {
          if (!this.flushPendingPrefetch()) this.flushPendingWarm()
        }
        if (applied && kind === 'prefetch') this.flushPendingWarm()
      }),
      fail: traceEditorPerformanceTask('editor.syntax.range.fail', (error, startedAt) =>
        this.recoverSyntaxError(documentVersion, null, error, startedAt, configurationGeneration),
      ),
    })
  }

  private repaintCachedVisibleSyntaxRange(range: EditorSyntaxRange): boolean {
    const coverage = syntaxRangeCoverage(range, this.cachedSyntaxRanges)
    if (coverage === 'none') return false

    if (coverage === 'partial') {
      this.options.adoptTokens(this.currentTokens)
      return false
    }

    this.rangeRequests.cancel()
    this.applyCachedSyntaxFolds(range)
    this.options.adoptTokens(this.currentTokens)
    return true
  }

  private disposeHighlighterSession(): void {
    this.unsubscribeHighlighterTheme?.()
    this.unsubscribeHighlighterTheme = null
    this.highlightRequests.cancel()
    this.highlightDispatchPoint = null
    if (this.preparedHighlighterDisposer) this.preparedHighlighterDisposer()
    else this.highlighterSession?.dispose()
    this.preparedHighlighterDisposer = null
    this.preparedHighlighterContentVersion = null
    this.highlighterSession = null
    this.retainedHighlighter = null
    this.setHighlighterTheme(null)
  }

  private refreshStructuralSyntax(
    documentVersion: number,
    change: DocumentSessionChange | null,
    options: EditorSyntaxRefreshOptions = {},
  ): void {
    const session = this.options.getSession()
    if (!this.syntaxSession || !session || !this.options.getLanguageId()) return

    this.syntaxStatus = 'loading'
    const contentVersion = this.syntaxContentVersion
    const configurationGeneration = this.initialHighlightConfigurationGeneration
    this.pendingSyntaxContentVersion = contentVersion

    const delayMs = options.delayMs ?? syntaxRefreshDelay(change)
    this.syntaxRequests.schedule({
      delayMs,
      maxDelayMs: SYNTAX_REFRESH_MAX_DELAY_MS,
      tags: syntaxWorkTags(documentVersion, contentVersion, 'full'),
      run: traceEditorPerformanceTask('editor.syntax.structural.request', () =>
        this.loadSyntaxResult(change, contentVersion),
      ),
      apply: traceEditorPerformanceTask('editor.syntax.structural.apply', (result, startedAt) =>
        this.applySyntaxResult(result, documentVersion, startedAt, configurationGeneration),
      ),
      fail: traceEditorPerformanceTask('editor.syntax.structural.fail', (error, startedAt) =>
        this.recoverSyntaxError(documentVersion, change, error, startedAt, configurationGeneration),
      ),
    })
  }

  private refreshHighlightTokens(
    documentVersion: number,
    change: DocumentSessionChange | null,
    options: EditorSyntaxRefreshOptions = {},
  ): void {
    const session = this.options.getSession()
    if (!this.highlighterSession || !session) return

    const configurationGeneration = this.initialHighlightConfigurationGeneration
    const delayMs = options.delayMs ?? syntaxRefreshDelay(change)
    this.highlightRequests.schedule({
      delayMs,
      maxDelayMs: SYNTAX_REFRESH_MAX_DELAY_MS,
      tags: { version: documentVersion, configuration: 'highlight' },
      run: traceEditorPerformanceTask('editor.syntax.highlight.request', () =>
        this.loadHighlightResult(change),
      ),
      apply: traceEditorPerformanceTask('editor.syntax.highlight.apply', (result, startedAt) =>
        this.applyHighlightResult(result, documentVersion, startedAt, configurationGeneration),
      ),
      fail: traceEditorPerformanceTask('editor.syntax.highlight.fail', (_error, startedAt) =>
        this.recoverHighlightError(
          documentVersion,
          change,
          _error,
          startedAt,
          configurationGeneration,
        ),
      ),
    })
  }

  private loadSyntaxResult(
    change: DocumentSessionChange | null,
    contentVersion: number,
  ): Promise<EditorSyntaxLoadResult> {
    if (!this.syntaxSession) return Promise.reject(new Error('No syntax session'))
    return this.loadSyntaxBaseResult(change).then((result) => {
      if (this.syntaxSession?.queryRange && this.canProviderQuerySyntaxRange()) {
        return this.loadCurrentSyntaxRangeResult({ contentVersion, updatesDocument: true })
      }

      return { contentVersion, range: null, result, source: 'full', updatesDocument: true }
    })
  }

  private loadSyntaxBaseResult(change: DocumentSessionChange | null): Promise<EditorSyntaxResult> {
    if (!this.syntaxSession) return Promise.reject(new Error('No syntax session'))
    const session = this.options.getSession()
    if (!session) return Promise.reject(new Error('No document snapshot'))

    const chain = this.options.getDocumentEditChain()
    const point = this.structuralDispatchPoint
    this.structuralDispatchPoint = chain.point
    if (!change) return this.syntaxSession.refresh(session.getTextSnapshot())

    return this.syntaxSession.applyChange(composeSkippedChanges(chain, point, change))
  }

  private loadCurrentSyntaxRangeResult(options: {
    readonly contentVersion: number
    readonly updatesDocument?: boolean
  }): Promise<EditorSyntaxLoadResult> {
    const range = this.options.getVisibleSyntaxRange()
    if (!range) {
      return Promise.resolve({
        contentVersion: options.contentVersion,
        range: null,
        result: this.syntaxSession?.getResult() ?? createEmptySyntaxResult(),
        source: 'full',
        updatesDocument: options.updatesDocument,
      })
    }
    return this.loadSyntaxRangeResult(range, 'visible', options)
  }

  private loadSyntaxRangeResult(
    range: EditorSyntaxRange,
    source: EditorSyntaxLoadSource,
    options: {
      readonly contentVersion?: number
      readonly updatesDocument?: boolean
      readonly signal?: AbortSignal
    } = {},
  ): Promise<EditorSyntaxLoadResult> {
    const contentVersion = options.contentVersion ?? this.syntaxContentVersion
    if (!this.syntaxSession?.queryRange) {
      return Promise.resolve({
        contentVersion,
        range: null,
        result: this.syntaxSession?.getResult() ?? createEmptySyntaxResult(),
        source: 'full',
        updatesDocument: options.updatesDocument,
      })
    }
    if (!this.canQuerySyntaxRangeForRequest(options.updatesDocument === true)) {
      return Promise.resolve({
        contentVersion,
        range: null,
        result: createEmptySyntaxResult(),
        source,
        skipApply: true,
        updatesDocument: options.updatesDocument,
      })
    }

    const result = this.retainedSyntax
      ? this.retainedSyntax.queryRange(range, { signal: options.signal })
      : this.syntaxSession.queryRange(range)
    return result.then((result) => ({
      contentVersion,
      range,
      result,
      source,
      updatesDocument: options.updatesDocument,
    }))
  }

  private loadHighlightResult(
    change: DocumentSessionChange | null,
  ): Promise<EditorHighlightResult> {
    if (!this.highlighterSession) return Promise.reject(new Error('No highlighter session'))
    const session = this.options.getSession()
    if (!session) return Promise.reject(new Error('No document snapshot'))

    const chain = this.options.getDocumentEditChain()
    const point = this.highlightDispatchPoint
    this.highlightDispatchPoint = chain.point
    if (!change) return this.highlighterSession.refresh(session.getTextSnapshot())

    return this.highlighterSession.applyChange(composeSkippedChanges(chain, point, change))
  }

  private applySyntaxResult(
    loadResult: EditorSyntaxLoadResult,
    documentVersion: number,
    _startedAt: number,
    configurationGeneration: number,
  ): boolean {
    const session = this.options.getSession()
    if (loadResult.skipApply) return false
    if (!session || documentVersion !== this.options.getDocumentVersion()) return false
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return false
    if (loadResult.contentVersion !== this.syntaxContentVersion) return false

    this.applyingRenderData = true
    try {
      return this.publishSyntaxResult(loadResult, documentVersion, configurationGeneration)
    } finally {
      this.applyingRenderData = false
      this.options.notifyViewUpdate()
    }
  }

  private publishSyntaxResult(
    loadResult: EditorSyntaxLoadResult,
    documentVersion: number,
    configurationGeneration: number,
  ): boolean {
    if (editorPerformanceDiagnosticsEnabled()) {
      recordEditorPerformanceDiagnostic('editor.syntax.structural.accepted', () => ({
        documentVersion,
        contentVersion: loadResult.contentVersion,
        source: loadResult.source,
      }))
    }
    const result = loadResult.result
    if (loadResult.updatesDocument) this.markSyntaxDocumentCurrent(loadResult.contentVersion)
    const snapshot = this.options.getSession()?.getTextSnapshot()
    const canOwnRanges =
      this.rangeTokenOwner?.store === this.currentTokens ||
      this.currentTokens.length === 0 ||
      (snapshot &&
        loadResult.range?.startIndex === 0 &&
        loadResult.range.endIndex >= snapshot.length)
    const nextTokens = this.highlighterSession
      ? this.currentTokens
      : this.syntaxTokensForResult(result.tokens, loadResult.range)
    // Brackets and injected spans share the folds gate: all of them are whole-scope facts, and a
    // window that does not cover the viewport would pair brackets across the part it never parsed
    // and report the rest of the document as being in the host language.
    const applyScopeFacts = this.shouldApplySyntaxFolds(loadResult)
    // Ahead of the tokens, because adopting them is the only notification this pass sends the view
    // contributions: a bracket list assigned after it is a parse late to everyone reading the
    // snapshot, and on a document nobody touches after opening it that means never.
    const contributor = loadResult.range ? this.rememberSyntaxRange(loadResult.range, result) : null
    if (applyScopeFacts) {
      this.rangeScopeOwner = contributor
      this.currentBrackets = result.brackets
      this.currentInjections = result.injections
      this.syntaxStatus = result.degraded ? 'degraded' : 'ready'
      this.foldCoverage = loadResult.range
        ? { kind: 'range', range: loadResult.range }
        : { kind: 'full' }
      this.options.setSyntaxFolds(result.folds)
      this.options.setSyntaxCaptures?.(result.captures, result.records)
    }
    if (!applyScopeFacts) {
      const visibleRange = this.options.getVisibleSyntaxRange()
      if (visibleRange) this.applyCachedSyntaxFolds(visibleRange)
    }
    if (!this.highlighterSession) {
      const status: SettledHighlightStatus = result.degraded ? 'degraded' : 'painted'
      const copyTokens = loadResult.range ? toEditorTokenStore(result.tokens) : nextTokens
      this.rangeTokenOwner =
        contributor && canOwnRanges ? { store: nextTokens, snapshot: contributor.snapshot } : null
      this.rangeCopyOwner = contributor ? { store: copyTokens, contributor } : null
      this.commitInitialHighlightStatus(
        status,
        () => this.setTokens(nextTokens, true, copyTokens),
        configurationGeneration,
      )
    }
    if (
      !this.highlighterSession &&
      loadResult.range &&
      !loadResult.suppressWarm &&
      !this.pendingWarm
    ) {
      this.warmSyntaxAroundRange(documentVersion, loadResult.range)
    }
    if (
      this.highlighterSession &&
      this.pendingReplacementMatches('syntax', configurationGeneration)
    ) {
      this.commitInitialHighlightStatus(
        'painted',
        () => this.setTokens(this.currentTokens, false),
        configurationGeneration,
      )
    }
    this.options.log?.({
      action: 'editor.syntax.structural_applied',
      level: 'debug',
      syntax: {
        ...this.fallbackFoldSelection,
        documentVersion,
        contentVersion: loadResult.contentVersion,
        source: loadResult.source,
        foldingSupport: this.syntaxSession?.foldingSupport ?? 'unsupported',
        foldCount: result.folds.length,
        viewportCovered: this.foldsCoverViewport(),
        scopeFactsApplied: applyScopeFacts,
        status: this.status,
      },
    })
    if (!this.usesFallbackFolds && !this.foldsCoverViewport()) {
      this.refreshVisibleRange(documentVersion, { delayMs: 0 })
    }
    this.options.notifyChange(null)
    return true
  }

  private shouldApplySyntaxFolds(loadResult: EditorSyntaxLoadResult): boolean {
    if (!loadResult.range) return true

    const visibleRange = this.options.getVisibleSyntaxRange()
    if (!visibleRange) return false
    return syntaxRangeCoverage(visibleRange, [loadResult.range]) === 'full'
  }

  private canProviderQuerySyntaxRange(): boolean {
    return this.syntaxSession?.canQueryRange?.() ?? true
  }

  private canQueryCurrentSyntaxRange(): boolean {
    return this.canProviderQuerySyntaxRange() && this.syntaxDocumentVersionIsCurrent()
  }

  private canQuerySyntaxRangeForRequest(updatesDocument: boolean): boolean {
    if (updatesDocument) return this.canProviderQuerySyntaxRange()
    return this.canQueryCurrentSyntaxRange()
  }

  private syntaxDocumentVersionIsCurrent(): boolean {
    return this.parsedSyntaxContentVersion === this.syntaxContentVersion
  }

  private markSyntaxDocumentCurrent(contentVersion: number): void {
    this.parsedSyntaxContentVersion = contentVersion
    if (this.pendingSyntaxContentVersion === contentVersion) {
      this.pendingSyntaxContentVersion = null
    }
  }

  private resetSyntaxContentVersion(): void {
    this.syntaxContentVersion += 1
    this.parsedSyntaxContentVersion = null
    this.pendingSyntaxContentVersion = null
  }

  private flushPendingPrefetch(): boolean {
    const pending = this.pendingPrefetch
    this.pendingPrefetch = null
    if (!pending) return false
    if (pending.documentVersion !== this.options.getDocumentVersion()) return false
    if (pending.contentVersion !== this.syntaxContentVersion) return false

    const scheduled = this.prefetchVisibleRange(
      pending.documentVersion,
      pending.range,
      pending.options,
    )
    if (!scheduled) this.flushPendingWarm()
    return scheduled
  }

  private flushPendingWarm(): void {
    const pending = this.pendingWarm
    if (!pending) return
    if (pending.documentVersion !== this.options.getDocumentVersion()) return
    if (pending.contentVersion !== this.syntaxContentVersion) return
    if (pending.configurationGeneration !== this.initialHighlightConfigurationGeneration) return

    this.scheduleNextWarmRange(pending)
  }

  private scheduleNextWarmRange(pending: PendingSyntaxWarm): void {
    if (pending.generation !== this.warmGeneration) return
    if (!this.canRunWarmRangeRequest()) return

    const range = this.nextWarmRange(pending.seedRange)
    if (!range) {
      this.pendingWarm = null
      return
    }

    this.warmRangeRequests.schedule({
      delayMs: pending.delayMs,
      tags: syntaxWorkTags(pending.documentVersion, pending.contentVersion, 'warm', range),
      run: traceEditorPerformanceTask('editor.syntax.warm.request', (signal: AbortSignal) =>
        this.loadSyntaxRangeResult(range, 'warm', {
          contentVersion: pending.contentVersion,
          signal,
        }),
      ),
      apply: traceEditorPerformanceTask('editor.syntax.warm.apply', (result, startedAt) => {
        if (pending.generation !== this.warmGeneration) return
        const applied = this.applySyntaxResult(
          result,
          pending.documentVersion,
          startedAt,
          pending.configurationGeneration,
        )
        if (applied) this.scheduleNextWarmRange(pending)
      }),
      fail: traceEditorPerformanceTask('editor.syntax.warm.fail', (error, startedAt) =>
        this.recoverSyntaxError(
          pending.documentVersion,
          null,
          error,
          startedAt,
          pending.configurationGeneration,
        ),
      ),
    })
  }

  private canRunWarmRangeRequest(): boolean {
    if (!this.syntaxSession?.queryRange) return false
    if (!this.options.getSession()) return false
    if (!this.canQueryCurrentSyntaxRange()) return false
    if (this.rangeRequests.isActive()) return false
    return !this.prefetchRangeRequests.isActive()
  }

  private nextWarmRange(seedRange: EditorSyntaxRange): EditorSyntaxRange | null {
    const session = this.options.getSession()
    const documentLength = session?.getSnapshot().length ?? 0
    return nextUncachedSyntaxWarmRange(documentLength, seedRange, this.cachedSyntaxRanges)
  }

  private nextWarmGeneration(): number {
    this.warmGeneration += 1
    return this.warmGeneration
  }

  private syntaxTokensForResult(
    tokens: EditorTokenInput,
    range: EditorSyntaxRange | null,
  ): EditorTokenStore {
    const store = toEditorTokenStore(tokens)
    if (!range) return store
    return mergeSyntaxRangeTokens(this.currentTokens, store, range)
  }

  private applyCachedSyntaxFolds(range: EditorSyntaxRange): void {
    const folds = cachedSyntaxFoldsForRange(
      range,
      this.cachedSyntaxFoldRanges,
      this.cachedSyntaxRanges,
    )
    if (!folds) return

    this.foldCoverage = { kind: 'range', range }
    this.syntaxStatus = 'ready'
    this.options.setSyntaxFolds(folds)
    this.options.notifyViewUpdate()
  }

  private rememberSyntaxRange(
    range: EditorSyntaxRange,
    result: EditorSyntaxResult,
  ): CachedSyntaxFoldRange | null {
    const snapshot = this.options.getSession()?.getTextSnapshot()
    if (!snapshot) return null
    const contributor: CachedSyntaxFoldRange = {
      range,
      result,
      snapshot,
      folds: result.folds,
      tokenRanges: [range],
    }
    this.cachedSyntaxRanges = appendCachedSyntaxRange(this.cachedSyntaxRanges, range)
    const previous = this.cachedSyntaxFoldRanges.map((cached) => ({
      ...cached,
      tokenRanges: subtractSyntaxRange(cached.tokenRanges, range),
    }))
    this.cachedSyntaxFoldRanges = appendCachedSyntaxFoldRange(previous, contributor)
    return contributor
  }

  private clearSyntaxRangeCache(): void {
    this.lastRangeTrim = null
    this.rangeTokenOwner = null
    this.rangeCopyOwner = null
    this.rangeScopeOwner = null
    this.foldCoverage = null
    this.cachedSyntaxRanges = []
    this.cachedSyntaxFoldRanges = []
  }

  private projectSyntaxRangeCache(change: DocumentSessionChange): void {
    const edit = change.edits[0]
    if (change.edits.length !== 1 || !edit || !canProjectSyntaxRangeCacheThroughEdit(edit)) {
      this.clearSyntaxRangeCache()
      return
    }

    this.cachedSyntaxRanges = projectCachedSyntaxRanges(
      this.cachedSyntaxRanges,
      edit,
      change.snapshot.length,
    )
    this.cachedSyntaxFoldRanges = projectCachedSyntaxFoldRanges(
      this.cachedSyntaxFoldRanges,
      edit,
      change.snapshot.length,
      change.textSnapshot,
    )
  }

  private applyHighlightResult(
    result: EditorHighlightResult,
    documentVersion: number,
    _startedAt: number,
    configurationGeneration: number,
  ): void {
    const session = this.options.getSession()
    if (!session || documentVersion !== this.options.getDocumentVersion()) return
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return

    if (editorPerformanceDiagnosticsEnabled()) {
      recordEditorPerformanceDiagnostic('editor.syntax.highlight.accepted', () => ({
        documentVersion,
        configurationGeneration,
      }))
    }
    const failedRefreshes = this.failedHighlightRefreshes
    this.failedHighlightRefreshes = 0
    if (result.theme !== undefined) this.setHighlighterTheme(result.theme)
    this.commitInitialHighlightStatus(
      'painted',
      () => this.setTokens(result.tokens),
      configurationGeneration,
    )
    this.options.log?.({
      action: 'editor.syntax.highlight_applied',
      level: 'debug',
      syntax: {
        documentVersion,
        tokenCount: result.tokens.length,
      },
    })
    if (failedRefreshes > 0) {
      this.options.log?.({
        action: 'editor.syntax.highlight_recovered',
        level: 'info',
        syntax: { ...this.debugContext(documentVersion), attempts: failedRefreshes + 1 },
      })
    }
    this.options.notifyChange(null)
  }

  private applySyntaxError(documentVersion: number, configurationGeneration: number): void {
    if (documentVersion !== this.options.getDocumentVersion()) return
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return

    this.syntaxStatus = 'error'
    this.options.clearSyntaxFolds()
    this.options.notifyViewUpdate()
    if (!this.highlighterSession) this.commitInitialHighlightError(configurationGeneration)
    if (
      this.highlighterSession &&
      this.pendingReplacementMatches('syntax', configurationGeneration)
    ) {
      const terminalStatus = this.lastInitialHighlightTerminalStatus ?? 'painted'
      this.commitInitialHighlightStatus(
        terminalStatus,
        () => this.setTokens(this.currentTokens, false),
        configurationGeneration,
      )
    }
    warnEditorSyntax('mark structural syntax error', this.debugContext(documentVersion))
    this.options.notifyChange(null)
  }

  private recoverSyntaxError(
    documentVersion: number,
    change: DocumentSessionChange | null,
    error: unknown,
    startedAt: number,
    configurationGeneration: number,
  ): void {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (documentVersion !== this.options.getDocumentVersion()) return
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return
    const changeKind = change?.kind ?? 'refresh'

    if (!change) this.applySyntaxError(documentVersion, configurationGeneration)
    if (change) {
      warnEditorSyntax('reload structural syntax after edit failure', {
        ...this.debugContext(documentVersion),
        changeKind,
      })
      this.reloadSyntaxSession(false)
    }

    this.options.log?.({
      action: 'editor.syntax.structural_request_failed',
      level: 'error',
      error: syntaxLogError(error),
      syntax: {
        ...this.debugContext(documentVersion),
        changeKind,
        startedAt,
      },
    })
    warnEditorSyntax(`structural syntax request failed: ${syntaxErrorMessage(error)}`, {
      ...this.debugContext(documentVersion),
      changeKind,
      error: syntaxDebugError(error),
      startedAt,
    })
  }

  private applyHighlightError(
    documentVersion: number,
    error: unknown,
    configurationGeneration: number,
  ): void {
    const session = this.options.getSession()
    if (!session || documentVersion !== this.options.getDocumentVersion()) return
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return

    const attempts = this.failedHighlightRefreshes
    this.options.log?.({
      action: 'editor.syntax.highlight_retries_exhausted',
      level: 'warn',
      error: syntaxLogError(error),
      syntax: { ...this.debugContext(documentVersion), attempts },
    })
    warnEditorSyntax(
      `plugin highlighting failed ${attempts} times, clearing it: ${syntaxErrorMessage(error)}`,
      this.debugContext(documentVersion),
    )
    this.setHighlighterTheme(null)
    this.commitInitialHighlightStatus(
      'error',
      () => this.setTokens(EditorTokenStore.empty()),
      configurationGeneration,
    )
    this.options.notifyChange(null)
  }

  private recoverHighlightError(
    documentVersion: number,
    change: DocumentSessionChange | null,
    error: unknown,
    startedAt: number,
    configurationGeneration: number,
  ): void {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (documentVersion !== this.options.getDocumentVersion()) return
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return
    if (!change) this.failedHighlightRefreshes += 1
    this.options.log?.({
      action: 'editor.syntax.highlight_request_failed',
      level: 'warn',
      error: syntaxLogError(error),
      syntax: {
        ...this.debugContext(documentVersion),
        changeKind: change?.kind ?? 'refresh',
        failedRefreshes: this.failedHighlightRefreshes,
        startedAt,
      },
    })
    warnEditorSyntax(`plugin highlighting request failed: ${syntaxErrorMessage(error)}`, {
      ...this.debugContext(documentVersion),
      changeKind: change?.kind ?? 'refresh',
      error: syntaxDebugError(error),
      startedAt,
    })

    if (!change) {
      this.retryHighlightRefresh(documentVersion, error, configurationGeneration)
      return
    }

    warnEditorSyntax('reload plugin highlighter after edit failure', {
      ...this.debugContext(documentVersion),
      changeKind: change.kind,
    })
    // The reloaded session's refresh starts a fresh ladder, even after an earlier one ran out.
    this.failedHighlightRefreshes = 0
    this.reloadHighlighterSession()
  }

  // Each retry lands through applyHighlightResult or recoverHighlightError, which drop it once
  // the document version has moved on.
  private retryHighlightRefresh(
    documentVersion: number,
    error: unknown,
    configurationGeneration: number,
  ): void {
    const rung = this.failedHighlightRefreshes - 1
    const delayMs = HIGHLIGHT_RETRY_DELAYS_MS[rung]
    if (delayMs === undefined) {
      this.applyHighlightError(documentVersion, error, configurationGeneration)
      return
    }
    if (rung === HIGHLIGHT_RETRY_DELAYS_MS.length - 1) {
      this.reloadHighlighterSession({ delayMs })
      // A provider that declines the new session leaves nothing to retry.
      if (!this.highlighterSession) {
        this.applyHighlightError(documentVersion, error, configurationGeneration)
      }
      return
    }
    this.refreshHighlightTokens(documentVersion, null, { delayMs })
  }

  private debugContext(documentVersion: number): EditorSyntaxDebugPayload {
    const session = this.options.getSession()
    return {
      currentDocumentVersion: this.options.getDocumentVersion(),
      documentId: this.options.getCurrentSessionDocumentId(),
      documentLength: session?.getSnapshot().length ?? null,
      documentVersion,
      hasHighlighterSession: Boolean(this.highlighterSession),
      hasSyntaxSession: Boolean(this.syntaxSession),
      languageId: this.options.getLanguageId(),
      syntaxStatus: this.syntaxStatus,
      ...this.fallbackFoldSelection,
    }
  }

  private setHighlighterTheme(theme: EditorTheme | null | undefined): void {
    const nextTheme = theme ?? null
    if (editorThemesEqual(this.highlighterTheme, nextTheme)) return

    this.highlighterTheme = nextTheme
    this.options.log?.({
      action: 'editor.syntax.highlighter_theme_changed',
      level: 'debug',
      syntax: { hasTheme: nextTheme !== null },
    })
    this.options.notifyThemeChanged()
  }

  private setProviderHighlighterTheme(theme: EditorTheme | null | undefined): void {
    const nextTheme = theme ?? null
    if (editorThemesEqual(this.providerHighlighterTheme, nextTheme)) return

    this.providerHighlighterTheme = nextTheme
    this.options.log?.({
      action: 'editor.syntax.provider_theme_changed',
      level: 'debug',
      syntax: { hasTheme: nextTheme !== null },
    })
    this.options.notifyThemeChanged()
  }

  private completeProviderHighlighterTheme(theme: EditorTheme | null | undefined): void {
    this.highlighterThemePending = false
    this.setProviderHighlighterTheme(theme)

    const terminal = this.pendingInitialHighlightThemeTerminal
    this.pendingInitialHighlightThemeTerminal = null
    if (
      terminal &&
      terminal.configurationGeneration === this.initialHighlightConfigurationGeneration
    ) {
      this.commitInitialHighlightStatus(
        terminal.status,
        () => this.setTokens(this.currentTokens, false),
        terminal.configurationGeneration,
      )
      return
    }

    this.settlePlainInitialHighlightIfNeeded()
  }

  private beginInitialHighlightReplacement(replacement: InitialHighlightReplacement): number {
    if (!this.options.getSession()) return this.initialHighlightConfigurationGeneration

    const pending = this.pendingInitialHighlightReplacement
    if (!pending && this.initialHighlightState === 'loading' && replacement !== 'all') {
      return this.initialHighlightConfigurationGeneration
    }
    if (pending && replacementPriority(replacement) < replacementPriority(pending.kind)) {
      return pending.generation
    }

    if (replacement === 'theme') {
      const generation = this.initialHighlightConfigurationGeneration
      this.pendingInitialHighlightReplacement = { generation, kind: replacement }
      this.initialHighlightState = 'loading'
      this.options.notifyViewUpdate()
      return generation
    }

    const generation = this.advanceInitialHighlightConfigurationGeneration()
    this.pendingInitialHighlightReplacement = { generation, kind: replacement }
    this.initialHighlightState = 'loading'
    this.initialHighlightPaintEmitted = false
    this.options.notifyViewUpdate()
    return generation
  }

  private settlePlainInitialHighlightIfNeeded(): void {
    if (!this.options.getSession()) return
    if (this.highlighterSession || this.syntaxSession) return

    this.commitInitialHighlightStatus(
      'plain',
      () => this.options.notifyViewUpdate(),
      this.initialHighlightConfigurationGeneration,
    )
  }

  private currentApplicableTerminalStatus(): SettledHighlightStatus | null {
    if (this.highlighterSession) {
      if (this.initialHighlightState === 'error') return 'error'
      if (this.initialHighlightState === 'loading') return null
      return 'painted'
    }
    if (this.syntaxSession) {
      if (this.syntaxStatus === 'loading') return null
      if (this.syntaxStatus === 'degraded') return 'degraded'
      if (this.syntaxStatus === 'error') return 'error'
      return 'painted'
    }
    return 'plain'
  }

  private commitInitialHighlightError(configurationGeneration: number): void {
    this.commitInitialHighlightStatus(
      'error',
      () => this.options.notifyViewUpdate(),
      configurationGeneration,
    )
  }

  private commitInitialHighlightStatus(
    status: SettledHighlightStatus,
    publish: () => void,
    configurationGeneration: number,
  ): void {
    if (configurationGeneration !== this.initialHighlightConfigurationGeneration) return

    if (this.highlighterThemePending) {
      this.lastInitialHighlightTerminalStatus = status
      this.pendingInitialHighlightReplacement = null
      publish()
      this.pendingInitialHighlightThemeTerminal = {
        configurationGeneration,
        status,
      }
      return
    }

    this.initialHighlightState = status
    this.lastInitialHighlightTerminalStatus = status
    this.pendingInitialHighlightReplacement = null
    publish()
    this.emitInitialHighlightPaintIfReady()
  }

  private pendingReplacementMatches(
    kind: InitialHighlightReplacement,
    configurationGeneration: number,
  ): boolean {
    const pending = this.pendingInitialHighlightReplacement
    return pending?.generation === configurationGeneration && pending.kind === kind
  }

  private advanceInitialHighlightConfigurationGeneration(): number {
    this.stoppedWarm = null
    this.initialHighlightConfigurationGeneration += 1
    this.pendingInitialHighlightThemeTerminal = null
    return this.initialHighlightConfigurationGeneration
  }

  private emitInitialHighlightPaintIfReady(): void {
    if (!this.initialTextPainted || this.initialHighlightPaintEmitted) return
    if (this.initialHighlightState === 'loading' || this.initialHighlightState === 'idle') return
    if (this.initialPaintDocumentVersion !== this.options.getDocumentVersion()) return

    this.initialHighlightPaintEmitted = true
    this.options.onInitialPaint?.({
      ...this.initialPaintEventBase(),
      phase: 'highlight-settled',
      status: this.initialHighlightState,
    })
  }

  private initialPaintEventBase(): Omit<EditorInitialPaintEvent, 'phase' | 'status'> {
    return {
      documentId: this.options.getDocumentId(),
      documentGeneration: this.initialPaintDocumentVersion,
      textVersion: this.options.getTextVersion(),
    }
  }

  private logSyntaxStatus(
    action: string,
    level: 'debug' | 'info' | 'warn' | 'error' = 'info',
  ): void {
    recordEditorPerformanceDiagnostic(action, () =>
      this.debugContext(this.options.getDocumentVersion()),
    )
    this.options.log?.({
      action,
      level,
      syntax: this.debugContext(this.options.getDocumentVersion()),
    })
  }
}

type EditorSyntaxDebugPayload = Record<string, unknown>

const replacementPriority = (replacement: InitialHighlightReplacement): number => {
  if (replacement === 'all') return 2
  if (replacement === 'syntax') return 1
  return 0
}

const warnEditorSyntax = (message: string, payload: EditorSyntaxDebugPayload): void => {
  console.warn(`[editor-syntax] ${message}\n${JSON.stringify(payload, null, 2)}`)
}

const syntaxDebugError = (error: unknown): EditorSyntaxDebugPayload => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { value: String(error) }
}

const syntaxLogError = (
  error: unknown,
): { readonly message: string; readonly name?: string; readonly stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    }
  }

  return { message: String(error) }
}

const syntaxErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const mergeSyntaxRangeTokens = (
  currentTokens: EditorTokenStore,
  rangeTokens: EditorTokenStore,
  range: EditorSyntaxRange,
): EditorTokenStore =>
  currentTokens.replaceOffsetRange(range.startIndex, range.endIndex, rangeTokens)

const appendCachedSyntaxRange = (
  ranges: readonly EditorSyntaxRange[],
  range: EditorSyntaxRange,
): readonly EditorSyntaxRange[] => {
  if (range.endIndex <= range.startIndex) return ranges

  const merged: EditorSyntaxRange[] = []
  const sorted = ranges.concat(range).sort(compareSyntaxRanges)
  for (const current of sorted) mergeCachedSyntaxRange(merged, current)
  return merged
}

const mergeCachedSyntaxRange = (ranges: EditorSyntaxRange[], range: EditorSyntaxRange): void => {
  const previous = ranges.at(-1)
  if (!previous || range.startIndex > previous.endIndex) {
    ranges.push(range)
    return
  }

  ranges[ranges.length - 1] = {
    startIndex: previous.startIndex,
    endIndex: Math.max(previous.endIndex, range.endIndex),
  }
}

const appendCachedSyntaxFoldRange = (
  ranges: readonly CachedSyntaxFoldRange[],
  range: CachedSyntaxFoldRange,
): readonly CachedSyntaxFoldRange[] => {
  if (range.range.endIndex <= range.range.startIndex) return ranges

  const next = ranges.filter((current) => !sameSyntaxRange(current.range, range.range))
  next.push(range)
  return next
}

const projectCachedSyntaxRanges = (
  ranges: readonly EditorSyntaxRange[],
  edit: TextEdit,
  documentLength: number,
): readonly EditorSyntaxRange[] => {
  const projected: EditorSyntaxRange[] = []
  for (const range of ranges) {
    const next = projectSyntaxRangeThroughInsertion(range, edit, documentLength)
    if (next.endIndex > next.startIndex) projected.push(next)
  }
  return projected
}

const projectCachedSyntaxFoldRanges = (
  ranges: readonly CachedSyntaxFoldRange[],
  edit: TextEdit,
  documentLength: number,
  snapshot: DocumentTextSnapshot,
): readonly CachedSyntaxFoldRange[] => {
  const projected: CachedSyntaxFoldRange[] = []
  for (const range of ranges) {
    const nextRange = projectSyntaxRangeThroughInsertion(range.range, edit, documentLength)
    if (nextRange.endIndex <= nextRange.startIndex) continue
    projected.push({
      ...range,
      snapshot,
      range: nextRange,
      tokenRanges: projectCachedSyntaxRanges(range.tokenRanges, edit, documentLength),
      folds: projectFoldRangesThroughInsertion(range.folds, edit, documentLength),
    })
  }
  return projected
}

const canProjectSyntaxRangeCacheThroughEdit = (edit: TextEdit): boolean => {
  if (edit.to !== edit.from) return false
  return lineBreakCount(edit.text) === 0
}

const projectSyntaxRangeThroughInsertion = (
  range: EditorSyntaxRange,
  edit: TextEdit,
  documentLength: number,
): EditorSyntaxRange => {
  const delta = edit.text.length
  if (range.endIndex <= edit.from) return clampSyntaxRange(range, documentLength)
  if (range.startIndex >= edit.from) {
    return clampSyntaxRange(
      {
        startIndex: range.startIndex + delta,
        endIndex: range.endIndex + delta,
      },
      documentLength,
    )
  }

  return clampSyntaxRange(
    {
      startIndex: range.startIndex,
      endIndex: range.endIndex + delta,
    },
    documentLength,
  )
}

const projectFoldRangesThroughInsertion = (
  folds: readonly FoldRange[],
  edit: TextEdit,
  documentLength: number,
): readonly FoldRange[] => {
  const lineDelta = lineBreakCount(edit.text)
  const delta = edit.text.length
  return folds
    .map((fold) => projectFoldRangeThroughInsertion(fold, edit, delta, lineDelta, documentLength))
    .filter((fold): fold is FoldRange => fold !== null)
}

const projectFoldRangeThroughInsertion = (
  fold: FoldRange,
  edit: TextEdit,
  delta: number,
  lineDelta: number,
  documentLength: number,
): FoldRange | null => {
  if (edit.from <= fold.startIndex) {
    return normalizeProjectedFoldRange(
      {
        ...fold,
        startIndex: fold.startIndex + delta,
        endIndex: fold.endIndex + delta,
        startLine: fold.startLine + lineDelta,
        endLine: fold.endLine + lineDelta,
      },
      documentLength,
    )
  }

  if (edit.from < fold.endIndex) {
    return normalizeProjectedFoldRange(
      {
        ...fold,
        endIndex: fold.endIndex + delta,
        endLine: fold.endLine + lineDelta,
      },
      documentLength,
    )
  }

  return normalizeProjectedFoldRange(fold, documentLength)
}

const normalizeProjectedFoldRange = (fold: FoldRange, documentLength: number): FoldRange | null => {
  const startIndex = boundedSyntaxIndex(fold.startIndex, documentLength)
  const endIndex = boundedSyntaxIndex(fold.endIndex, documentLength)
  if (endIndex <= startIndex) return null
  const startLine = Math.max(0, fold.startLine)
  return {
    ...fold,
    startIndex,
    endIndex,
    startLine,
    endLine: Math.max(startLine, fold.endLine),
  }
}

const clampSyntaxRange = (range: EditorSyntaxRange, documentLength: number): EditorSyntaxRange => ({
  startIndex: boundedSyntaxIndex(range.startIndex, documentLength),
  endIndex: boundedSyntaxIndex(range.endIndex, documentLength),
})

const boundedSyntaxIndex = (index: number, documentLength: number): number =>
  Math.max(0, Math.min(index, documentLength))

const lineBreakCount = (text: string): number => {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') count += 1
  }
  return count
}

const cachedSyntaxFoldsForRange = (
  range: EditorSyntaxRange,
  cachedRanges: readonly CachedSyntaxFoldRange[],
  coverageRanges: readonly EditorSyntaxRange[],
): readonly FoldRange[] | null => {
  if (syntaxRangeCoverage(range, coverageRanges) !== 'full') return null

  const foldsByKey = new Map<string, FoldRange>()
  for (const cachedRange of cachedRanges) {
    if (!syntaxRangesIntersect(cachedRange.range, range)) continue
    for (const fold of cachedRange.folds) {
      if (!foldIntersectsSyntaxRange(fold, range)) continue
      foldsByKey.set(foldRangeKey(fold), fold)
    }
  }
  return Array.from(foldsByKey.values()).toSorted(compareFoldRanges)
}

const sameSyntaxRange = (left: EditorSyntaxRange, right: EditorSyntaxRange): boolean =>
  left.startIndex === right.startIndex && left.endIndex === right.endIndex

const syntaxRangesIntersect = (left: EditorSyntaxRange, right: EditorSyntaxRange): boolean =>
  left.startIndex < right.endIndex && left.endIndex > right.startIndex

const foldIntersectsSyntaxRange = (fold: FoldRange, range: EditorSyntaxRange): boolean =>
  fold.startIndex < range.endIndex && fold.endIndex > range.startIndex

const compareFoldRanges = (left: FoldRange, right: FoldRange): number =>
  left.startLine - right.startLine ||
  left.endLine - right.endLine ||
  left.startIndex - right.startIndex ||
  left.endIndex - right.endIndex

type SyntaxRangeCoverage = 'none' | 'partial' | 'full'

const syntaxRangeCoverage = (
  range: EditorSyntaxRange,
  cachedRanges: readonly EditorSyntaxRange[],
): SyntaxRangeCoverage => {
  let cursor = range.startIndex
  let overlaps = false
  for (const cachedRange of cachedRanges) {
    if (cachedRange.endIndex <= range.startIndex) continue
    if (cachedRange.startIndex >= range.endIndex) break

    overlaps = true
    if (cachedRange.endIndex <= cursor) continue
    if (cachedRange.startIndex > cursor) return 'partial'

    cursor = Math.max(cursor, cachedRange.endIndex)
    if (cursor >= range.endIndex) return 'full'
  }

  return overlaps ? 'partial' : 'none'
}

const firstUncoveredSyntaxRange = (
  range: EditorSyntaxRange,
  cachedRanges: readonly EditorSyntaxRange[],
): EditorSyntaxRange | null => {
  let cursor = range.startIndex
  for (const cachedRange of cachedRanges) {
    if (cachedRange.endIndex <= cursor) continue
    if (cachedRange.startIndex >= range.endIndex) break
    if (cachedRange.startIndex > cursor) {
      return { startIndex: cursor, endIndex: Math.min(cachedRange.startIndex, range.endIndex) }
    }

    cursor = Math.max(cursor, cachedRange.endIndex)
    if (cursor >= range.endIndex) return null
  }

  return { startIndex: cursor, endIndex: range.endIndex }
}

const compareSyntaxRanges = (left: EditorSyntaxRange, right: EditorSyntaxRange): number =>
  left.startIndex - right.startIndex || left.endIndex - right.endIndex

const nextUncachedSyntaxWarmRange = (
  documentLength: number,
  seedRange: EditorSyntaxRange,
  cachedRanges: readonly EditorSyntaxRange[],
): EditorSyntaxRange | null => {
  if (documentLength <= 0) return null

  const tileCount = Math.ceil(documentLength / BACKGROUND_SYNTAX_TILE_CHARS)
  const seedCenter = boundedIndex(
    Math.floor((seedRange.startIndex + seedRange.endIndex) / 2),
    documentLength,
  )
  const seedTile = Math.min(tileCount - 1, Math.floor(seedCenter / BACKGROUND_SYNTAX_TILE_CHARS))
  for (let distance = 0; distance < tileCount; distance += 1) {
    const forward = syntaxWarmTileRange(seedTile + distance, documentLength)
    if (isUncachedSyntaxWarmRange(forward, cachedRanges, seedRange)) return forward
    if (distance === 0) continue

    const backward = syntaxWarmTileRange(seedTile - distance, documentLength)
    if (isUncachedSyntaxWarmRange(backward, cachedRanges, seedRange)) return backward
  }

  return null
}

const syntaxWarmTileRange = (
  tileIndex: number,
  documentLength: number,
): EditorSyntaxRange | null => {
  if (tileIndex < 0) return null

  const startIndex = tileIndex * BACKGROUND_SYNTAX_TILE_CHARS
  if (startIndex >= documentLength) return null

  return {
    startIndex,
    endIndex: Math.min(documentLength, startIndex + BACKGROUND_SYNTAX_TILE_CHARS),
  }
}

const isUncachedSyntaxWarmRange = (
  range: EditorSyntaxRange | null,
  cachedRanges: readonly EditorSyntaxRange[],
  seedRange: EditorSyntaxRange,
): range is EditorSyntaxRange => {
  if (!range) return false
  if (syntaxRangesIntersect(range, seedRange)) return false
  return syntaxRangeCoverage(range, cachedRanges) !== 'full'
}

const boundedIndex = (index: number, documentLength: number): number =>
  Math.max(0, Math.min(index, Math.max(0, documentLength - 1)))
/**
 * Syntax and highlight requests are latest-wins, so the changes between two dispatches never reach
 * a session. Without their edits it can only diff whole texts, and that span covers everything
 * between two distant edits. The edit chain returns the skipped edits in the session's coordinates.
 */
function composeSkippedChanges(
  chain: Pick<DocumentEditChain, 'changesSince' | 'point'>,
  point: DocumentSyncPoint | null,
  change: DocumentSessionChange,
): DocumentSessionChange {
  if (!point) return change

  const composed = chain.changesSince(point, null)
  if (!composed?.edits || composed.syncPointAfter !== chain.point) return change
  return { ...change, edits: composed.edits }
}

function sameSyntaxRanges(
  left: readonly EditorSyntaxRange[],
  right: readonly EditorSyntaxRange[],
): boolean {
  return (
    left.length === right.length &&
    left.every((range, index) => sameSyntaxRange(range, right[index]!))
  )
}
function subtractSyntaxRange(
  ranges: readonly EditorSyntaxRange[],
  removed: EditorSyntaxRange,
): readonly EditorSyntaxRange[] {
  const remaining: EditorSyntaxRange[] = []
  for (const range of ranges) {
    if (!syntaxRangesIntersect(range, removed)) {
      remaining.push(range)
      continue
    }
    if (range.startIndex < removed.startIndex)
      remaining.push({ startIndex: range.startIndex, endIndex: removed.startIndex })
    if (range.endIndex > removed.endIndex)
      remaining.push({ startIndex: removed.endIndex, endIndex: range.endIndex })
  }
  return remaining
}
function intersectSyntaxRanges(
  ranges: readonly EditorSyntaxRange[],
  protectedRanges: readonly EditorSyntaxRange[],
): readonly EditorSyntaxRange[] {
  let intersection: readonly EditorSyntaxRange[] = []
  for (const range of ranges) {
    for (const protectedRange of protectedRanges) {
      const startIndex = Math.max(range.startIndex, protectedRange.startIndex)
      const endIndex = Math.min(range.endIndex, protectedRange.endIndex)
      if (endIndex > startIndex)
        intersection = appendCachedSyntaxRange(intersection, { startIndex, endIndex })
    }
  }
  return intersection
}
function activeFoldContributors(
  contributors: readonly CachedSyntaxFoldRange[],
  ranges: readonly EditorSyntaxRange[],
): readonly CachedSyntaxFoldRange[] {
  const winners = new Map<string, CachedSyntaxFoldRange>()
  for (const contributor of contributors) {
    for (const fold of contributor.folds) {
      if (ranges.some((range) => foldIntersectsSyntaxRange(fold, range)))
        winners.set(foldRangeKey(fold), contributor)
    }
  }
  return [...new Set(winners.values())]
}
function compactSyntaxRangeTokens(
  store: EditorTokenStore,
  ranges: readonly EditorSyntaxRange[],
): EditorTokenStore {
  const tokens: ReturnType<EditorTokenStore['tokenAt']>[] = []
  const selected = new Set<number>()
  for (const range of ranges) {
    const last = store.firstStartingAtOrAfter(range.endIndex)
    store.forEachInRange(
      store.firstEndingAfter(range.startIndex, last),
      last,
      (start, end, _style, index) => {
        if (end <= range.startIndex || selected.has(index)) return
        selected.add(index)
        tokens.push({ start, end, style: store.styleAt(index) })
      },
    )
  }
  return EditorTokenStore.fromTokens(tokens)
}

function syntaxRangeListsIntersect(
  left: readonly EditorSyntaxRange[],
  right: readonly EditorSyntaxRange[],
): boolean {
  return left.some((range) => right.some((other) => syntaxRangesIntersect(range, other)))
}
