import {
  applyBatchToPieceTable,
  diffPieceTableSnapshots,
  type DocumentSessionChange,
  type DocumentTextSnapshot,
  offsetToPoint,
  type PieceTableSnapshot,
  pieceTableSnapshotsHaveSameText,
  type TextEdit,
} from '@singapore-editor/core/document'
import {
  createEmptySyntaxResult,
  createEditorRuntimeSessionId,
  type EditorSyntaxDegradedState,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
  type EditorSyntaxFoldingSupport,
  treeSitterCapturesToEditorTokens,
  EditorTokenStore,
} from '@singapore-editor/core/syntax'
import { documentSessionChangeTextSnapshot } from '@singapore-editor/core/document'
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
  createTreeSitterWorkerBackend,
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
  readonly textSnapshot: DocumentTextSnapshot
  readonly snapshot: PieceTableSnapshot
  readonly backend?: TreeSitterBackend
  /** Called once, after the session's first parse answers. */
  readonly onFirstParse?: () => void
}

export class TreeSitterSyntaxSession implements EditorSyntaxSession {
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
  private textSnapshot: DocumentTextSnapshot
  private snapshot: PieceTableSnapshot
  private result: EditorSyntaxResult
  private currentFoldingSupport: EditorSyntaxFoldingSupport
  private languageRegistrationPromise: Promise<boolean> | null = null
  private readonly pendingLanguages = new Map<
    string,
    Promise<readonly TreeSitterLanguageDescriptor[]>
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
    this.textSnapshot = options.textSnapshot
    this.snapshot = options.snapshot
    this.backend = options.backend ?? createTreeSitterWorkerBackend()
    this.onFirstParse = options.onFirstParse
    this.result = this.createEmptyResult({ snapshot: options.snapshot, snapshotVersion: 0 })
  }

  public get foldingSupport(): EditorSyntaxFoldingSupport {
    return this.currentFoldingSupport
  }

  public async refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result

    const snapshotVersion = ++this.snapshotVersion
    const snapshot = textSnapshot.snapshot

    if (!(await this.ensureLanguageRegistered())) {
      return this.updateFromUnavailableLanguage(textSnapshot, snapshot)
    }

    // Language registration takes seconds on cold start, and the session can
    // be disposed while it is awaited. Parsing then would register a worker
    // document nothing ever frees: dispose already ran, and its
    // disposeDocument silently no-ops while the worker does not exist yet.
    if (this.disposed || !this.isCurrentSnapshotVersion(snapshotVersion)) return this.result

    const parsePayload = {
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      snapshotVersion,
      languageId: this.languageId,
      includeHighlights: this.includeHighlights,
      includeCaptures: this.includeCaptures,
      snapshot,
    }
    let result = await this.backend.parse(
      this.syntaxMode === 'range'
        ? { ...parsePayload, resultMode: 'parseOnly' }
        : { ...parsePayload, resultMode: 'full' },
    )

    for (let depth = 0; depth < 8 && result?.missingLanguages?.length; depth += 1) {
      if (!(await this.registerMissingLanguages(result.missingLanguages, snapshotVersion))) break
      if (this.disposed || !this.isCurrentSnapshotVersion(snapshotVersion)) return this.result
      result = await this.backend.parse(
        this.syntaxMode === 'range'
          ? { ...parsePayload, resultMode: 'parseOnly' }
          : { ...parsePayload, resultMode: 'full' },
      )
    }

    const next = this.updateFromTreeSitterResult(result, snapshotVersion, textSnapshot, snapshot)
    if (result && !this.disposed) this.notifyFirstParse()
    return next
  }

  private notifyFirstParse(): void {
    const onFirstParse = this.onFirstParse
    this.onFirstParse = undefined
    onFirstParse?.()
  }

  public async applyChange(change: DocumentSessionChange): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result
    if (change.kind === 'none' || change.kind === 'selection') {
      return this.result
    }

    if (this.parsedSnapshotVersion === 0) {
      return this.refresh(documentSessionChangeTextSnapshot(change))
    }

    if (!(await this.ensureLanguageRegistered())) {
      this.snapshotVersion += 1
      return this.updateFromUnavailableLanguage(
        documentSessionChangeTextSnapshot(change),
        change.snapshot,
      )
    }

    if (this.disposed) return this.result

    const edits = createSyntaxTextEdits(this.textSnapshot, this.snapshot, change)
    if (edits.length === 0) {
      this.textSnapshot = documentSessionChangeTextSnapshot(change)
      this.snapshot = change.snapshot
      return this.result
    }

    const editPayloadOptions = {
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      languageId: this.languageId,
      previousSnapshotVersion: this.parsedSnapshotVersion,
      snapshotVersion: ++this.snapshotVersion,
      previousSnapshot: this.snapshot,
      nextSnapshot: change.snapshot,
      edits,
      includeHighlights: this.includeHighlights,
      includeCaptures: this.includeCaptures,
    }
    const payload =
      this.syntaxMode === 'range'
        ? createTreeSitterEditPayload({ ...editPayloadOptions, resultMode: 'parseOnly' })
        : createTreeSitterEditPayload({ ...editPayloadOptions, resultMode: 'full' })

    if (!payload) {
      return this.refresh(documentSessionChangeTextSnapshot(change))
    }

    return this.applyIncrementalEdit(payload, documentSessionChangeTextSnapshot(change))
  }

  public async queryRange(range: EditorSyntaxRange): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result
    if (!this.backend.queryRange) {
      return this.createRangeUnavailableResult(range, 'Tree-sitter range queries are unavailable')
    }
    if (!this.canQueryRange()) {
      return this.createRangeUnavailableResult(range, 'Tree-sitter document has not been parsed')
    }

    const result = await this.backend.queryRange({
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      snapshotVersion: this.parsedSnapshotVersion,
      languageId: this.languageId,
      includeHighlights: this.includeHighlights,
      includeCaptures: this.includeCaptures,
      range,
    })

    return this.updateFromTreeSitterRangeResult(result, range)
  }

  public canQueryRange(): boolean {
    return this.parsedSnapshotVersion !== 0 && this.parsedSnapshotVersion === this.snapshotVersion
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

    this.disposed = true
    this.backend.disposeDocument(this.runtimeSessionId)
  }

  private async applyIncrementalEdit(
    payload: TreeSitterBackendEditPayload,
    nextTextSnapshot: DocumentTextSnapshot,
  ): Promise<EditorSyntaxResult> {
    try {
      const result = await this.backend.edit(payload)
      if (this.disposed) return this.result
      if (!this.isCurrentSnapshotVersion(payload.snapshotVersion)) {
        return this.result
      }

      if (!result) {
        return this.reparseAfterIncrementalFailure(nextTextSnapshot)
      }

      if (result.snapshotVersion !== payload.snapshotVersion) {
        return this.reparseAfterIncrementalFailure(nextTextSnapshot)
      }

      if (
        await this.registerMissingLanguages(result.missingLanguages ?? [], payload.snapshotVersion)
      ) {
        if (this.disposed || !this.isCurrentSnapshotVersion(payload.snapshotVersion))
          return this.result
        return this.refresh(nextTextSnapshot)
      }

      return this.updateFromTreeSitterResult(
        result,
        payload.snapshotVersion,
        nextTextSnapshot,
        payload.snapshot,
      )
    } catch {
      if (this.disposed) return this.result
      if (!this.isCurrentSnapshotVersion(payload.snapshotVersion)) {
        return this.result
      }

      return this.reparseAfterIncrementalFailure(nextTextSnapshot)
    }
  }

  private reparseAfterIncrementalFailure(
    textSnapshot: DocumentTextSnapshot,
  ): Promise<EditorSyntaxResult> {
    if (this.disposed) return Promise.resolve(this.result)

    this.parsedSnapshotVersion = 0
    const disposedRuntimeSessionId = this.runtimeSessionId
    this.runtimeSessionId = createEditorRuntimeSessionId()
    this.backend.disposeDocument(disposedRuntimeSessionId)
    return this.refresh(textSnapshot)
  }

  private isCurrentSnapshotVersion(snapshotVersion: number): boolean {
    return snapshotVersion === this.snapshotVersion
  }

  private ensureLanguageRegistered(): Promise<boolean> {
    if (!this.languageResolver) return Promise.resolve(true)
    if (!this.languageRegistrationPromise) {
      this.languageRegistrationPromise = this.registerResolvedLanguage()
    }

    return this.languageRegistrationPromise
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

  private updateFromUnavailableLanguage(
    textSnapshot: DocumentTextSnapshot,
    snapshot: PieceTableSnapshot,
  ): EditorSyntaxResult {
    if (this.disposed) return this.result

    this.textSnapshot = textSnapshot
    this.snapshot = snapshot
    this.result = this.createEmptyResult({
      degraded: {
        kind: 'language-unavailable',
        message: `Tree-sitter language "${this.languageId}" is unavailable`,
      },
      snapshot,
      snapshotVersion: this.snapshotVersion,
    })
    return this.result
  }

  private updateFromTreeSitterResult(
    result: TreeSitterParseResult | TreeSitterParseAckResult | undefined,
    snapshotVersion: number,
    textSnapshot: DocumentTextSnapshot,
    snapshot: PieceTableSnapshot,
  ): EditorSyntaxResult {
    if (this.disposed) return this.result
    if (!result) return this.result
    if (result.snapshotVersion !== snapshotVersion) return this.result
    if (result.snapshotVersion !== this.snapshotVersion) return this.result

    this.textSnapshot = textSnapshot
    this.snapshot = snapshot
    this.parsedSnapshotVersion = result.snapshotVersion
    if (isTreeSitterParseAckResult(result)) {
      this.result = this.createEmptyResult({
        degraded: treeSitterDegradedStateToEditorSyntaxState(result.degraded),
        snapshot,
        snapshotVersion: result.snapshotVersion,
      })
      return this.result
    }

    this.result = treeSitterParseResultToEditorSyntaxResult(
      result,
      this.resultContext(snapshot, []),
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

    this.result = treeSitterParseResultToEditorSyntaxResult(
      result,
      this.resultContext(this.snapshot, [range]),
    )
    return this.result
  }

  private createRangeUnavailableResult(
    range: EditorSyntaxRange,
    message: string,
  ): EditorSyntaxResult {
    return this.createEmptyResult({
      degraded: { kind: 'range-unavailable', message },
      requestedRanges: [range],
      snapshot: this.snapshot,
      snapshotVersion: this.parsedSnapshotVersion,
    })
  }

  private createEmptyResult(options: {
    readonly degraded?: EditorSyntaxDegradedState | null
    readonly requestedRanges?: readonly EditorSyntaxRange[]
    readonly snapshot: PieceTableSnapshot
    readonly snapshotVersion: number
  }): EditorSyntaxResult {
    return createEmptySyntaxResult({
      degraded: options.degraded,
      language: this.languageConfiguration(),
      requestedRanges: options.requestedRanges,
      snapshot: this.snapshotTag(options.snapshot, options.snapshotVersion),
    })
  }

  private resultContext(
    snapshot: PieceTableSnapshot,
    requestedRanges: readonly EditorSyntaxRange[],
  ): TreeSitterSyntaxResultContext {
    return {
      includeCaptures: this.includeCaptures,
      includeHighlights: this.includeHighlights,
      mode: this.syntaxMode,
      requestedRanges,
      snapshotLength: snapshot.length,
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

  private snapshotTag(snapshot: PieceTableSnapshot, snapshotVersion: number) {
    return {
      documentId: this.documentId,
      length: snapshot.length,
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
  readonly previousSnapshot: PieceTableSnapshot
  readonly nextSnapshot: PieceTableSnapshot
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
    snapshot: options.nextSnapshot,
    edits: options.edits,
    inputEdits: createTreeSitterInputEdits(options.previousSnapshot, options.edits),
  }
}

export const createTextDiffEdit = (previousText: string, nextText: string): TextEdit | null => {
  if (previousText === nextText) return null

  let start = 0
  const maxPrefixLength = Math.min(previousText.length, nextText.length)
  while (start < maxPrefixLength && previousText[start] === nextText[start]) start += 1

  let previousEnd = previousText.length
  let nextEnd = nextText.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousText[previousEnd - 1] === nextText[nextEnd - 1]
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return {
    from: start,
    to: previousEnd,
    text: nextText.slice(start, nextEnd),
  }
}

const createSyntaxTextEdits = (
  previousTextSnapshot: DocumentTextSnapshot,
  previousSnapshot: PieceTableSnapshot,
  change: DocumentSessionChange,
): readonly TextEdit[] => {
  if (changeEditsApplyToSnapshot(previousSnapshot, change)) return change.edits

  const edit = diffPieceTableSnapshots(
    previousTextSnapshot.snapshot,
    documentSessionChangeTextSnapshot(change).snapshot,
  )
  return edit ? [edit] : []
}

const changeEditsApplyToSnapshot = (
  snapshot: PieceTableSnapshot,
  change: DocumentSessionChange,
): boolean => {
  try {
    return pieceTableSnapshotsHaveSameText(
      applyBatchToPieceTable(snapshot, change.edits),
      change.snapshot,
    )
  } catch {
    return false
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
  degraded: treeSitterDegradedStateToEditorSyntaxState(result.degraded),
  folds: result.folds,
  brackets: result.brackets,
  errors: result.errors,
  injections: result.injections,
  projection: {
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
): result is TreeSitterParseAckResult => 'status' in result && result.status === 'parsed'

const sameSyntaxRange = (left: EditorSyntaxRange, right: EditorSyntaxRange): boolean =>
  left.startIndex === right.startIndex && left.endIndex === right.endIndex

const createTreeSitterInputEdits = (
  snapshot: PieceTableSnapshot,
  edits: readonly TextEdit[],
): TreeSitterInputEdit[] => {
  const sorted = edits.toSorted((left, right) => right.from - left.from || right.to - left.to)
  const inputEdits: TreeSitterInputEdit[] = []
  let workingSnapshot = snapshot

  for (const edit of sorted) {
    const startPosition = offsetToPoint(workingSnapshot, edit.from)
    const oldEndPosition = offsetToPoint(workingSnapshot, edit.to)
    const nextSnapshot = applyBatchToPieceTable(workingSnapshot, [edit])
    const newEndIndex = edit.from + edit.text.length

    inputEdits.push({
      startIndex: edit.from,
      oldEndIndex: edit.to,
      newEndIndex,
      startPosition,
      oldEndPosition,
      newEndPosition: offsetToPoint(nextSnapshot, newEndIndex),
    })
    workingSnapshot = nextSnapshot
  }

  return inputEdits
}
