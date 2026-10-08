import { TREE_SITTER_BOOTSTRAP_UNITS } from './treeSitter/source'
import { waitForDocumentWork } from '@singapore-editor/core/internal/document-worker'
import { type TextEdit, type TextReadSnapshot } from '@singapore-editor/core/document'
import {
  createEmptySyntaxResult,
  createEditorRuntimeSessionId,
  type EditorSyntaxDegradedState,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
  type EditorSyntaxFoldingSupport,
  treeSitterCapturesToEditorTokens,
  EditorTokenStore,
} from '@singapore-editor/core/syntax'
import type {
  DocumentContributionSource,
  DocumentRead,
  DocumentWorkerReadReference,
} from '@singapore-editor/core/internal/document-worker'
import type {
  TreeSitterDegradedState,
  TreeSitterInputEdit,
  TreeSitterLanguageId,
  TreeSitterParseAckResult,
  TreeSitterParseResult,
  TreeSitterRangeResult,
} from './treeSitter/types'
import {
  resolveTreeSitterLanguageClosure,
  withInjectedLanguages,
  type TreeSitterLanguageDescriptor,
  type TreeSitterLanguageResolver,
} from './treeSitter/registry'
import {
  TreeSitterWorkerClient,
  type TreeSitterBackend,
  type TreeSitterBackendEditPayload,
  type TreeSitterEditPayload,
} from './treeSitter/workerClient'

export type TreeSitterSyntaxSessionOptions = {
  readonly documentId: string
  readonly runtimeSessionId?: string
  readonly languageId: TreeSitterLanguageId
  readonly languageResolver?: TreeSitterLanguageResolver
  readonly foldingSupport?: Exclude<EditorSyntaxFoldingSupport, 'pending'>
  readonly includeHighlights?: boolean
  readonly includeCaptures?: boolean
  readonly syntaxMode?: 'full' | 'range'
  readonly source: DocumentContributionSource
  readonly initialRead: DocumentRead
  readonly backend?: TreeSitterBackend
  /** Called once, after the session's first parse answers. */
  readonly onFirstParse?: () => void
}

type LanguageRegistration =
  | { readonly kind: 'pending'; readonly promise: Promise<boolean> }
  | {
      readonly kind: 'ready'
      readonly promise: Promise<boolean>
      readonly generation: number | null
    }

export class TreeSitterSyntaxSession implements EditorSyntaxRuntime {
  private readonly documentId: string
  private runtimeSessionId: string
  private readonly languageId: TreeSitterLanguageId
  private readonly languageResolver: TreeSitterLanguageResolver | undefined
  private readonly includeHighlights: boolean
  private readonly includeCaptures: boolean
  private readonly syntaxMode: 'full' | 'range'
  private readonly backend: TreeSitterBackend
  private snapshotVersion = 0
  private parsedSnapshotVersion = 0
  private analysedRead: DocumentRead | null = null
  private analysedSourceGeneration: number | null = null
  private readonly source: DocumentContributionSource
  private initialLength: number
  private result: EditorSyntaxResult
  private currentFoldingSupport: EditorSyntaxFoldingSupport
  private languageRegistration: LanguageRegistration | null = null
  private readonly pendingLanguages = new Map<
    string,
    Promise<readonly TreeSitterLanguageDescriptor[]>
  >()
  private background: {
    readonly controller: AbortController
    readonly promise: Promise<void>
  } | null = null
  private readonly resultListeners = new Set<
    (read: DocumentRead, result: EditorSyntaxResult) => void
  >()
  private disposed = false
  private onFirstParse: (() => void) | undefined

  public constructor(options: TreeSitterSyntaxSessionOptions) {
    this.documentId = options.documentId
    this.runtimeSessionId = options.runtimeSessionId ?? createEditorRuntimeSessionId()
    this.languageId = options.languageId
    this.languageResolver = options.languageResolver
    this.currentFoldingSupport = options.languageResolver
      ? 'pending'
      : (options.foldingSupport ?? 'supported')
    this.includeHighlights = options.includeHighlights ?? true
    this.includeCaptures = options.includeCaptures ?? true
    this.syntaxMode = options.syntaxMode ?? 'full'
    this.source = options.source
    this.initialLength = options.initialRead.text.length
    this.backend = options.backend ?? new TreeSitterWorkerClient()
    this.onFirstParse = options.onFirstParse
    this.result = this.createEmptyResult({ length: this.initialLength, snapshotVersion: 0 })
  }

  public get foldingSupport(): EditorSyntaxFoldingSupport {
    if (this.result.projection.analysis && this.result.projection.analysis.kind !== 'full')
      return 'pending'
    return this.currentFoldingSupport
  }

  public async analyze(read: DocumentRead, signal?: AbortSignal): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result
    signal?.throwIfAborted()
    if (this.source.read(read.revision) !== read)
      throw new DOMException('Document revision belongs to another source', 'InvalidStateError')
    if (!(await waitForDocumentWork(this.ensureLanguageRegistered(), signal)))
      return this.updateFromUnavailableLanguage(read)
    if (this.disposed) return this.result

    const prepared = await this.source.prepareReader(this.backend.sourceEndpoint, read, signal)
    if (!prepared || this.disposed) {
      await prepared?.dispose()
      throw new DOMException('Document source was released', 'AbortError')
    }
    try {
      signal?.throwIfAborted()
      if (this.analysedSourceGeneration !== prepared.reference.identity.endpointGeneration)
        this.parsedSnapshotVersion = 0
      const result = await this.analyzePrepared(read, prepared.reference, signal)
      this.analysedSourceGeneration = prepared.reference.identity.endpointGeneration
      return result
    } finally {
      await prepared.dispose()
    }
  }

  private async analyzePrepared(
    read: DocumentRead,
    source: DocumentWorkerReadReference,
    signal?: AbortSignal,
  ): Promise<EditorSyntaxResult> {
    if (this.analysedRead !== read) this.background?.controller.abort()
    const changed = this.analysedRead
      ? this.source.changesBetween(this.analysedRead.revision, read.revision)
      : null
    if (this.parsedSnapshotVersion > 0 && changed?.edits?.length === 0) {
      this.analysedRead = read
      return this.result
    }
    if (
      this.parsedSnapshotVersion > 0 &&
      changed?.edits &&
      this.analysedRead &&
      this.result.projection.analysis?.kind !== 'partial'
    ) {
      const payload = {
        documentId: this.documentId,
        runtimeSessionId: this.runtimeSessionId,
        languageId: this.languageId,
        previousSnapshotVersion: this.parsedSnapshotVersion,
        snapshotVersion: ++this.snapshotVersion,
        previousRead: this.analysedRead.text,
        source,
        edits: changed.edits,
        includeHighlights: this.includeHighlights,
        includeCaptures: this.includeCaptures,
      }
      const edit =
        this.syntaxMode === 'range'
          ? createTreeSitterEditPayload({ ...payload, resultMode: 'parseOnly' })
          : createTreeSitterEditPayload({ ...payload, resultMode: 'full' })
      if (edit) return await this.applyIncrementalEdit(edit, read, signal)
    }
    return await this.parseRead(read, source, signal)
  }

  private async parseRead(
    read: DocumentRead,
    source: DocumentWorkerReadReference,
    signal?: AbortSignal,
  ): Promise<EditorSyntaxResult> {
    this.background?.controller.abort()
    this.background = null
    const snapshotVersion = ++this.snapshotVersion
    const parsePayload = {
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      snapshotVersion,
      languageId: this.languageId,
      includeHighlights: this.includeHighlights,
      includeCaptures: this.includeCaptures,
      source,
    }
    let result = await this.backend.parse(
      this.syntaxMode === 'range'
        ? { ...parsePayload, resultMode: this.initialParseMode(read) }
        : { ...parsePayload, resultMode: 'full' },
      signal,
    )
    for (let depth = 0; depth < 8 && result?.missingLanguages?.length; depth += 1) {
      if (
        !(await waitForDocumentWork(
          this.registerMissingLanguages(result.missingLanguages, snapshotVersion),
          signal,
        ))
      )
        break
      if (this.disposed || !this.isCurrentSnapshotVersion(snapshotVersion)) return this.result
      result = await this.backend.parse(
        this.syntaxMode === 'range'
          ? { ...parsePayload, resultMode: this.initialParseMode(read) }
          : { ...parsePayload, resultMode: 'full' },
        signal,
      )
    }
    signal?.throwIfAborted()
    const next = this.updateFromTreeSitterResult(result, snapshotVersion, read)
    if (result && !this.disposed && result.analysis?.kind !== 'partial') this.notifyFirstParse()
    return next
  }

  private initialParseMode(read: DocumentRead): 'parseOnly' | 'bootstrap' {
    if (
      read.text.length <= TREE_SITTER_BOOTSTRAP_UNITS ||
      this.languageId === 'markdown' ||
      this.languageId === 'mdx'
    )
      return 'parseOnly'
    return 'bootstrap'
  }

  public subscribeResults(
    listener: (read: DocumentRead, result: EditorSyntaxResult) => void,
  ): () => void {
    this.resultListeners.add(listener)
    return () => this.resultListeners.delete(listener)
  }

  private startCompleteAnalysis(): Promise<void> {
    if (this.background) return this.background.promise
    const read = this.analysedRead
    if (!read || this.disposed || this.result.projection.analysis?.kind !== 'partial')
      return Promise.resolve()
    const controller = new AbortController()
    const version = this.snapshotVersion
    const promise = this.completeAnalysis(read, version, controller.signal).catch(
      (error: unknown) => {
        if (controller.signal.aborted || this.disposed || this.snapshotVersion !== version) return
        this.result = {
          ...this.result,
          degraded: { kind: 'request-failed', message: String(error) },
        }
        this.notifyResults(read, this.result)
      },
    )
    this.background = { controller, promise }
    return promise
  }

  private async completeAnalysis(
    read: DocumentRead,
    version: number,
    signal: AbortSignal,
  ): Promise<void> {
    // The visible response is delivered before the complete analysis enters the worker queue.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    signal.throwIfAborted()
    const prepared = await this.source.prepareReader(this.backend.sourceEndpoint, read, signal)
    if (!prepared) return
    try {
      const payload: import('./treeSitter/workerClient').TreeSitterParseOnlyPayload = {
        documentId: this.documentId,
        runtimeSessionId: this.runtimeSessionId,
        snapshotVersion: version,
        languageId: this.languageId,
        includeHighlights: this.includeHighlights,
        includeCaptures: this.includeCaptures,
        source: prepared.reference,
        resultMode: 'parseOnly',
      }
      const result = await this.parseCompleteLanguages(payload, version, signal)
      signal.throwIfAborted()
      if (this.disposed || this.snapshotVersion !== version || !result) return
      if (
        result.analysis?.kind === 'cancelled' &&
        this.result.projection.analysis?.kind === 'partial'
      ) {
        this.result = {
          ...this.result,
          projection: {
            ...this.result.projection,
            analysis: { ...this.result.projection.analysis, background: result.analysis },
          },
        }
        this.notifyResults(read, this.result)
        return
      }
      const next = this.updateFromTreeSitterResult(result, version, read)
      this.notifyResults(read, next)
    } finally {
      await prepared.dispose()
    }
  }

  private async parseCompleteLanguages(
    payload: import('./treeSitter/workerClient').TreeSitterParseOnlyPayload,
    version: number,
    signal: AbortSignal,
  ): Promise<TreeSitterParseAckResult | TreeSitterParseResult | undefined> {
    let result = await this.backend.parse(payload, signal)
    for (let depth = 0; depth < 8 && result?.missingLanguages?.length; depth++) {
      if (!(await this.registerMissingLanguages(result.missingLanguages, version))) break
      signal.throwIfAborted()
      result = await this.backend.parse(payload, signal)
    }
    return result
  }

  private notifyResults(read: DocumentRead, result: EditorSyntaxResult): void {
    for (const listener of this.resultListeners) listener(read, result)
  }

  private notifyFirstParse(): void {
    const onFirstParse = this.onFirstParse
    this.onFirstParse = undefined
    onFirstParse?.()
  }

  public async queryRange(
    range: EditorSyntaxRange,
    signal?: AbortSignal,
  ): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result
    signal?.throwIfAborted()
    if (!this.backend.queryRange) {
      return this.createRangeUnavailableResult(range, 'Tree-sitter range queries are unavailable')
    }
    if (this.backend.generation !== this.analysedSourceGeneration && this.analysedRead) {
      const read = this.analysedRead
      this.parsedSnapshotVersion = 0
      await this.analyze(read, signal)
      signal?.throwIfAborted()
    }

    if (!this.canQueryRange()) {
      return this.createRangeUnavailableResult(range, 'Tree-sitter document has not been parsed')
    }

    let result = await this.backend.queryRange(
      {
        documentId: this.documentId,
        runtimeSessionId: this.runtimeSessionId,
        snapshotVersion: this.parsedSnapshotVersion,
        languageId: this.languageId,
        includeHighlights: this.includeHighlights,
        includeCaptures: this.includeCaptures,
        range,
      },
      signal,
    )

    signal?.throwIfAborted()
    for (let depth = 0; depth < 8 && result?.missingLanguages?.length; depth++) {
      if (!(await this.registerMissingLanguages(result.missingLanguages, this.snapshotVersion)))
        break
      signal?.throwIfAborted()
      result = await this.backend.queryRange(
        {
          documentId: this.documentId,
          runtimeSessionId: this.runtimeSessionId,
          snapshotVersion: this.parsedSnapshotVersion,
          languageId: this.languageId,
          includeHighlights: this.includeHighlights,
          includeCaptures: this.includeCaptures,
          range,
        },
        signal,
      )
    }

    if (!result && this.result.projection.analysis?.kind === 'partial') {
      await this.startCompleteAnalysis()
      signal?.throwIfAborted()
      result = await this.backend.queryRange(
        {
          documentId: this.documentId,
          runtimeSessionId: this.runtimeSessionId,
          snapshotVersion: this.parsedSnapshotVersion,
          languageId: this.languageId,
          includeHighlights: this.includeHighlights,
          includeCaptures: this.includeCaptures,
          range,
        },
        signal,
      )
    }
    if (!result)
      return this.createRangeUnavailableResult(range, 'Complete syntax analysis is pending')
    const background = this.result.projection.analysis
    const next = this.updateFromTreeSitterRangeResult(result, range)
    if (next.projection.analysis?.kind === 'cancelled') return next
    if (
      background?.kind === 'partial' &&
      background.background &&
      next.projection.analysis?.kind === 'partial'
    ) {
      this.result = {
        ...next,
        projection: {
          ...next.projection,
          analysis: { ...next.projection.analysis, background: background.background },
        },
      }
    }
    if (result?.analysis?.kind === 'partial') {
      this.notifyFirstParse()
      void this.startCompleteAnalysis()
    }
    return this.result
  }

  public canQueryRange(): boolean {
    return (
      this.result.projection.analysis?.kind !== 'cancelled' &&
      this.parsedSnapshotVersion !== 0 &&
      this.parsedSnapshotVersion === this.snapshotVersion
    )
  }

  public getResult(): EditorSyntaxResult {
    return this.result
  }

  public getTokens(): EditorSyntaxResult['tokens'] {
    return this.result.tokens
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion
  }

  public dispose(): void {
    if (this.disposed) return

    this.background?.controller.abort()
    this.resultListeners.clear()
    this.disposed = true
    this.backend.disposeDocument(this.runtimeSessionId)
  }

  private async applyIncrementalEdit(
    payload: TreeSitterBackendEditPayload,
    read: DocumentRead,
    signal?: AbortSignal,
  ): Promise<EditorSyntaxResult> {
    try {
      const result = await this.backend.edit(payload, signal)
      signal?.throwIfAborted()
      if (this.disposed) return this.result
      if (!this.isCurrentSnapshotVersion(payload.snapshotVersion)) {
        return this.result
      }

      if (!result) {
        return this.reparseAfterIncrementalFailure(read, signal)
      }

      if (result.snapshotVersion !== payload.snapshotVersion) {
        return this.reparseAfterIncrementalFailure(read, signal)
      }

      if (
        await this.registerMissingLanguages(result.missingLanguages ?? [], payload.snapshotVersion)
      ) {
        if (this.disposed || !this.isCurrentSnapshotVersion(payload.snapshotVersion))
          return this.result
        return this.parseRead(read, payload.source, signal)
      }

      return this.updateFromTreeSitterResult(result, payload.snapshotVersion, read)
    } catch {
      signal?.throwIfAborted()
      if (this.disposed) return this.result
      if (!this.isCurrentSnapshotVersion(payload.snapshotVersion)) {
        return this.result
      }

      return this.reparseAfterIncrementalFailure(read, signal)
    }
  }

  private reparseAfterIncrementalFailure(
    read: DocumentRead,
    signal?: AbortSignal,
  ): Promise<EditorSyntaxResult> {
    if (this.disposed) return Promise.resolve(this.result)

    this.parsedSnapshotVersion = 0
    const disposedRuntimeSessionId = this.runtimeSessionId
    this.runtimeSessionId = createEditorRuntimeSessionId()
    this.backend.disposeDocument(disposedRuntimeSessionId)
    return this.analyze(read, signal)
  }

  private isCurrentSnapshotVersion(snapshotVersion: number): boolean {
    return snapshotVersion === this.snapshotVersion
  }

  private ensureLanguageRegistered(): Promise<boolean> {
    if (!this.languageResolver) return Promise.resolve(true)
    const current = this.languageRegistration
    if (current?.kind === 'pending') return current.promise
    if (current?.kind === 'ready' && current.generation === this.backend.generation)
      return current.promise
    const pending: LanguageRegistration = {
      kind: 'pending',
      promise: this.registerResolvedLanguage(),
    }
    this.languageRegistration = pending
    void pending.promise.then(
      (available) => {
        if (this.languageRegistration !== pending) return
        const generation = this.backend.generation
        if (available && generation === null) {
          this.languageRegistration = null
          return
        }
        this.languageRegistration = {
          kind: 'ready',
          promise: pending.promise,
          generation,
        }
      },
      () => {
        if (this.languageRegistration === pending) this.languageRegistration = null
      },
    )
    return pending.promise
  }

  private async registerResolvedLanguage(): Promise<boolean> {
    const descriptor = await this.languageResolver?.resolveTreeSitterLanguage(this.languageId)
    if (!descriptor) {
      this.currentFoldingSupport = 'unsupported'
      return false
    }
    this.currentFoldingSupport = descriptor.foldQuerySource?.trim() ? 'supported' : 'unsupported'

    const descriptors = await withInjectedLanguages(
      this.languageResolver,
      descriptor,
      () => this.disposed,
    )
    if (this.disposed) return false
    await this.backend.registerLanguages(descriptors)
    return true
  }

  private async registerMissingLanguages(
    languageIds: readonly string[],
    version: number,
  ): Promise<boolean> {
    let loaded = false
    for (const id of new Set(languageIds)) {
      if (this.disposed || !this.isCurrentSnapshotVersion(version)) return false
      let pending = this.pendingLanguages.get(id)
      if (!pending) {
        pending = this.resolveLanguageDependencies(id)
        this.pendingLanguages.set(id, pending)
      }
      const descriptors = await pending
      if (this.disposed || !this.isCurrentSnapshotVersion(version)) return false
      if (descriptors.length === 0) continue
      await this.backend.registerLanguages(descriptors)
      loaded = true
    }
    return loaded
  }

  private async resolveLanguageDependencies(
    id: string,
  ): Promise<readonly TreeSitterLanguageDescriptor[]> {
    if (!this.languageResolver) return []
    return resolveTreeSitterLanguageClosure(this.languageResolver, id, () => this.disposed)
  }

  private updateFromUnavailableLanguage(read: DocumentRead): EditorSyntaxResult {
    if (this.disposed) return this.result

    this.analysedRead = read
    this.result = this.createEmptyResult({
      degraded: {
        kind: 'language-unavailable',
        message: `Tree-sitter language "${this.languageId}" is unavailable`,
      },
      length: read.text.length,
      snapshotVersion: this.snapshotVersion,
    })
    return this.result
  }

  private updateFromTreeSitterResult(
    result: TreeSitterParseResult | TreeSitterParseAckResult | undefined,
    snapshotVersion: number,
    read: DocumentRead,
  ): EditorSyntaxResult {
    if (this.disposed) return this.result
    if (!result) return this.result
    if (result.snapshotVersion !== snapshotVersion) return this.result
    if (result.snapshotVersion !== this.snapshotVersion) return this.result

    this.analysedRead = read
    this.parsedSnapshotVersion = result.snapshotVersion
    if (isTreeSitterParseAckResult(result)) {
      this.result = this.createEmptyResult({
        degraded: treeSitterDegradedStateToEditorSyntaxState(result.degraded),
        length: read.text.length,
        snapshotVersion: result.snapshotVersion,
      })
      this.result = {
        ...this.result,
        projection: {
          ...this.result.projection,
          source: result.source,
          analysis: result.analysis ?? {
            kind: 'full',
            coveredRange: { startIndex: 0, endIndex: read.text.length },
          },
        },
      }
      return this.result
    }

    this.result = treeSitterParseResultToEditorSyntaxResult(
      result,
      this.resultContext(read.text.length, []),
    )
    return this.result
  }

  private updateFromTreeSitterRangeResult(
    result: TreeSitterRangeResult | undefined,
    range: EditorSyntaxRange,
  ): EditorSyntaxResult {
    if (this.disposed) return this.result
    if (!result) return this.result
    if (result.snapshotVersion !== this.snapshotVersion) return this.result
    if (result.snapshotVersion !== this.parsedSnapshotVersion) return this.result
    if (!sameSyntaxRange(result.range, range)) return this.result

    const next = treeSitterParseResultToEditorSyntaxResult(
      result,
      this.resultContext(this.analysedRead?.text.length ?? this.initialLength, [range]),
    )
    // A failed range operation does not retire the document's usable tree or colors.
    if (next.projection.analysis?.kind === 'cancelled') return next
    this.result = next
    return next
  }

  private createRangeUnavailableResult(
    range: EditorSyntaxRange,
    message: string,
  ): EditorSyntaxResult {
    const result = this.createEmptyResult({
      degraded: { kind: 'range-unavailable', message },
      requestedRanges: [range],
      length: this.analysedRead?.text.length ?? this.initialLength,
      snapshotVersion: this.parsedSnapshotVersion,
    })
    return {
      ...result,
      projection: {
        ...result.projection,
        source: this.result.projection.source,
        analysis: this.result.projection.analysis,
      },
    }
  }

  private createEmptyResult(options: {
    readonly degraded?: EditorSyntaxDegradedState | null
    readonly requestedRanges?: readonly EditorSyntaxRange[]
    readonly length: number
    readonly snapshotVersion: number
  }): EditorSyntaxResult {
    return createEmptySyntaxResult({
      degraded: options.degraded,
      language: this.languageConfiguration(),
      requestedRanges: options.requestedRanges,
      snapshot: this.snapshotTag(options.length, options.snapshotVersion),
    })
  }

  private resultContext(
    length: number,
    requestedRanges: readonly EditorSyntaxRange[],
  ): TreeSitterSyntaxResultContext {
    return {
      includeCaptures: this.includeCaptures,
      includeHighlights: this.includeHighlights,
      mode: this.syntaxMode,
      requestedRanges,
      snapshotLength: length,
    }
  }

  private languageConfiguration() {
    return {
      includeCaptures: this.includeCaptures,
      includeHighlights: this.includeHighlights,
      languageId: this.languageId,
      mode: this.syntaxMode,
    }
  }

  private snapshotTag(length: number, snapshotVersion: number) {
    return {
      documentId: this.documentId,
      length,
      version: snapshotVersion,
    }
  }
}

type TreeSitterBaseEditPayloadOptions = {
  readonly documentId: string
  readonly runtimeSessionId: string
  readonly languageId: TreeSitterLanguageId
  readonly previousSnapshotVersion: number
  readonly snapshotVersion: number
  readonly previousRead: TextReadSnapshot
  readonly source: DocumentWorkerReadReference
  readonly edits: readonly TextEdit[]
  readonly includeHighlights?: boolean
  readonly includeCaptures?: boolean
}

type TreeSitterEditPayloadOptions = TreeSitterBaseEditPayloadOptions & {
  readonly resultMode?: 'full'
}

type TreeSitterParseOnlyEditPayloadOptions = TreeSitterBaseEditPayloadOptions & {
  readonly resultMode: 'parseOnly'
}

export function createTreeSitterEditPayload(
  options: TreeSitterParseOnlyEditPayloadOptions,
): TreeSitterBackendEditPayload | null
export function createTreeSitterEditPayload(
  options: TreeSitterEditPayloadOptions,
): TreeSitterEditPayload | null
export function createTreeSitterEditPayload(
  options: TreeSitterEditPayloadOptions | TreeSitterParseOnlyEditPayloadOptions,
): TreeSitterBackendEditPayload | null {
  if (options.edits.length === 0) return null

  return {
    documentId: options.documentId,
    runtimeSessionId: options.runtimeSessionId,
    previousSnapshotVersion: options.previousSnapshotVersion,
    snapshotVersion: options.snapshotVersion,
    languageId: options.languageId,
    includeHighlights: options.includeHighlights ?? true,
    includeCaptures: options.includeCaptures,
    resultMode: options.resultMode,
    source: options.source,
    edits: options.edits,
    inputEdits: createTreeSitterInputEdits(options.previousRead, options.edits),
  }
}

type TreeSitterSyntaxResultContext = {
  readonly includeCaptures: boolean
  readonly includeHighlights: boolean
  readonly mode: 'full' | 'range'
  readonly requestedRanges: readonly EditorSyntaxRange[]
  readonly snapshotLength: number
}

const treeSitterParseResultToEditorSyntaxResult: typeof treeSitterParseResultToEditorSyntaxResultInner =
  (result, context) => {
    recordParseResultPayload(result)
    return treeSitterParseResultToEditorSyntaxResultInner(result, context)
  }

const treeSitterParseResultToEditorSyntaxResultInner = (
  result: TreeSitterParseResult,
  context: TreeSitterSyntaxResultContext,
): EditorSyntaxResult => ({
  captures: result.captures,
  records: result.records,
  degraded: treeSitterDegradedStateToEditorSyntaxState(result.degraded),
  folds: result.folds,
  brackets: result.brackets,
  errors: result.errors,
  injections: result.injections,
  projection: {
    source: result.source,
    analysis: result.analysis ?? {
      kind: 'full',
      coveredRange: { startIndex: 0, endIndex: context.snapshotLength },
    },
    language: {
      includeCaptures: context.includeCaptures,
      includeHighlights: context.includeHighlights,
      languageId: result.languageId,
      mode: context.mode,
    },
    requestedRanges: context.requestedRanges,
    snapshot: {
      documentId: result.documentId,
      length: context.snapshotLength,
      version: result.snapshotVersion,
    },
  },
  tokens: resultTokens(result),
})

function resultTokens(result: TreeSitterParseResult): EditorTokenStore {
  if (result.tokensPacked) return EditorTokenStore.fromPacked(result.tokensPacked)
  return EditorTokenStore.fromTokens(
    result.tokens ?? treeSitterCapturesToEditorTokens(result.captures),
  )
}

function recordParseResultPayload(result: TreeSitterParseResult): void {
  const sink = (
    globalThis as {
      __EDITOR_PERFORMANCE_DIAGNOSTICS__?: {
        enabled: boolean
        record(diagnostic: { name: string; detail?: Record<string, unknown> }): void
      } | null
    }
  ).__EDITOR_PERFORMANCE_DIAGNOSTICS__
  if (!sink?.enabled) return

  sink.record({
    name: 'treeSitter.parseResult.payload',
    detail: {
      captures: result.captures.length,
      tokens: result.tokens?.length ?? result.tokensPacked?.starts.length ?? -1,
      folds: result.folds.length,
      brackets: result.brackets.length,
      errors: result.errors.length,
      injections: result.injections.length,
    },
  })
}

const treeSitterDegradedStateToEditorSyntaxState = (
  degraded: readonly TreeSitterDegradedState[] | undefined,
): EditorSyntaxDegradedState | null => {
  const first = degraded?.[0]
  if (!first) return null

  return {
    kind: first.kind,
    phase: first.phase,
    message:
      degraded.length === 1
        ? first.message
        : `${first.message} (${degraded.length} Tree-sitter phases degraded)`,
  }
}

const isTreeSitterParseAckResult = (
  result: TreeSitterParseResult | TreeSitterParseAckResult,
): result is TreeSitterParseAckResult =>
  'status' in result && (result.status === 'parsed' || result.status === 'cancelled')

const sameSyntaxRange = (left: EditorSyntaxRange, right: EditorSyntaxRange): boolean =>
  left.startIndex === right.startIndex && left.endIndex === right.endIndex

const createTreeSitterInputEdits = (
  read: TextReadSnapshot,
  edits: readonly TextEdit[],
): TreeSitterInputEdit[] =>
  edits
    .toSorted((left, right) => right.from - left.from || right.to - left.to)
    .map((edit) => {
      const startPosition = pointAt(read, edit.from)
      return {
        startIndex: edit.from,
        oldEndIndex: edit.to,
        newEndIndex: edit.from + edit.text.length,
        startPosition,
        oldEndPosition: pointAt(read, edit.to),
        newEndPosition: insertedEndPosition(startPosition, edit.text),
      }
    })

function pointAt(read: TextReadSnapshot, offset: number): TreeSitterInputEdit['startPosition'] {
  const row = read.lineAt(offset)
  return { row, column: offset - read.lineStart(row) }
}

function insertedEndPosition(
  start: TreeSitterInputEdit['startPosition'],
  text: string,
): TreeSitterInputEdit['newEndPosition'] {
  let lines = 0
  let lastBreak = -1
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines++
    lastBreak = index
  }
  return {
    row: start.row + lines,
    column: lines === 0 ? start.column + text.length : text.length - lastBreak - 1,
  }
}
