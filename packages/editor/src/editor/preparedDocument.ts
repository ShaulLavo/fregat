import type {
  EditorDocumentAnalysis,
  EditorRetainedSyntaxSession,
  EditorRetainedHighlighterSession,
} from './documentAnalysis'
import type { EditorTextBuffer } from '../documentSession'
import type { PieceTableSnapshot } from '@singapore-editor/textbuffer'
import type { EditorHighlighterProvider, EditorHighlightResult } from '../plugins'
import {
  createEmptySyntaxResult,
  type EditorSyntaxLanguageId,
  type EditorSyntaxProvider,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
} from '../syntax/session'
import { IndentationFoldIndex } from './indentationFoldIndex'
import { guessedTabSize } from './indentationGuess'
import { recordEditorPerformanceDiagnostic } from './performanceDiagnostics'
import { fallbackFoldReason } from './syntaxController'
import { EditorWorkScheduler } from './workScheduler'

export type EditorPreparedTagValue = string | number | boolean | null

export type EditorPreparedStructuralConfiguration = {
  readonly includeCaptures: boolean
  readonly includeHighlights: boolean
  readonly syntaxMode: 'full' | 'range'
}

export type EditorPreparedDocumentMatch = {
  readonly configuredTabSize: number
  readonly tabSizePolicy: EditorPreparedTabSizePolicy
  readonly documentId: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly snapshot: PieceTableSnapshot
  readonly documentConfigurationTag: readonly EditorPreparedTagValue[]
  readonly structuralProvider: EditorSyntaxProvider | null
  readonly highlighterProvider: EditorHighlighterProvider | null
  readonly structuralConfiguration: EditorPreparedStructuralConfiguration | null
  readonly structuralConfigurationTag: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag: readonly EditorPreparedTagValue[]
}

export type EditorPreparedStageRequest =
  | {
      readonly family: 'structural'
      readonly provider: EditorSyntaxProvider
      readonly configuration: EditorPreparedStructuralConfiguration
      readonly configurationTag: readonly EditorPreparedTagValue[]
      readonly range: EditorSyntaxRange
      readonly abortSignal: AbortSignal
    }
  | {
      readonly family: 'highlighter'
      readonly provider: EditorHighlighterProvider
      readonly configurationTag: readonly EditorPreparedTagValue[]
      readonly range: 'full'
      readonly abortSignal: AbortSignal
    }

export type EditorPreparedStageOutcome = 'ready' | 'aborted' | 'failed' | 'stale'

export type EditorPreparedStructuralBorrow = {
  readonly family: 'structural'
  readonly runtimeSessionId: string
  readonly provider: EditorSyntaxProvider
  readonly configuration: EditorPreparedStructuralConfiguration
  readonly configurationTag: readonly EditorPreparedTagValue[]
  readonly range: EditorSyntaxRange
  readonly session: EditorRetainedSyntaxSession
  readonly result: Promise<EditorSyntaxResult>
  readonly readyResult: EditorSyntaxResult | null
  dispose(): void
}

export type EditorPreparedHighlighterBorrow = {
  readonly family: 'highlighter'
  readonly runtimeSessionId: string
  readonly provider: EditorHighlighterProvider
  readonly configurationTag: readonly EditorPreparedTagValue[]
  readonly range: 'full'
  readonly session: EditorRetainedHighlighterSession
  readonly result: Promise<EditorHighlightResult>
  readonly readyResult: EditorHighlightResult | null
  dispose(): void
}

export type EditorPreparedDocumentPayload = {
  readonly lineStarts: readonly number[]
  readonly tabSize: number
  readonly fallbackFoldIndex: IndentationFoldIndex | null
  readonly structural: EditorPreparedStructuralBorrow | null
  readonly highlighter: EditorPreparedHighlighterBorrow | null
}

export type EditorPreparedDocument = {
  startStage(request: EditorPreparedStageRequest): Promise<EditorPreparedStageOutcome> | null
  runtimeSessionIds(): EditorPreparedRuntimeSessionIds
  readonly analysis: EditorDocumentAnalysis
  borrow(expected: EditorPreparedDocumentMatch): EditorPreparedDocumentPayload | null
  dispose(): void
  readonly estimatedBytes: number
  /** True if fallback preparation finishes before takeover, incomplete transfer, or disposal. */
  readonly fallbackReady: Promise<boolean>
}

type EditorPreparedRuntimeSessionIds = {
  readonly highlighter: readonly string[]
  readonly structural: readonly string[]
}

export type CreateEditorPreparedDocumentOptions = {
  readonly folding?: boolean
  readonly analysis: EditorDocumentAnalysis
  readonly buffer: EditorTextBuffer
  readonly documentId: string
  readonly languageId: EditorSyntaxLanguageId | null
  readonly configuredTabSize: number
  readonly tabSizePolicy: EditorPreparedTabSizePolicy
  readonly documentConfigurationTag: readonly EditorPreparedTagValue[]
}

export type EditorPreparedTabSizePolicy = 'detect-indentation' | 'fixed'

type PreparedStructuralStage = ReturnType<typeof createStructuralStage>
type PreparedHighlighterStage = ReturnType<typeof createHighlighterStage>

const LINE_START_ESTIMATED_BYTES = 8
const FOLD_RANGE_ESTIMATED_BYTES = 48
const TOKEN_ESTIMATED_BYTES = 48
const SYNTAX_CAPTURE_ESTIMATED_BYTES = 48
const BRACKET_ESTIMATED_BYTES = 32
const SYNTAX_ERROR_ESTIMATED_BYTES = 48
const SYNTAX_INJECTION_ESTIMATED_BYTES = 48

export function createEditorPreparedDocument(
  options: CreateEditorPreparedDocumentOptions,
): EditorPreparedDocument {
  if (options.analysis.buffer !== options.buffer)
    throw new TypeError('Prepared analysis must reference the source buffer')
  const snapshot = options.buffer.getSnapshot()
  const textSnapshot = options.buffer.getTextSnapshot()
  const lineStarts = computeLineStarts(textSnapshot)
  const tabSize =
    options.tabSizePolicy === 'detect-indentation'
      ? guessedTabSize(textSnapshot, options.configuredTabSize)
      : options.configuredTabSize
  const documentConfigurationTag = checkedTag(options.documentConfigurationTag)
  let structural: PreparedStructuralStage | null = null
  let highlighter: PreparedHighlighterStage | null = null
  let disposed = false
  const fallback = new PreparedFallbackIndex(
    options.folding === false
      ? null
      : new IndentationFoldIndex({
          snapshot: textSnapshot,
          languageId: options.languageId,
          tabSize,
        }),
    options.documentId,
    () => preparedFallbackSelection(options.languageId, structural),
  )

  const dispose = (): void => {
    if (disposed) return

    disposed = true
    fallback.dispose()
    structural?.dispose()
    highlighter?.dispose()
  }

  return {
    analysis: options.analysis,
    fallbackReady: fallback.ready,
    get estimatedBytes() {
      const documentBytes =
        snapshot.length * 2 +
        lineStarts.length * LINE_START_ESTIMATED_BYTES +
        fallback.estimatedBytes
      return documentBytes + readyStageEstimatedBytes(structural, highlighter)
    },
    startStage(request) {
      if (disposed) return null
      if (request.family === 'structural') {
        if (structural) return null
        structural = createStructuralStage(options, textSnapshot, request)
        observePreparedStructuralOwnership(structural, fallback, options.languageId)
        return structural.outcome
      }
      if (highlighter) return null
      highlighter = createHighlighterStage(options, textSnapshot, request)
      return highlighter.outcome
    },
    runtimeSessionIds() {
      return {
        highlighter: highlighter?.runtimeSessionId ? [highlighter.runtimeSessionId] : [],
        structural: structural?.runtimeSessionId ? [structural.runtimeSessionId] : [],
      }
    },
    borrow(expected) {
      if (disposed) return null
      if (!matchesDocument(expected, options, snapshot, documentConfigurationTag)) {
        dispose()
        return null
      }

      const structuralTransfer = borrowStructural(structural, expected, options.analysis)
      const highlighterTransfer = borrowHighlighter(highlighter, expected, options.analysis)
      return {
        lineStarts,
        tabSize,
        fallbackFoldIndex: fallback.take(
          structuralTransfer !== null && structuralOwnsFolds(structural, options.languageId),
        ),
        structural: structuralTransfer,
        highlighter: highlighterTransfer,
      }
    },
    dispose,
  }
}

function observePreparedStructuralOwnership(
  stage: PreparedStructuralStage,
  fallback: PreparedFallbackIndex,
  languageId: EditorSyntaxLanguageId | null,
): void {
  if (structuralOwnsFolds(stage, languageId)) fallback.pause()
  void stage.outcome.then(() => {
    if (structuralOwnsFolds(stage, languageId)) return
    fallback.resume()
  })
}

function structuralOwnsFolds(
  stage: PreparedStructuralStage | null,
  languageId: EditorSyntaxLanguageId | null,
): boolean {
  return preparedFallbackSelection(languageId, stage).reason === null
}

function preparedFallbackSelection(
  languageId: EditorSyntaxLanguageId | null,
  stage: PreparedStructuralStage | null,
) {
  const session = stage?.disposed() ? null : (stage?.session ?? null)
  const structuralStatus = stage?.failed() ? 'error' : 'loading'
  return {
    reason: fallbackFoldReason({ languageId, session, status: structuralStatus }),
    provider: stage?.provider ? 'plugin' : null,
    foldingSupport: session?.foldingSupport ?? null,
    structuralStatus,
  }
}

class PreparedFallbackIndex {
  private readonly work = new EditorWorkScheduler()
  private disposed = false
  private resolveReady: (ready: boolean) => void = () => undefined
  readonly ready = new Promise<boolean>((resolve) => {
    this.resolveReady = resolve
  })

  constructor(
    private index: IndentationFoldIndex | null,
    private readonly documentId: string,
    private readonly selection: () => ReturnType<typeof preparedFallbackSelection>,
  ) {
    if (!index) this.resolveReady(false)
    this.advance()
  }

  get estimatedBytes(): number {
    return this.index?.diagnostics.retainedBytes ?? 0
  }

  pause(): void {
    this.resolveReady(false)
    this.work.cancel('editor.prepared.fallbackFolds')
    if (!this.index?.ready) this.report('pending')
  }

  resume(): void {
    if (this.disposed || !this.index || this.index.ready) return
    this.work.schedule({
      key: 'editor.prepared.fallbackFolds',
      taskClass: 'background-derived',
      defer: true,
      run: () => this.step(),
      apply: (ready) => this.afterStep(ready),
    })
  }

  take(structuralOwner: boolean): IndentationFoldIndex | null {
    const index = this.index
    if (!structuralOwner && index && !index.ready) this.report('pending')
    if (!structuralOwner) this.index = null
    this.dispose()
    if (structuralOwner) return null
    return index
  }

  dispose(): void {
    if (this.disposed) return
    this.resolveReady(false)
    if (this.index && !this.index.ready) this.report('cancelled')
    this.disposed = true
    this.work.dispose()
    this.index = null
  }

  private advance(): void {
    if (this.disposed || !this.index) return
    this.afterStep(this.step())
  }

  private step(): boolean {
    return this.index?.step({ maxCodeUnits: 64_000, maxRows: 512 }) ?? false
  }

  private afterStep(ready: boolean): void {
    if (!ready) {
      this.resume()
      return
    }
    this.resolveReady(true)
    this.report('completed')
  }

  private report(outcome: 'completed' | 'cancelled' | 'pending'): void {
    const index = this.index
    if (!index) return
    recordEditorPerformanceDiagnostic('editor.folds.prepared', () => ({
      ...index.diagnostics,
      ...this.selection(),
      counterScope: 'index-generation',
      durationScope: 'index-generation',
      documentId: this.documentId,
      languageId: index.languageId,
      tabSize: index.tabSize,
      trigger: 'prepared',
      outcome,
    }))
  }
}

function readyStageEstimatedBytes(
  structural: PreparedStructuralStage | null,
  highlighter: PreparedHighlighterStage | null,
): number {
  const structuralResult = structural?.readyResult() ?? null
  const highlighterResult = highlighter?.readyResult() ?? null
  return (
    structuralResultEstimatedBytes(structuralResult) +
    (highlighterResult?.tokens.length ?? 0) * TOKEN_ESTIMATED_BYTES
  )
}

function structuralResultEstimatedBytes(result: EditorSyntaxResult | null): number {
  if (!result) return 0

  return (
    result.folds.length * FOLD_RANGE_ESTIMATED_BYTES +
    result.tokens.length * TOKEN_ESTIMATED_BYTES +
    result.captures.length * SYNTAX_CAPTURE_ESTIMATED_BYTES +
    result.brackets.length * BRACKET_ESTIMATED_BYTES +
    result.errors.length * SYNTAX_ERROR_ESTIMATED_BYTES +
    result.injections.length * SYNTAX_INJECTION_ESTIMATED_BYTES
  )
}

function createStructuralStage(
  options: CreateEditorPreparedDocumentOptions,
  textSnapshot: ReturnType<EditorTextBuffer['getTextSnapshot']>,
  request: Extract<EditorPreparedStageRequest, { readonly family: 'structural' }>,
) {
  if (request.abortSignal.aborted) {
    return createMissingStructuralStage(request.abortSignal, 'aborted')
  }

  const configurationTag = checkedTag(request.configurationTag)
  const session = options.analysis.borrowStructural({
    provider: request.provider,
    configurationTag: request.configurationTag,
    languageId: options.languageId,
    includeCaptures: request.configuration.includeCaptures,
    includeHighlights: request.configuration.includeHighlights,
    syntaxMode: request.configuration.syntaxMode,
  })
  if (!session) return createMissingStructuralStage(request.abortSignal, 'failed')

  const stage = createStageOwner<EditorSyntaxResult>(session, request.abortSignal)
  if (stage.disposed()) return createMissingStructuralStage(request.abortSignal, 'aborted')

  const result = session.refresh(textSnapshot).then(() => {
    if (!session.queryRange) return session.getResult()
    return session.queryRange(request.range)
  })
  const tracked = stage.track(result)
  return {
    ...stage,
    configuration: request.configuration,
    configurationTag,
    outcome: outcomeFor(tracked, stage),
    provider: request.provider,
    range: request.range,
    result: tracked,
    runtimeSessionId: session.runtimeSessionId,
    session,
  }
}

function createHighlighterStage(
  options: CreateEditorPreparedDocumentOptions,
  textSnapshot: ReturnType<EditorTextBuffer['getTextSnapshot']>,
  request: Extract<EditorPreparedStageRequest, { readonly family: 'highlighter' }>,
) {
  if (request.abortSignal.aborted) {
    return createMissingHighlighterStage(request.abortSignal, 'aborted')
  }

  const configurationTag = checkedTag(request.configurationTag)
  const session = options.analysis.borrowHighlighter({
    provider: request.provider,
    configurationTag: request.configurationTag,
    languageId: options.languageId,
  })
  if (!session) return createMissingHighlighterStage(request.abortSignal, 'failed')

  const stage = createStageOwner<EditorHighlightResult>(session, request.abortSignal)
  if (stage.disposed()) return createMissingHighlighterStage(request.abortSignal, 'aborted')

  const tracked = stage.track(session.refresh(textSnapshot))
  return {
    ...stage,
    configurationTag,
    outcome: outcomeFor(tracked, stage),
    provider: request.provider,
    range: 'full' as const,
    result: tracked,
    runtimeSessionId: session.runtimeSessionId,
    session,
  }
}

function createStageOwner<TResult>(session: { dispose(): void }, abortSignal: AbortSignal) {
  let disposed = false
  let failed = false
  let readyResult: TResult | null = null
  const abort = () => {
    dispose()
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    abortSignal.removeEventListener('abort', abort)
    session.dispose()
  }
  abortSignal.addEventListener('abort', abort, { once: true })
  if (abortSignal.aborted) abort()

  return {
    abortSignal,
    dispose,
    disposed: () => disposed,
    failed: () => failed,
    readyResult: () => readyResult,
    track: (result: Promise<TResult>): Promise<TResult> =>
      result.then(
        (value) => {
          if (disposed) throw new DOMException('Prepared stage disposed', 'AbortError')
          readyResult = value
          return value
        },
        (error: unknown) => {
          failed = true
          throw error
        },
      ),
  }
}

function outcomeFor<T>(
  result: Promise<T>,
  stage: { readonly abortSignal: AbortSignal; disposed(): boolean },
): Promise<EditorPreparedStageOutcome> {
  return result.then(
    () => (stage.disposed() ? 'stale' : 'ready'),
    () => (stage.abortSignal.aborted ? 'aborted' : 'failed'),
  )
}

function createMissingStructuralStage(
  abortSignal: AbortSignal,
  outcome: EditorPreparedStageOutcome,
) {
  return {
    abortSignal,
    configuration: null,
    configurationTag: [] as readonly EditorPreparedTagValue[],
    dispose: () => undefined,
    disposed: () => true,
    failed: () => true,
    outcome: Promise.resolve(outcome),
    provider: null,
    range: null,
    readyResult: () => null,
    result: Promise.resolve(createEmptySyntaxResult()),
    runtimeSessionId: '',
    session: null,
    track: <T>(result: Promise<T>) => result,
  }
}

function createMissingHighlighterStage(
  abortSignal: AbortSignal,
  outcome: EditorPreparedStageOutcome,
) {
  return {
    abortSignal,
    configurationTag: [] as readonly EditorPreparedTagValue[],
    dispose: () => undefined,
    disposed: () => true,
    failed: () => true,
    outcome: Promise.resolve(outcome),
    provider: null,
    range: null,
    readyResult: () => null,
    result: Promise.resolve({ tokens: [] }),
    runtimeSessionId: '',
    session: null,
    track: <T>(result: Promise<T>) => result,
  }
}

function borrowStructural(
  stage: PreparedStructuralStage | null,
  expected: EditorPreparedDocumentMatch,
  analysis: EditorDocumentAnalysis,
): EditorPreparedStructuralBorrow | null {
  if (!stage?.session || !stage.provider || !stage.configuration || !stage.range) return null
  if (stage.provider !== expected.structuralProvider) return disposeStage(stage)
  if (!sameStructuralConfiguration(stage.configuration, expected.structuralConfiguration)) {
    return disposeStage(stage)
  }
  if (!sameTag(stage.configurationTag, expected.structuralConfigurationTag)) {
    return disposeStage(stage)
  }
  const session = analysis.borrowStructural({
    provider: stage.provider,
    languageId: expected.languageId,
    ...stage.configuration,
    configurationTag: stage.configurationTag,
  })
  if (!session) return null
  const range = stage.range
  const result = session
    .refresh(analysis.buffer.getTextSnapshot())
    .then(() => session.queryRange?.(range) ?? session.getResult())
  void result.catch(() => undefined)
  return borrowWithReadyResult(
    {
      family: 'structural' as const,
      runtimeSessionId: stage.runtimeSessionId,
      provider: stage.provider,
      configuration: stage.configuration,
      configurationTag: stage.configurationTag,
      range: stage.range,
      session,
      result,
      dispose: () => session.dispose(),
    },
    () => {
      const state = session.read(stage.range ?? undefined)
      return state.kind === 'ready' ? state.result : null
    },
  )
}

function borrowHighlighter(
  stage: PreparedHighlighterStage | null,
  expected: EditorPreparedDocumentMatch,
  analysis: EditorDocumentAnalysis,
): EditorPreparedHighlighterBorrow | null {
  if (!stage?.session || !stage.provider) return null
  if (stage.provider !== expected.highlighterProvider) return disposeStage(stage)
  if (!sameTag(stage.configurationTag, expected.highlighterConfigurationTag)) {
    return disposeStage(stage)
  }
  const session = analysis.borrowHighlighter({
    provider: stage.provider,
    languageId: expected.languageId,
    configurationTag: stage.configurationTag,
  })
  if (!session) return null
  const result = session.refresh(analysis.buffer.getTextSnapshot())
  void result.catch(() => undefined)
  return borrowWithReadyResult(
    {
      family: 'highlighter' as const,
      runtimeSessionId: stage.runtimeSessionId,
      provider: stage.provider,
      configurationTag: stage.configurationTag,
      range: 'full' as const,
      session,
      result,
      dispose: () => session.dispose(),
    },
    () => {
      const state = session.read()
      return state.kind === 'ready' ? state.result : null
    },
  )
}

function borrowWithReadyResult<TResult, T extends object>(
  transfer: T,
  readyResult: () => TResult | null,
): T & { readonly readyResult: TResult | null } {
  return Object.defineProperty({ ...transfer, readyResult: null }, 'readyResult', {
    enumerable: true,
    get: readyResult,
  })
}

function disposeStage<T>(stage: { dispose(): void }): T | null {
  stage.dispose()
  return null
}

function matchesDocument(
  expected: EditorPreparedDocumentMatch,
  options: CreateEditorPreparedDocumentOptions,
  snapshot: PieceTableSnapshot,
  tag: readonly EditorPreparedTagValue[],
): boolean {
  if (expected.configuredTabSize !== options.configuredTabSize) return false
  if (expected.tabSizePolicy !== options.tabSizePolicy) return false
  if (expected.documentId !== options.documentId) return false
  if (expected.languageId !== options.languageId) return false
  if (expected.snapshot !== snapshot) return false
  return sameTag(expected.documentConfigurationTag, tag)
}

function sameStructuralConfiguration(
  left: EditorPreparedStructuralConfiguration,
  right: EditorPreparedStructuralConfiguration | null,
): boolean {
  if (!right) return false
  return (
    left.includeCaptures === right.includeCaptures &&
    left.includeHighlights === right.includeHighlights &&
    left.syntaxMode === right.syntaxMode
  )
}

function checkedTag(tag: readonly EditorPreparedTagValue[]): readonly EditorPreparedTagValue[] {
  for (const value of tag) {
    if (value === null) continue
    if (typeof value === 'string') continue
    if (typeof value === 'number') continue
    if (typeof value === 'boolean') continue
    throw new TypeError('Prepared document tags accept only primitive values')
  }
  return Object.freeze([...tag])
}

function sameTag(
  left: readonly EditorPreparedTagValue[],
  right: readonly EditorPreparedTagValue[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

function computeLineStarts(
  textSnapshot: ReturnType<EditorTextBuffer['getTextSnapshot']>,
): readonly number[] {
  const lineStarts = [0]
  textSnapshot.forEachTextChunk((text, chunkStart) => {
    let index = text.indexOf('\n')
    while (index !== -1) {
      lineStarts.push(chunkStart + index + 1)
      index = text.indexOf('\n', index + 1)
    }
  })
  return Object.freeze(lineStarts)
}
