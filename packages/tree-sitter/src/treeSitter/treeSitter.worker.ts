import {
  Edit,
  Language,
  Parser,
  Query,
  type Node,
  type Range as TreeSitterRange,
  type Tree,
  type TreeCursor,
} from 'web-tree-sitter'
import {
  packEditorTokens,
  packedEditorTokenTransfers,
  treeSitterCapturesToEditorTokens,
} from '@singapore-editor/core/syntax'
import type { PackedEditorTokens } from '@singapore-editor/core/syntax'
import parserWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import type { TreeSitterLanguageDescriptor } from './registry'
import {
  clearTreeSitterSourceCache,
  disposeTreeSitterSourceDocument,
  readTreeSitterInputRange,
  readTreeSitterPieceTableInput,
  resolveTreeSitterSourceDescriptor,
  type TreeSitterSourceCache,
  type TreeSitterPieceTableInput,
} from './source'
import type {
  BracketInfo,
  FoldRange,
  TreeSitterCapture,
  TreeSitterDegradedState,
  TreeSitterEditRequest,
  TreeSitterError,
  TreeSitterInjectionInfo,
  TreeSitterLanguageId,
  TreeSitterParseAckResult,
  TreeSitterParseRequest,
  TreeSitterParseResult,
  TreeSitterRangeRequest,
  TreeSitterRangeResult,
  TreeSitterSelectionRange,
  TreeSitterSelectionRequest,
  TreeSitterSelectionResult,
  TreeSitterSyntaxRange,
  TreeSitterWorkerRequest,
  TreeSitterWorkerResult,
  TreeSitterWorkerResponse,
} from './types'

type Runtime = {
  readonly descriptor: TreeSitterLanguageDescriptor
  readonly language: Language
  readonly parser: Parser
  highlightQuery: Query | null
  foldQuery: Query | null
  injectionQuery: Query | null
}

type LayerKind = 'root' | 'injection' | 'combined-injection'

type LayerKey = string

type ParsedLayer = {
  readonly id: string
  readonly key: LayerKey
  readonly kind: LayerKind
  readonly parentId: string | null
  readonly parentLanguageId: TreeSitterLanguageId | null
  readonly languageId: TreeSitterLanguageId
  readonly depth: number
  readonly tree: Tree
  readonly ranges: readonly TreeSitterRange[]
}

type ParsedDocument = {
  readonly snapshotVersion: number
  readonly languageId: TreeSitterLanguageId
  readonly source: TreeSitterPieceTableInput
  readonly layers: readonly ParsedLayer[]
  readonly degraded: readonly TreeSitterDegradedState[]
  readonly missingLanguages: readonly string[]
  readonly size: number
  lastUsed: number
}

type DocumentCache = {
  readonly documentId: string
  readonly snapshots: ParsedDocument[]
}

type CancellationContext = {
  readonly startedAt: number
  readonly budgetMs: number
  readonly flag: Int32Array | null
  readonly measurements?: Map<string, number>
  readonly counts?: Map<string, number>
}

type FlattenedDocument = Pick<
  TreeSitterParseResult,
  'captures' | 'folds' | 'brackets' | 'errors' | 'injections' | 'tokens' | 'tokensPacked'
> & {
  readonly degraded: readonly TreeSitterDegradedState[]
}

type RangeFlattenOptions = {
  readonly range: TreeSitterSyntaxRange
  readonly includeHighlights: boolean
  readonly includeCaptures: boolean
}

type InjectionPlan = {
  readonly id: string
  readonly key: LayerKey
  readonly kind: Extract<LayerKind, 'injection' | 'combined-injection'>
  readonly parentId: string
  readonly parentLanguageId: TreeSitterLanguageId
  readonly languageId: TreeSitterLanguageId
  readonly depth: number
  readonly ranges: readonly TreeSitterRange[]
}

type TreeWalkVisitors = {
  readonly onBracket: (info: BracketInfo) => void
  readonly onError: (info: TreeSitterError) => void
}

const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const OPEN_BRACKETS = new Set(Object.keys(BRACKET_PAIRS))
const CLOSE_BRACKETS = new Set(Object.values(BRACKET_PAIRS))
const MAX_RETAINED_SNAPSHOTS = 6
const MAX_RETAINED_SOURCE_UNITS = 8_000_000
const MAX_INJECTION_DEPTH = 8
const MAX_INJECTION_LAYERS = 256
const PARSE_BUDGET_MS = 20_000
const QUERY_BUDGET_MS = 20_000

let parserInitPromise: Promise<void> | null = null
let nextUse = 1
const languageDescriptors = new Map<TreeSitterLanguageId, TreeSitterLanguageDescriptor>()
const languageDescriptorOrder: TreeSitterLanguageId[] = []
const runtimePromises = new Map<TreeSitterLanguageId, Promise<Runtime>>()
const documentCaches = new Map<string, DocumentCache>()
const sourceCache: TreeSitterSourceCache = new Map()
const activeRuntimeTasks = new Map<string, Set<Promise<TreeSitterWorkerResult>>>()
const activeWorkerTasks = new Set<Promise<TreeSitterWorkerResult>>()
const disposedRuntimeSessions = new Set<string>()
const MAX_DISPOSED_RUNTIME_SESSIONS = 1_024

class SyntaxRequestCancelled extends Error {
  public constructor() {
    super('Tree-sitter request cancelled')
  }
}

const assertRuntimeSessionActive = (runtimeSessionId: string): void => {
  if (!disposedRuntimeSessions.has(runtimeSessionId)) return
  throw new SyntaxRequestCancelled()
}

const createErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const ensureParserRuntime = async (): Promise<void> => {
  if (parserInitPromise) return parserInitPromise

  parserInitPromise = Parser.init({ locateFile: () => parserWasmUrl }).catch((error) => {
    parserInitPromise = null
    throw error
  })
  return parserInitPromise
}

const registerLanguages = (descriptors: readonly TreeSitterLanguageDescriptor[]): void => {
  for (const descriptor of descriptors) registerLanguage(descriptor)
}

const registerLanguage = (descriptor: TreeSitterLanguageDescriptor): void => {
  const normalized = normalizeLanguageDescriptor(descriptor)
  const existing = languageDescriptors.get(normalized.id)

  languageDescriptors.set(normalized.id, normalized)
  moveLanguageToEnd(normalized.id)

  if (!existing) return
  if (languageDescriptorsEqual(existing, normalized)) return

  disposeRuntimeForLanguage(normalized.id)
  disposeCachedSnapshotsForLanguage(normalized.id)
}

const ensureRuntime = async (languageId: TreeSitterLanguageId): Promise<Runtime> => {
  const existing = runtimePromises.get(languageId)
  if (existing) return existing

  const promise = createRuntime(languageId)
  runtimePromises.set(languageId, promise)
  return promise
}

const createRuntime = async (languageId: TreeSitterLanguageId): Promise<Runtime> => {
  await ensureParserRuntime()

  const descriptor = languageDescriptors.get(languageId)
  if (!descriptor) throw new Error(`Tree-sitter language "${languageId}" is not registered`)

  const language = await Language.load(descriptor.wasmUrl)
  const parser = new Parser()
  parser.setLanguage(language)

  return {
    descriptor,
    language,
    parser,
    highlightQuery: null,
    foldQuery: null,
    injectionQuery: null,
  }
}

const ensureQuery = (runtime: Runtime, kind: 'highlight' | 'fold' | 'injection'): Query | null => {
  if (kind === 'highlight') return ensureHighlightQuery(runtime)
  if (kind === 'fold') return ensureFoldQuery(runtime)
  return ensureInjectionQuery(runtime)
}

const ensureHighlightQuery = (runtime: Runtime): Query | null => {
  if (!runtime.descriptor.highlightQuerySource) return null
  if (runtime.descriptor.highlightQuerySource.trim().length === 0) return null
  if (runtime.highlightQuery) return runtime.highlightQuery

  runtime.highlightQuery = new Query(runtime.language, runtime.descriptor.highlightQuerySource)
  return runtime.highlightQuery
}

const ensureFoldQuery = (runtime: Runtime): Query | null => {
  if (!runtime.descriptor.foldQuerySource) return null
  if (runtime.foldQuery) return runtime.foldQuery

  runtime.foldQuery = new Query(runtime.language, runtime.descriptor.foldQuerySource)
  return runtime.foldQuery
}

const ensureInjectionQuery = (runtime: Runtime): Query | null => {
  if (!runtime.descriptor.injectionQuerySource) return null
  if (runtime.descriptor.injectionQuerySource.trim().length === 0) return null
  if (runtime.injectionQuery) return runtime.injectionQuery

  runtime.injectionQuery = new Query(runtime.language, runtime.descriptor.injectionQuerySource)
  return runtime.injectionQuery
}

// Resolved on receipt, in message order: the client's sent-chunk ledger assumes that order.
const resolveRequestSource = (
  request: TreeSitterParseRequest | TreeSitterEditRequest,
): TreeSitterPieceTableInput =>
  runWorkerPhase('resolve source', () =>
    resolveTreeSitterSourceDescriptor(sourceCache, request.runtimeSessionId, request.source),
  )

const parseDocument = async (
  request: TreeSitterParseRequest,
  source: TreeSitterPieceTableInput,
): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> =>
  runCancellableRequest(request, async (context) => {
    const runtime = await runAsyncWorkerPhase('load runtime', () =>
      ensureRuntime(request.languageId),
    )
    const parseStart = nowMs()
    const parsedDocument =
      (await reusableParsedDocument(request, source, context)) ??
      (await parseFullDocument(request, runtime, source, context))
    const parseMs = nowMs() - parseStart
    if (request.resultMode === 'parseOnly') {
      return parseAckResult(
        request,
        [],
        [{ name: 'treeSitter.parse', durationMs: parseMs }, ...phaseTimings(context)],
        parsedDocument.degraded,
        parsedDocument.missingLanguages,
      )
    }

    const queryStart = nowMs()
    const result = await runAsyncWorkerPhase('flatten', () =>
      flattenDocument(
        parsedDocument,
        context,
        request.includeHighlights,
        request.includeCaptures ?? true,
      ),
    )
    assertNotCancelled(context)
    const queryMs = nowMs() - queryStart

    return {
      documentId: request.documentId,
      snapshotVersion: request.snapshotVersion,
      languageId: request.languageId,
      statistics: resultStatistics(parsedDocument, result, context),
      missingLanguages: parsedDocument.missingLanguages,
      captures: result.captures,
      folds: result.folds,
      brackets: result.brackets,
      errors: result.errors,
      injections: result.injections,
      degraded: result.degraded,
      tokens: result.tokens,
      tokensPacked: result.tokensPacked,
      timings: [
        ...phaseTimings(context),
        { name: 'treeSitter.parse', durationMs: parseMs },
        { name: 'treeSitter.query', durationMs: queryMs },
      ],
    }
  })

// One document state exists per runtime session, so a cached snapshot with the
// same language and snapshotVersion is the same content (the source length
// check guards against upstream bugs). Reparsing it would briefly hold two
// full trees for one document — the dev StrictMode double-mount OOM'd the
// worker WASM on a 48MB file exactly that way.
const reusableParsedDocument = async (
  request: TreeSitterParseRequest,
  source: TreeSitterPieceTableInput,
  context: CancellationContext,
): Promise<ParsedDocument | null> => {
  const cached = cachedDocumentForVersion(
    request.runtimeSessionId,
    request.languageId,
    request.snapshotVersion,
  )
  if (!cached) return null
  if (cached.size === source.length) {
    if (!cached.missingLanguages.some((id) => resolveRegisteredLanguageAlias(id))) return cached
    return reloadInjections(request, cached, context)
  }

  // Same version with different content is stale state; free the old tree
  // before reparsing so peak memory stays at one tree per document.
  dropCachedDocument(request.runtimeSessionId, cached)
  return null
}

const reloadInjections = async (
  request: TreeSitterParseRequest,
  cached: ParsedDocument,
  context: CancellationContext,
): Promise<ParsedDocument> => {
  const root = cached.layers[0]!
  const document = await parseParsedDocument({
    documentId: request.documentId,
    snapshotVersion: request.snapshotVersion,
    languageId: request.languageId,
    source: cached.source,
    rootLayer: { ...root, tree: root.tree.copy() },
    context,
    oldDocument: cached,
    inputEdits: [],
    injectionRanges: null,
    degraded: [],
  })
  assertNotCancelled(context)
  assertRuntimeSessionActive(request.runtimeSessionId)
  replaceCachedDocument(request.runtimeSessionId, document)
  return document
}

const dropCachedDocument = (documentId: string, snapshot: ParsedDocument): void => {
  const cache = documentCaches.get(documentId)
  if (!cache) return

  const index = cache.snapshots.indexOf(snapshot)
  if (index === -1) return

  cache.snapshots.splice(index, 1)
  disposeCachedSnapshot(snapshot)
}

const parseFullDocument = async (
  request: TreeSitterParseRequest,
  runtime: Runtime,
  source: TreeSitterPieceTableInput,
  context: CancellationContext,
): Promise<ParsedDocument> => {
  const rootLayer = runWorkerPhase('parse root', () =>
    measurePhase(context, 'parseRoot', () => parseRootLayer(runtime, source, null, context)),
  )
  const degraded: TreeSitterDegradedState[] = []
  const parsedDocument = await runAsyncWorkerPhase('parse injections', () =>
    parseParsedDocument({
      documentId: request.documentId,
      snapshotVersion: request.snapshotVersion,
      languageId: request.languageId,
      source,
      rootLayer,
      context,
      oldDocument: null,
      inputEdits: [],
      injectionRanges: null,
      degraded,
    }),
  )
  assertNotCancelled(context)
  assertRuntimeSessionActive(request.runtimeSessionId)
  replaceCachedDocument(request.runtimeSessionId, parsedDocument)
  scheduleIdleReparse(request.runtimeSessionId, parsedDocument, runtime)
  return parsedDocument
}

// The first edit of a freshly parsed tree can reparse the whole document: tree-sitter refuses to
// reuse a node whose first token was lexed in another state, and markdown's external scanner makes
// that every block (43 ms at 1 MB). One unchanged reparse while the worker is idle takes it off the
// first keystroke.
const scheduleIdleReparse = (
  runtimeSessionId: string,
  document: ParsedDocument,
  runtime: Runtime,
): void => {
  // @justification Runs once after the parse answer is posted; it re-checks that the document is
  // still cached and idle, so a late or stale callback does nothing.
  setTimeout(() => reparseIdleDocument(runtimeSessionId, document, runtime), 0)
}

const reparseIdleDocument = (
  runtimeSessionId: string,
  document: ParsedDocument,
  runtime: Runtime,
): void => {
  if (activeRuntimeTasks.has(runtimeSessionId)) return
  const cache = documentCaches.get(runtimeSessionId)
  const index = cache?.snapshots.indexOf(document) ?? -1
  if (!cache || index === -1) return

  const [root, ...injections] = document.layers
  if (!root) return
  const context = createCancellationContext(undefined, PARSE_BUDGET_MS)
  try {
    const tree = parseSource(runtime.parser, document.source, root.tree, context)
    cache.snapshots[index] = { ...document, layers: [{ ...root, tree }, ...injections] }
    root.tree.delete()
  } catch (error) {
    recordOptionalWorkerPhaseFailure('idle reparse', error, [], 'optional-phase-failed')
  }
}

const editDocument = async (
  request: TreeSitterEditRequest,
  source: TreeSitterPieceTableInput,
): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> =>
  runCancellableRequest(request, async (context) => {
    const runtime = await runAsyncWorkerPhase('load runtime', () =>
      ensureRuntime(request.languageId),
    )
    const cached = cachedDocumentForVersion(
      request.runtimeSessionId,
      request.languageId,
      request.previousSnapshotVersion,
    )
    if (!cached) return undefined

    const editStart = nowMs()
    const oldRootLayer = rootLayerForDocument(cached)
    const reusableTree = runWorkerPhase('prepare reusable tree', () =>
      editReusableTree(oldRootLayer.tree, request.inputEdits),
    )
    const editMs = nowMs() - editStart
    const parseStart = nowMs()
    const rootLayer = runWorkerPhase('parse root', () =>
      measurePhase(context, 'parseRoot', () =>
        parseRootLayer(runtime, source, reusableTree, context),
      ),
    )
    const changedRanges = runWorkerPhase('changed ranges', () =>
      treeChangedRanges(reusableTree, rootLayer.tree),
    )
    // A delimiter edit that moves structure outside the edited range shows up in the root's
    // changed ranges; an edit inside an injection's text may change no root structure at all.
    const injectionRanges = enclosingRanges(
      [...changedRanges, ...editedRanges(request.inputEdits, source.length)],
      [reusableTree, rootLayer.tree],
    )
    const degraded: TreeSitterDegradedState[] = []
    const parsedDocument = await runAsyncWorkerPhase('parse injections', () =>
      parseParsedDocument({
        documentId: request.documentId,
        snapshotVersion: request.snapshotVersion,
        languageId: request.languageId,
        source,
        rootLayer,
        context,
        oldDocument: cached,
        inputEdits: request.inputEdits,
        injectionRanges,
        degraded,
      }),
    )
    const parseMs = nowMs() - parseStart
    reusableTree.delete()
    assertNotCancelled(context)
    assertRuntimeSessionActive(request.runtimeSessionId)
    replaceCachedDocument(request.runtimeSessionId, parsedDocument)
    if (request.resultMode === 'parseOnly') {
      return parseAckResult(
        request,
        changedRanges,
        [
          ...phaseTimings(context),
          { name: 'treeSitter.edit', durationMs: editMs },
          { name: 'treeSitter.parse', durationMs: parseMs },
        ],
        degraded,
        parsedDocument.missingLanguages,
      )
    }

    const queryStart = nowMs()
    const result = await runAsyncWorkerPhase('flatten', () =>
      flattenDocument(
        parsedDocument,
        context,
        request.includeHighlights,
        request.includeCaptures ?? true,
      ),
    )
    assertNotCancelled(context)
    const queryMs = nowMs() - queryStart

    return {
      documentId: request.documentId,
      snapshotVersion: request.snapshotVersion,
      languageId: request.languageId,
      statistics: resultStatistics(parsedDocument, result, context),
      missingLanguages: parsedDocument.missingLanguages,
      captures: result.captures,
      folds: result.folds,
      brackets: result.brackets,
      errors: result.errors,
      injections: result.injections,
      degraded: result.degraded,
      tokens: result.tokens,
      tokensPacked: result.tokensPacked,
      timings: [
        ...phaseTimings(context),
        { name: 'treeSitter.edit', durationMs: editMs },
        { name: 'treeSitter.parse', durationMs: parseMs },
        { name: 'treeSitter.query', durationMs: queryMs },
      ],
    }
  })

const queryDocumentRange = async (
  request: TreeSitterRangeRequest,
): Promise<TreeSitterRangeResult | undefined> => {
  const context = createCancellationContext(request.cancellationBuffer, QUERY_BUDGET_MS)
  try {
    return await queryDocumentRangeWithContext(request, context)
  } catch (error) {
    if (error instanceof SyntaxRequestCancelled) return undefined
    throw error
  }
}

const queryDocumentRangeWithContext = async (
  request: TreeSitterRangeRequest,
  context: CancellationContext,
): Promise<TreeSitterRangeResult | undefined> => {
  const cached = cachedDocumentForVersion(
    request.runtimeSessionId,
    request.languageId,
    request.snapshotVersion,
  )
  if (!cached) return undefined

  const range = normalizedSyntaxRange(request.range, cached.size)
  const queryStart = nowMs()
  const result = await runAsyncWorkerPhase('flatten range', () =>
    flattenDocumentRange(cached, context, {
      range,
      includeHighlights: request.includeHighlights,
      includeCaptures: request.includeCaptures ?? true,
    }),
  )
  assertNotCancelled(context)

  return {
    documentId: request.documentId,
    snapshotVersion: request.snapshotVersion,
    languageId: request.languageId,
    range,
    captures: result.captures,
    folds: result.folds,
    brackets: result.brackets,
    errors: result.errors,
    injections: result.injections,
    degraded: result.degraded,
    tokens: result.tokens,
    tokensPacked: result.tokensPacked,
    statistics: resultStatistics(cached, result, context, range),
    timings: [
      { name: 'treeSitter.queryRange', durationMs: nowMs() - queryStart },
      ...phaseTimings(context),
    ],
  }
}

const runCancellableRequest = async <
  TRequest extends TreeSitterParseRequest | TreeSitterEditRequest,
>(
  request: TRequest,
  run: (
    context: CancellationContext,
  ) => Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined>,
): Promise<TreeSitterParseResult | TreeSitterParseAckResult | undefined> => {
  const context = createCancellationContext(request.cancellationBuffer, PARSE_BUDGET_MS)

  try {
    return await run(context)
  } catch (error) {
    if (error instanceof SyntaxRequestCancelled) return undefined
    throw error
  }
}

const parseAckResult = (
  request: Pick<
    TreeSitterParseRequest | TreeSitterEditRequest,
    'documentId' | 'languageId' | 'snapshotVersion'
  >,
  changedRanges: readonly TreeSitterSyntaxRange[],
  timings: TreeSitterParseAckResult['timings'],
  degraded: readonly TreeSitterDegradedState[] = [],
  missingLanguages: readonly string[] = [],
): TreeSitterParseAckResult => ({
  documentId: request.documentId,
  snapshotVersion: request.snapshotVersion,
  languageId: request.languageId,
  status: 'parsed',
  missingLanguages,
  changedRanges,
  degraded,
  timings,
})

const treeChangedRanges = (oldTree: Tree, newTree: Tree): TreeSitterSyntaxRange[] =>
  oldTree
    .getChangedRanges(newTree)
    .map((range) => ({ startIndex: range.startIndex, endIndex: range.endIndex }))

const createCancellationContext = (
  cancellationBuffer: SharedArrayBuffer | undefined,
  budgetMs: number,
): CancellationContext => ({
  startedAt: nowMs(),
  budgetMs,
  measurements: new Map(),
  counts: new Map(),
  flag: cancellationBuffer ? new Int32Array(cancellationBuffer) : null,
})

const incrementCount = (context: CancellationContext, name: string, value: number): void => {
  context.counts?.set(name, (context.counts.get(name) ?? 0) + value)
}

const resultStatistics = (
  document: ParsedDocument,
  result: FlattenedDocument,
  context: CancellationContext,
  range?: TreeSitterSyntaxRange,
): Readonly<Record<string, number>> => ({
  layers: document.layers.length,
  rawCaptures: context.counts?.get('rawCaptures') ?? 0,
  uniqueCaptures: context.counts?.get('uniqueCaptures') ?? 0,
  duplicateCaptures:
    (context.counts?.get('rawCaptures') ?? 0) - (context.counts?.get('uniqueCaptures') ?? 0),
  tokens: result.tokensPacked?.starts.length ?? 0,
  transferredTokenBytes:
    (result.tokensPacked?.starts.byteLength ?? 0) +
    (result.tokensPacked?.ends.byteLength ?? 0) +
    (result.tokensPacked?.styleIds.byteLength ?? 0),
  rangeStart: range?.startIndex ?? 0,
  rangeEnd: range?.endIndex ?? document.size,
})

const measurePhase = <T>(context: CancellationContext, name: string, run: () => T): T => {
  const start = nowMs()
  try {
    return run()
  } finally {
    context.measurements?.set(name, (context.measurements.get(name) ?? 0) + nowMs() - start)
  }
}

const phaseTimings = (context: CancellationContext): TreeSitterParseResult['timings'] =>
  [...(context.measurements ?? [])].map(([name, durationMs]) => ({
    name: `treeSitter.${name}`,
    durationMs,
  }))

const runWorkerPhase = <T>(phase: string, run: () => T): T => {
  try {
    return run()
  } catch (error) {
    throw workerPhaseError(phase, error)
  }
}

const runAsyncWorkerPhase = async <T>(phase: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    throw workerPhaseError(phase, error)
  }
}

const runOptionalWorkerPhase = <T>(
  phase: string,
  fallback: T,
  degraded: TreeSitterDegradedState[],
  run: () => T,
): T => {
  try {
    return run()
  } catch (error) {
    if (error instanceof SyntaxRequestCancelled) throw error

    recordOptionalWorkerPhaseFailure(phase, error, degraded, 'optional-phase-failed')
    return fallback
  }
}

const workerPhaseError = (phase: string, error: unknown): Error => {
  if (error instanceof SyntaxRequestCancelled) return error

  const message = `Tree-sitter ${phase} failed: ${createErrorMessage(error)}`
  const nextError = new Error(message)
  if (error instanceof Error) {
    nextError.name = error.name
    nextError.stack = error.stack
  }

  return nextError
}

const recordOptionalWorkerPhaseFailure = (
  phase: string,
  error: unknown,
  degraded: TreeSitterDegradedState[],
  kind: TreeSitterDegradedState['kind'],
): void => {
  const message = createErrorMessage(error)
  degraded.push({ kind, phase, message })
  console.warn(`[tree-sitter-worker] optional phase failed: ${phase}: ${message}`)
}

const parseSource = (
  parser: Parser,
  source: TreeSitterPieceTableInput,
  oldTree: Tree | null,
  context: CancellationContext,
): Tree => {
  const tree = parser.parse((index) => readTreeSitterPieceTableInput(source, index), oldTree, {
    progressCallback: () => isCancelled(context),
  })
  if (tree) return tree
  if (isCancelled(context)) throw new SyntaxRequestCancelled()
  throw new Error('Tree-sitter parse returned no tree')
}

const editReusableTree = (
  tree: Tree,
  edits: readonly TreeSitterEditRequest['inputEdits'][number][],
): Tree => {
  const reusableTree = tree.copy()
  for (const inputEdit of edits) {
    reusableTree.edit(new Edit(inputEdit))
  }

  return reusableTree
}

type ParseParsedDocumentOptions = {
  readonly documentId: string
  readonly snapshotVersion: number
  readonly languageId: TreeSitterLanguageId
  readonly source: TreeSitterPieceTableInput
  readonly rootLayer: ParsedLayer
  readonly context: CancellationContext
  readonly oldDocument: ParsedDocument | null
  readonly inputEdits: readonly TreeSitterEditRequest['inputEdits'][number][]
  // Grows as reparsed layers report their own changed ranges, so their children are found too.
  readonly injectionRanges: TreeSitterSyntaxRange[] | null
  readonly degraded: TreeSitterDegradedState[]
}

type PendingInjectionPlan = Omit<InjectionPlan, 'id' | 'key'> & {
  readonly patternIndex: number
}

type InjectionGroup = Omit<PendingInjectionPlan, 'kind' | 'patternIndex' | 'ranges'> & {
  ranges: TreeSitterRange[]
}

type ReusableLayer = {
  readonly layer: ParsedLayer
  state: 'available' | 'consumed'
}

type ParseInjectionContext = ParseParsedDocumentOptions & {
  readonly reusableLayers: ReusableLayer[]
  readonly missingLanguages: Set<string>
  readonly reservedLayerIds: Set<string>
  /** Layers already present, when a pass may find them again. */
  readonly knownLayers?: ReadonlySet<string>
}

const parseRootLayer = (
  runtime: Runtime,
  source: TreeSitterPieceTableInput,
  oldTree: Tree | null,
  context: CancellationContext,
): ParsedLayer => {
  const tree = parseSource(runtime.parser, source, oldTree, context)

  return {
    id: 'root',
    key: 'root',
    kind: 'root',
    parentId: null,
    parentLanguageId: null,
    languageId: runtime.descriptor.id,
    depth: 0,
    tree,
    ranges: [rangeForNode(tree.rootNode)],
  }
}

const parseParsedDocument = async (
  options: ParseParsedDocumentOptions,
): Promise<ParsedDocument> => {
  const reusableLayers = prepareReusableLayers(options.oldDocument, options.inputEdits)
  const context: ParseInjectionContext = {
    ...options,
    reusableLayers,
    missingLanguages: new Set(),
    reservedLayerIds: reservedLayerIds(options.rootLayer, reusableLayers),
  }

  try {
    const parsedLayers: ParsedLayer[] = []
    await appendInjectionLayers(parsedLayers, options.rootLayer, context)
    if (options.injectionRanges) {
      await appendCarriedLayers(parsedLayers, context)
      await refillCappedLayers(parsedLayers, context)
    }
    const layers = cappedLayers(orderParsedLayers(options.rootLayer, parsedLayers))

    return {
      snapshotVersion: options.snapshotVersion,
      languageId: options.languageId,
      source: options.source,
      layers,
      degraded: options.degraded,
      missingLanguages: [...context.missingLanguages],
      size: options.source.length,
      lastUsed: nextUse++,
    }
  } finally {
    disposeAvailableReusableLayers(reusableLayers)
  }
}

const prepareReusableLayers = (
  oldDocument: ParsedDocument | null,
  inputEdits: ParseParsedDocumentOptions['inputEdits'],
): ReusableLayer[] => {
  if (!oldDocument) return []

  const reusableLayers: ReusableLayer[] = []
  try {
    for (const layer of oldDocument.layers) {
      appendReusableLayer(reusableLayers, layer, inputEdits)
    }

    return reusableLayers
  } catch (error) {
    for (const reusable of reusableLayers) reusable.layer.tree.delete()
    throw error
  }
}

const appendReusableLayer = (
  reusableLayers: ReusableLayer[],
  layer: ParsedLayer,
  inputEdits: ParseParsedDocumentOptions['inputEdits'],
): void => {
  if (layer.kind === 'root') return

  const tree = editReusableTree(layer.tree, inputEdits)
  reusableLayers.push({
    // Included ranges stay in document code units; only query cursor bounds use UTF-16 bytes.
    layer: { ...layer, tree, ranges: tree.getIncludedRanges() },
    state: 'available',
  })
}

const reservedLayerIds = (
  rootLayer: ParsedLayer,
  reusableLayers: readonly ReusableLayer[],
): Set<string> => {
  const ids = new Set([rootLayer.id])
  for (const reusable of reusableLayers) ids.add(reusable.layer.id)
  return ids
}

const appendInjectionLayers = async (
  layers: ParsedLayer[],
  parent: ParsedLayer,
  options: ParseInjectionContext,
): Promise<void> => {
  const runtime = await ensureRuntime(parent.languageId)
  const plans = runOptionalWorkerPhase(
    'find injections',
    [] as InjectionPlan[],
    options.degraded,
    () =>
      measurePhase(options.context, 'injectionDiscovery', () =>
        findInjections(parent, runtime, options.source, options.context, options.injectionRanges),
      ),
  )

  for (const plan of plans) {
    if (layers.length >= MAX_INJECTION_LAYERS) break
    if (options.knownLayers?.has(layerIdentity(plan))) continue
    if (isNonProgressingInjection(plan, parent, layers, options.rootLayer)) continue
    if (!languageDescriptors.has(plan.languageId)) {
      options.missingLanguages.add(plan.languageId)
      continue
    }
    try {
      const layer = await parseInjectionLayer(plan, options)
      layers.push(layer)
      await appendInjectionLayers(layers, layer, options)
    } catch (error) {
      if (error instanceof SyntaxRequestCancelled) throw error
      recordOptionalWorkerPhaseFailure(
        'parse injection',
        error,
        options.degraded,
        'injection-failed',
      )
    }
  }
}

// A capped document never parsed the layers past the cap. Once an edit leaves room, the next ones
// are found after the last kept layer, as a full parse would find them.
const refillCappedLayers = async (
  layers: ParsedLayer[],
  options: ParseInjectionContext,
): Promise<void> => {
  const oldLayers = options.oldDocument?.layers.length ?? 0
  if (oldLayers <= MAX_INJECTION_LAYERS || layers.length >= MAX_INJECTION_LAYERS) return

  let tailStart = 0
  for (const layer of layers) tailStart = Math.max(tailStart, rangeSpan(layer.ranges).endIndex)
  await appendInjectionLayers(layers, options.rootLayer, {
    ...options,
    injectionRanges: [{ startIndex: tailStart, endIndex: options.source.length }],
    knownLayers: new Set(layers.map(layerIdentity)),
  })
}

const layerIdentity = (layer: Pick<ParsedLayer, 'languageId' | 'parentId' | 'ranges'>): string => {
  const span = rangeSpan(layer.ranges)
  return `${layer.languageId}\u0000${layer.parentId}\u0000${span.startIndex}\u0000${span.endIndex}`
}

const isNonProgressingInjection = (
  plan: InjectionPlan,
  parent: ParsedLayer,
  layers: readonly ParsedLayer[],
  root: ParsedLayer,
): boolean => {
  let ancestor: ParsedLayer | undefined = parent
  while (ancestor) {
    if (ancestor.languageId === plan.languageId && rangesEqual(ancestor.ranges, plan.ranges))
      return true
    const parentId: string | null = ancestor.parentId
    ancestor = parentId === root.id ? root : layers.find((layer) => layer.id === parentId)
  }
  return false
}

const rangesEqual = (
  left: readonly TreeSitterRange[],
  right: readonly TreeSitterRange[],
): boolean =>
  left.length === right.length &&
  left.every(
    (range, index) =>
      range.startIndex === right[index]?.startIndex && range.endIndex === right[index]?.endIndex,
  )

const parseInjectionLayer = async (
  plan: InjectionPlan,
  options: ParseInjectionContext,
): Promise<ParsedLayer> => {
  const runtime = await ensureRuntime(plan.languageId)
  const reusable = takeReusableLayer(options.reusableLayers, plan)
  const resolvedPlan = resolveInjectionPlan(plan, reusable, options)
  const oldTree = reusable?.layer.tree ?? null

  try {
    const tree = measurePhase(options.context, 'parseInjection', () =>
      parseInjectedSource(
        runtime.parser,
        options.source,
        resolvedPlan.ranges,
        oldTree,
        options.context,
      ),
    )
    recordLayerChanges(options.injectionRanges, resolvedPlan.ranges, oldTree, tree)
    return { ...resolvedPlan, tree }
  } finally {
    oldTree?.delete()
  }
}

const recordLayerChanges = (
  injectionRanges: TreeSitterSyntaxRange[] | null,
  ranges: readonly TreeSitterRange[],
  oldTree: Tree | null,
  tree: Tree,
): void => {
  if (!injectionRanges) return
  if (!oldTree) {
    injectionRanges.push(rangeSpan(ranges))
    return
  }
  appendItems(injectionRanges, enclosingRanges(treeChangedRanges(oldTree, tree), [oldTree, tree]))
}

// Changed ranges miss structure that moved without its first node changing: deleting a fence's
// opening leaves the heading it becomes as the only change, and the fence's content turns into a
// paragraph unreported. Each range grows to the smallest named node holding it in either tree.
const enclosingRanges = (
  ranges: readonly TreeSitterSyntaxRange[],
  trees: readonly Tree[],
): TreeSitterSyntaxRange[] =>
  ranges.map((range) => {
    let { startIndex, endIndex } = range
    for (const tree of trees) {
      const node = tree.rootNode.namedDescendantForIndex(range.startIndex, range.endIndex)
      if (!node) continue
      startIndex = Math.min(startIndex, node.startIndex)
      endIndex = Math.max(endIndex, node.endIndex)
    }
    return { startIndex, endIndex }
  })

/** Each edit's inserted text in the final document, widened by one unit to catch adjacency. */
const editedRanges = (
  edits: readonly TreeSitterEditRequest['inputEdits'][number][],
  length: number,
): TreeSitterSyntaxRange[] => {
  const ranges: TreeSitterSyntaxRange[] = []
  for (const edit of edits) {
    for (let index = 0; index < ranges.length; index += 1) {
      ranges[index] = rangeAfterEdit(ranges[index]!, edit)
    }
    ranges.push({ startIndex: edit.startIndex, endIndex: edit.newEndIndex })
  }
  return ranges.map((range) => ({
    startIndex: Math.max(0, range.startIndex - 1),
    endIndex: Math.min(length, range.endIndex + 1),
  }))
}

const rangeAfterEdit = (
  range: TreeSitterSyntaxRange,
  edit: TreeSitterEditRequest['inputEdits'][number],
): TreeSitterSyntaxRange => ({
  startIndex: indexAfterEdit(range.startIndex, edit, edit.startIndex),
  endIndex: indexAfterEdit(range.endIndex, edit, edit.newEndIndex),
})

const indexAfterEdit = (
  index: number,
  edit: TreeSitterEditRequest['inputEdits'][number],
  inside: number,
): number => {
  if (index <= edit.startIndex) return index
  if (index >= edit.oldEndIndex) return index + edit.newEndIndex - edit.oldEndIndex
  return inside
}

const takeReusableLayer = (
  reusableLayers: readonly ReusableLayer[],
  plan: InjectionPlan,
): ReusableLayer | null => {
  const reusable =
    reusableLayers.find((candidate) => reusableLayerOverlapsPlan(candidate, plan)) ??
    reusableLayers.find((candidate) => reusableCombinedLayerMatchesPlan(candidate, plan)) ??
    null
  if (!reusable) return null

  reusable.state = 'consumed'
  return reusable
}

const reusableLayerOverlapsPlan = (reusable: ReusableLayer, plan: InjectionPlan): boolean => {
  if (!reusableLayerMatchesPlan(reusable, plan)) return false
  return rangesOverlap(reusable.layer.ranges, plan.ranges)
}

const reusableCombinedLayerMatchesPlan = (
  reusable: ReusableLayer,
  plan: InjectionPlan,
): boolean => {
  if (plan.kind !== 'combined-injection') return false
  if (!reusableLayerMatchesPlan(reusable, plan)) return false
  return reusable.layer.key === plan.key
}

const reusableLayerMatchesPlan = (reusable: ReusableLayer, plan: InjectionPlan): boolean => {
  if (reusable.state !== 'available') return false
  if (reusable.layer.kind !== plan.kind) return false
  if (reusable.layer.languageId !== plan.languageId) return false
  return reusable.layer.parentId === plan.parentId
}

const resolveInjectionPlan = (
  plan: InjectionPlan,
  reusable: ReusableLayer | null,
  options: ParseInjectionContext,
): InjectionPlan => {
  if (!reusable) return reserveInjectionPlanIdentity(plan, options.reservedLayerIds)

  const ranges = mergedCombinedRanges(
    plan,
    reusable.layer.ranges,
    options.injectionRanges ?? [],
    options.source,
  )
  return { ...plan, id: reusable.layer.id, key: reusable.layer.key, ranges }
}

const reserveInjectionPlanIdentity = (
  plan: InjectionPlan,
  reservedIds: Set<string>,
): InjectionPlan => {
  if (!reservedIds.has(plan.id)) {
    reservedIds.add(plan.id)
    return plan
  }

  let ordinal = 1
  while (reservedIds.has(`${plan.id}:new-${ordinal}`)) ordinal += 1

  const id = `${plan.id}:new-${ordinal}`
  reservedIds.add(id)
  return { ...plan, id, key: id }
}

const mergedCombinedRanges = (
  plan: InjectionPlan,
  reusableRanges: readonly TreeSitterRange[],
  changedRanges: readonly TreeSitterSyntaxRange[],
  source: TreeSitterPieceTableInput,
): TreeSitterRange[] => {
  if (plan.kind !== 'combined-injection') return [...plan.ranges]

  const ranges = rangesWithoutBridgeNewlines(plan.ranges, source)
  const reusableContentRanges = rangesWithoutBridgeNewlines(reusableRanges, source)
  for (const range of reusableContentRanges) {
    if (rangeIntersectsChangedRanges(range, changedRanges)) continue
    appendUniqueRange(ranges, range)
  }

  return rangesWithBridgeNewlines(sortRanges(ranges), source)
}

const rangesWithoutBridgeNewlines = (
  ranges: readonly TreeSitterRange[],
  source: TreeSitterPieceTableInput,
): TreeSitterRange[] =>
  ranges.filter((range, index) => !isBridgeNewlineRange(range, ranges, index, source))

const isBridgeNewlineRange = (
  range: TreeSitterRange,
  ranges: readonly TreeSitterRange[],
  index: number,
  source: TreeSitterPieceTableInput,
): boolean => {
  const previous = ranges[index - 1]
  const next = ranges[index + 1]
  if (!previous || !next) return false
  if (range.endIndex !== range.startIndex + 1) return false
  if (range.endPosition.row !== range.startPosition.row + 1) return false
  if (range.endPosition.column !== 0) return false
  if (range.startPosition.row !== previous.endPosition.row) return false
  if (range.endIndex > next.startIndex) return false
  return readTreeSitterInputRange(source, range.startIndex, range.endIndex) === '\n'
}

const appendUniqueRange = (ranges: TreeSitterRange[], range: TreeSitterRange): void => {
  const exists = ranges.some((candidate) => {
    return candidate.startIndex === range.startIndex && candidate.endIndex === range.endIndex
  })
  if (!exists) ranges.push(range)
}

const appendCarriedLayers = async (
  layers: ParsedLayer[],
  options: ParseInjectionContext,
): Promise<void> => {
  const availableParentIds = new Set([options.rootLayer.id])
  for (const layer of layers) availableParentIds.add(layer.id)

  for (const reusable of options.reusableLayers) {
    if (reusable.state !== 'available') continue
    if (!reusable.layer.parentId) continue
    if (!availableParentIds.has(reusable.layer.parentId)) continue

    const carried = await carryReusableLayer(reusable, options)
    if (!carried) continue

    layers.push(carried)
    // Its reparse may have grown children its old tree did not have.
    const firstChild = layers.length
    await appendInjectionLayers(layers, carried, options)
    for (const layer of [carried, ...layers.slice(firstChild)]) availableParentIds.add(layer.id)
  }
}

const carryReusableLayer = async (
  reusable: ReusableLayer,
  options: ParseInjectionContext,
): Promise<ParsedLayer | null> => {
  const changedRanges = options.injectionRanges ?? []
  const layerChanged = reusable.layer.ranges.some((range) => {
    return rangeIntersectsChangedRanges(range, changedRanges)
  })
  // Reparsed, not kept: an edit before a layer still touches its first token's padding, and the
  // kept tree then differs from what a fresh parse gives. An unchanged reparse is cheap.
  if (!layerChanged) return reparseCarriedLayer(reusable, options)

  if (reusable.layer.kind !== 'combined-injection') return null
  const contentRanges = rangesWithoutBridgeNewlines(reusable.layer.ranges, options.source)
  const untouchedRanges = contentRanges.filter((range) => {
    return !rangeIntersectsChangedRanges(range, changedRanges)
  })
  if (untouchedRanges.length === 0) return null
  return reparsePartialCombinedLayer(reusable, untouchedRanges, options)
}

const reparseCarriedLayer = async (
  reusable: ReusableLayer,
  options: ParseInjectionContext,
): Promise<ParsedLayer | null> => {
  try {
    return await parseInjectionLayer(
      injectionPlanForLayer(reusable.layer, reusable.layer.ranges),
      options,
    )
  } catch (error) {
    if (error instanceof SyntaxRequestCancelled) throw error
    recordOptionalWorkerPhaseFailure('parse injection', error, options.degraded, 'injection-failed')
    return null
  }
}

const reparsePartialCombinedLayer = async (
  reusable: ReusableLayer,
  ranges: readonly TreeSitterRange[],
  options: ParseInjectionContext,
): Promise<ParsedLayer | null> => {
  const plan = injectionPlanForLayer(reusable.layer, ranges)
  try {
    return await parseInjectionLayer(plan, options)
  } catch (error) {
    if (error instanceof SyntaxRequestCancelled) throw error
    recordOptionalWorkerPhaseFailure('parse injection', error, options.degraded, 'injection-failed')
    return null
  }
}

const injectionPlanForLayer = (
  layer: ParsedLayer,
  ranges: readonly TreeSitterRange[],
): InjectionPlan => ({
  id: layer.id,
  key: layer.key,
  kind: layer.kind as InjectionPlan['kind'],
  parentId: layer.parentId ?? 'root',
  parentLanguageId: layer.parentLanguageId ?? layer.languageId,
  languageId: layer.languageId,
  depth: layer.depth,
  ranges,
})

const rangeIntersectsChangedRanges = (
  range: Pick<TreeSitterRange, 'startIndex' | 'endIndex'>,
  changedRanges: readonly TreeSitterSyntaxRange[],
): boolean =>
  changedRanges.some((changedRange) => {
    return indexesIntersectRange(range.startIndex, range.endIndex, changedRange)
  })

const orderParsedLayers = (
  rootLayer: ParsedLayer,
  injectionLayers: readonly ParsedLayer[],
): ParsedLayer[] => {
  const children = new Map<string, ParsedLayer[]>()
  for (const layer of injectionLayers) {
    if (!layer.parentId) continue
    const siblings = children.get(layer.parentId) ?? []
    siblings.push(layer)
    children.set(layer.parentId, siblings)
  }

  const ordered = [rootLayer]
  appendOrderedChildren(ordered, rootLayer.id, children)
  return ordered
}

// Carried layers join the ones found near an edit, so the cap a full parse applies in discovery
// order is applied here in the same order; the layers past it are the ones a full parse never makes.
const cappedLayers = (layers: ParsedLayer[]): ParsedLayer[] => {
  const limit = MAX_INJECTION_LAYERS + 1
  if (layers.length <= limit) return layers

  for (const layer of layers.slice(limit)) layer.tree.delete()
  return layers.slice(0, limit)
}

const appendOrderedChildren = (
  ordered: ParsedLayer[],
  parentId: string,
  children: ReadonlyMap<string, ParsedLayer[]>,
): void => {
  const childLayers = children.get(parentId)?.toSorted(compareParsedLayers) ?? []
  for (const layer of childLayers) {
    ordered.push(layer)
    appendOrderedChildren(ordered, layer.id, children)
  }
}

const compareParsedLayers = (left: ParsedLayer, right: ParsedLayer): number => {
  const leftRange = rangeSpan(left.ranges)
  const rightRange = rangeSpan(right.ranges)
  return leftRange.startIndex - rightRange.startIndex || leftRange.endIndex - rightRange.endIndex
}

const disposeAvailableReusableLayers = (reusableLayers: readonly ReusableLayer[]): void => {
  for (const reusable of reusableLayers) {
    if (reusable.state !== 'available') continue
    reusable.layer.tree.delete()
  }
}

const rangesOverlap = (
  left: readonly TreeSitterRange[],
  right: readonly TreeSitterRange[],
): boolean =>
  left.some((a) => right.some((b) => a.startIndex < b.endIndex && b.startIndex < a.endIndex))

const findInjections = (
  parent: ParsedLayer,
  runtime: Runtime,
  source: TreeSitterPieceTableInput,
  context: CancellationContext,
  changedRanges: TreeSitterSyntaxRange[] | null,
): InjectionPlan[] => {
  if (parent.depth >= MAX_INJECTION_DEPTH) return []

  const query = ensureQuery(runtime, 'injection')
  if (!query) return []

  const singles: PendingInjectionPlan[] = []
  const groups = new Map<string, InjectionGroup>()
  const seen = new Set<string>()
  if (!changedRanges) {
    const matches = query.matches(parent.tree.rootNode, queryOptions(context))
    assertNotCancelled(context)
    addUniqueInjectionMatches(parent, matches, source, singles, groups, seen)
  }

  const matchSpans: TreeSitterSyntaxRange[] = []
  for (const range of changedRanges ?? []) {
    const matches = query.matches(parent.tree.rootNode, queryOptions(context, range))
    assertNotCancelled(context)
    addUniqueInjectionMatches(parent, matches, source, singles, groups, seen)
    for (const match of matches) matchSpans.push(injectionMatchSpan(match))
  }
  // A match touched by the edit owns all of its content: an edit to a fence's language leaves the
  // content untouched, and the layer carried over from before would outlive its injection.
  if (changedRanges) appendItems(changedRanges, matchSpans)

  return singlesToPlans(singles).concat(groupsToPlans(groups, source)).sort(compareInjectionPlans)
}

const injectionMatchSpan = (match: ReturnType<Query['matches']>[number]): TreeSitterSyntaxRange => {
  let startIndex = Number.POSITIVE_INFINITY
  let endIndex = 0
  for (const capture of match.captures) {
    startIndex = Math.min(startIndex, capture.node.startIndex)
    endIndex = Math.max(endIndex, capture.node.endIndex)
  }
  return { startIndex: Number.isFinite(startIndex) ? startIndex : 0, endIndex }
}

const addUniqueInjectionMatches = (
  parent: ParsedLayer,
  matches: ReturnType<Query['matches']>,
  source: TreeSitterPieceTableInput,
  singles: PendingInjectionPlan[],
  groups: Map<string, InjectionGroup>,
  seen: Set<string>,
): void => {
  for (const match of matches) {
    const key = injectionMatchKey(match)
    if (seen.has(key)) continue

    seen.add(key)
    addInjectionMatchPlan(parent, match, source, singles, groups)
  }
}

const injectionMatchKey = (match: ReturnType<Query['matches']>[number]): string => {
  const captures = match.captures.map((capture) => {
    return `${capture.name}:${capture.node.startIndex}:${capture.node.endIndex}`
  })
  return `${match.patternIndex}:${captures.join('|')}`
}

const addInjectionMatchPlan = (
  parent: ParsedLayer,
  match: ReturnType<Query['matches']>[number],
  source: TreeSitterPieceTableInput,
  singles: PendingInjectionPlan[],
  groups: Map<string, InjectionGroup>,
): void => {
  const languageId = languageIdForInjectionMatch(match, source)
  if (!languageId) return

  const ranges = rangesForInjectionMatch(match)
  if (ranges.length === 0) return

  const basePlan = {
    parentId: parent.id,
    parentLanguageId: parent.languageId,
    languageId,
    depth: parent.depth + 1,
    ranges: sortRanges(ranges),
    patternIndex: match.patternIndex,
  }
  if (!isCombinedInjectionMatch(match)) {
    singles.push({ ...basePlan, kind: 'injection' })
    return
  }

  const key = `${parent.id}:combined-injection:${languageId}`
  const existing = groups.get(key)
  if (existing) {
    appendItems(existing.ranges, basePlan.ranges)
    return
  }

  groups.set(key, {
    parentId: basePlan.parentId,
    parentLanguageId: basePlan.parentLanguageId,
    languageId,
    depth: basePlan.depth,
    ranges: [...basePlan.ranges],
  })
}

const singlesToPlans = (singles: readonly PendingInjectionPlan[]): InjectionPlan[] => {
  const ordinals = new Map<string, number>()

  return singles.map((plan) => {
    const baseKey = `${plan.parentId}:${plan.kind}:${plan.languageId}:${plan.patternIndex}`
    const ordinal = ordinals.get(baseKey) ?? 0
    ordinals.set(baseKey, ordinal + 1)
    const key = `${baseKey}:${ordinal}`
    return {
      ...plan,
      id: key,
      key,
    }
  })
}

const groupsToPlans = (
  groups: Map<string, InjectionGroup>,
  source: TreeSitterPieceTableInput,
): InjectionPlan[] =>
  [...groups.entries()].map(([key, group]) => {
    const ranges = rangesWithBridgeNewlines(sortRanges(group.ranges), source)
    return {
      parentId: group.parentId,
      parentLanguageId: group.parentLanguageId,
      languageId: group.languageId,
      depth: group.depth,
      kind: 'combined-injection',
      ranges,
      id: key,
      key,
    }
  })

const compareInjectionPlans = (left: InjectionPlan, right: InjectionPlan): number => {
  const leftRange = rangeSpan(left.ranges)
  const rightRange = rangeSpan(right.ranges)
  return leftRange.startIndex - rightRange.startIndex || leftRange.endIndex - rightRange.endIndex
}

const queryOptions = (
  context: CancellationContext,
  range?: TreeSitterSyntaxRange,
): NonNullable<Parameters<Query['matches']>[1]> => {
  const options: NonNullable<Parameters<Query['matches']>[1]> = {
    progressCallback: () => isCancelled(context),
  }
  if (!range) return options

  return {
    ...options,
    startIndex: treeSitterQueryIndex(range.startIndex),
    endIndex: treeSitterQueryIndex(range.endIndex),
  }
}

// web-tree-sitter exposes node indexes as UTF-16 code units, but query cursor
// byte ranges still use raw UTF-16 bytes.
const treeSitterQueryIndex = (index: number): number => index * Uint16Array.BYTES_PER_ELEMENT

const collectCaptures = (
  tree: Tree | null,
  runtime: Runtime,
  context: CancellationContext,
  range?: TreeSitterSyntaxRange,
): TreeSitterCapture[] => {
  const query = ensureQuery(runtime, 'highlight')
  if (!query) return []
  const rootNode = tree?.rootNode
  if (!rootNode) return []

  const captures: TreeSitterCapture[] = []
  const seen = new Set<string>()
  if (range) {
    const queryCaptures = measurePhase(context, 'highlightQueryAndPredicates', () =>
      query.captures(rootNode, queryOptions(context, range)),
    )
    incrementCount(context, 'rawCaptures', queryCaptures.length)
    const normalizeStart = nowMs()
    assertNotCancelled(context)

    for (const capture of queryCaptures) {
      collectCapture(capture, captures, seen, runtime.descriptor.id, range)
    }

    context.measurements?.set(
      'captureNormalization',
      (context.measurements.get('captureNormalization') ?? 0) + nowMs() - normalizeStart,
    )
    incrementCount(context, 'uniqueCaptures', captures.length)
    return captures
  }

  const matches = measurePhase(context, 'highlightQueryAndPredicates', () =>
    query.matches(rootNode, queryOptions(context, range)),
  )
  assertNotCancelled(context)

  for (const match of matches) {
    incrementCount(context, 'rawCaptures', match.captures.length)
    collectMatchCaptures(match.captures, captures, seen, runtime.descriptor.id, range)
  }

  incrementCount(context, 'uniqueCaptures', captures.length)
  return captures
}

const collectFolds = (
  tree: Tree | null,
  runtime: Runtime,
  context: CancellationContext,
  range?: TreeSitterSyntaxRange,
): FoldRange[] => {
  const query = ensureQuery(runtime, 'fold')
  if (!query) return []
  const rootNode = tree?.rootNode
  if (!rootNode) return []

  const folds: FoldRange[] = []
  const seen = new Set<string>()
  const matches = measurePhase(context, 'foldQueryAndPredicates', () =>
    query.matches(rootNode, queryOptions(context, range)),
  )
  assertNotCancelled(context)

  for (const match of matches) {
    collectMatchFolds(match.captures, folds, seen, runtime.descriptor.id, range)
  }

  return folds
}

const collectMatchCaptures = (
  matchCaptures: ReturnType<Query['matches']>[number]['captures'],
  captures: TreeSitterCapture[],
  seen: Set<string>,
  languageId: TreeSitterLanguageId,
  range?: TreeSitterSyntaxRange,
): void => {
  for (const capture of matchCaptures) {
    collectCapture(capture, captures, seen, languageId, range)
  }
}

const collectCapture = (
  capture: ReturnType<Query['captures']>[number],
  captures: TreeSitterCapture[],
  seen: Set<string>,
  languageId: TreeSitterLanguageId,
  range?: TreeSitterSyntaxRange,
): void => {
  const node = capture.node
  if (!node) return

  const startIndex = node.startIndex
  const endIndex = node.endIndex
  const captureName = capture.name ?? ''
  const key = `${startIndex}:${endIndex}:${captureName}:${languageId}`
  if (seen.has(key)) return
  if (startIndex >= endIndex) return
  if (range && !indexesIntersectRange(startIndex, endIndex, range)) return

  seen.add(key)
  captures.push({ startIndex, endIndex, captureName, languageId })
}

const collectMatchFolds = (
  matchCaptures: ReturnType<Query['matches']>[number]['captures'],
  folds: FoldRange[],
  seen: Set<string>,
  languageId: TreeSitterLanguageId,
  range?: TreeSitterSyntaxRange,
): void => {
  for (const capture of matchCaptures) {
    const node = capture.node
    if (!node) continue

    const startLine = node.startPosition.row
    const endLine = node.endPosition.row
    if (endLine <= startLine) continue
    if (range && !indexesIntersectRange(node.startIndex, node.endIndex, range)) continue

    const key = `${node.startIndex}:${node.endIndex}:${node.type}:${languageId}`
    if (seen.has(key)) continue

    seen.add(key)
    folds.push({
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      startLine,
      endLine,
      type: node.type,
      languageId,
    })
  }
}

const languageIdForInjectionMatch = (
  match: ReturnType<Query['matches']>[number],
  source: TreeSitterPieceTableInput,
): TreeSitterLanguageId | null => {
  const setLanguage = propertyValue(match.setProperties, ['injection.language', 'language'])
  const languageId = resolveRegisteredLanguageAlias(setLanguage)
  if (languageId) return languageId
  if (setLanguage?.trim()) return setLanguage.trim().toLowerCase()

  const languageCapture = match.captures.find(isInjectionLanguageCapture)
  if (!languageCapture) return null

  const languageName = readTreeSitterInputRange(
    source,
    languageCapture.node.startIndex,
    languageCapture.node.endIndex,
  )
  return resolveRegisteredLanguageAlias(languageName) ?? (languageName.trim().toLowerCase() || null)
}

const rangesForInjectionMatch = (match: ReturnType<Query['matches']>[number]): TreeSitterRange[] =>
  match.captures.filter(isInjectionContentCapture).map((capture) => rangeForNode(capture.node))

const isInjectionContentCapture = (
  capture: ReturnType<Query['matches']>[number]['captures'][number],
): boolean => capture.name === 'injection.content' || capture.name === 'content'

const isInjectionLanguageCapture = (
  capture: ReturnType<Query['matches']>[number]['captures'][number],
): boolean => capture.name === 'injection.language' || capture.name === 'language'

const isCombinedInjectionMatch = (match: ReturnType<Query['matches']>[number]): boolean =>
  hasProperty(match.setProperties, 'injection.combined') ||
  hasProperty(match.setProperties, 'combined')

const propertyValue = (
  properties: Record<string, string | null> | undefined,
  names: readonly string[],
): string | null => {
  if (!properties) return null

  for (const name of names) {
    if (!hasProperty(properties, name)) continue
    return properties[name] ?? null
  }

  return null
}

const hasProperty = (
  properties: Record<string, string | null> | undefined,
  name: string,
): boolean => Boolean(properties && Object.prototype.hasOwnProperty.call(properties, name))

const resolveRegisteredLanguageAlias = (
  alias: string | null | undefined,
): TreeSitterLanguageId | null => {
  if (!alias) return null

  const normalized = alias.trim().toLowerCase()
  if (!normalized) return null

  for (let index = languageDescriptorOrder.length - 1; index >= 0; index -= 1) {
    const languageId = languageDescriptorOrder[index]!
    const descriptor = languageDescriptors.get(languageId)
    if (!descriptor) continue
    if (descriptor.id.toLowerCase() === normalized) return descriptor.id
    if (descriptor.aliases.map((item) => item.toLowerCase()).includes(normalized)) {
      return descriptor.id
    }
  }

  return null
}

const parseInjectedSource = (
  parser: Parser,
  source: TreeSitterPieceTableInput,
  ranges: readonly TreeSitterRange[],
  oldTree: Tree | null,
  context: CancellationContext,
): Tree => {
  const tree = parser.parse((index) => readInjectedInput(source, ranges, index), oldTree, {
    includedRanges: [...ranges],
    progressCallback: () => isCancelled(context),
  })
  if (tree) return tree
  if (isCancelled(context)) throw new SyntaxRequestCancelled()
  throw new Error('Tree-sitter injection parse returned no tree')
}

// A read stops at the end of the range it starts in: past it the parser jumps to the next range,
// and a batch read there would copy text the layer never sees into wasm memory.
const readInjectedInput = (
  source: TreeSitterPieceTableInput,
  ranges: readonly TreeSitterRange[],
  index: number,
): string | undefined => {
  const end = readEndForRanges(ranges, index)
  if (end === null) return undefined

  const text = readTreeSitterPieceTableInput(source, index)
  if (text === undefined || index + text.length <= end) return text
  return text.slice(0, end - index)
}

const readEndForRanges = (ranges: readonly TreeSitterRange[], index: number): number | null => {
  for (const range of ranges) {
    if (index < range.endIndex) return range.endIndex
  }
  return null
}

const packHighlights = (
  captures: readonly TreeSitterCapture[],
  includeHighlights: boolean,
  context: CancellationContext,
): PackedEditorTokens => {
  const tokens = measurePhase(context, 'overlapResolution', () =>
    includeHighlights ? treeSitterCapturesToEditorTokens(captures) : [],
  )
  return measurePhase(context, 'packing', () => packEditorTokens(tokens))
}

const flattenDocument = async (
  document: ParsedDocument,
  context: CancellationContext,
  includeHighlights: boolean,
  includeCaptures: boolean,
): Promise<FlattenedDocument> => {
  const result = createEmptyFlattenedDocument()
  appendItems(result.degraded, document.degraded)
  const queryContext = { ...context, budgetMs: QUERY_BUDGET_MS }

  for (const layer of document.layers) {
    await flattenLayer(layer, result, queryContext, includeHighlights || includeCaptures)
  }

  const captures = measurePhase(context, 'captureSorting', () => sortCaptures(result.captures))
  return {
    captures: includeCaptures ? captures : [],
    folds: sortFolds(result.folds),
    brackets: sortBrackets(result.brackets),
    errors: sortErrors(result.errors),
    injections: sortInjections(result.injections),
    degraded: result.degraded,
    tokensPacked: packHighlights(captures, includeHighlights, context),
  }
}

const flattenDocumentRange = async (
  document: ParsedDocument,
  context: CancellationContext,
  options: RangeFlattenOptions,
): Promise<FlattenedDocument> => {
  const result = createEmptyFlattenedDocument()
  appendItems(result.degraded, document.degraded)
  if (options.range.endIndex <= options.range.startIndex) return result

  for (const layer of document.layers) {
    if (!layerIntersectsSyntaxRange(layer, options.range)) continue
    await flattenLayerRange(layer, result, context, options)
  }

  const captures = measurePhase(context, 'captureSorting', () => sortCaptures(result.captures))
  return {
    captures: options.includeCaptures ? captures : [],
    folds: sortFolds(result.folds),
    brackets: sortBrackets(result.brackets),
    errors: sortErrors(result.errors),
    injections: sortInjections(result.injections),
    degraded: result.degraded,
    tokensPacked: packHighlights(captures, options.includeHighlights, context),
  }
}

/**
 * `withCaptures` covers both consumers of the highlight query: the tokens to paint, and the raw
 * captures an inline replacement provider derives markdown preview from. A caller that wants only
 * the captures still needs the query to run, so the gate is not `includeHighlights`.
 */
const flattenLayer = async (
  layer: ParsedLayer,
  result: Writable<FlattenedDocument>,
  context: CancellationContext,
  withCaptures: boolean,
): Promise<void> => {
  const runtime = await ensureRuntime(layer.languageId)
  const treeData = runOptionalWorkerPhase(
    'collect diagnostics',
    emptyTreeData(),
    result.degraded,
    () => measurePhase(context, 'structuralWalk', () => collectTreeData(layer.tree)),
  )
  if (withCaptures) {
    appendItems(
      result.captures,
      runOptionalWorkerPhase('collect highlights', [] as TreeSitterCapture[], result.degraded, () =>
        collectCaptures(layer.tree, runtime, context),
      ),
    )
  }
  appendItems(
    result.folds,
    runOptionalWorkerPhase('collect folds', [] as FoldRange[], result.degraded, () =>
      collectFolds(layer.tree, runtime, context),
    ),
  )
  appendItems(result.brackets, treeData.brackets)
  appendItems(result.errors, treeData.errors)
  if (layer.kind !== 'root') result.injections.push(injectionInfoForLayer(layer))
}

const flattenLayerRange = async (
  layer: ParsedLayer,
  result: Writable<FlattenedDocument>,
  context: CancellationContext,
  options: RangeFlattenOptions,
): Promise<void> => {
  const runtime = await ensureRuntime(layer.languageId)
  const treeData = runOptionalWorkerPhase(
    'collect range diagnostics',
    emptyTreeData(),
    result.degraded,
    () => measurePhase(context, 'structuralWalk', () => collectTreeData(layer.tree, options.range)),
  )
  if (options.includeHighlights || options.includeCaptures) {
    appendItems(
      result.captures,
      runOptionalWorkerPhase(
        'collect range highlights',
        [] as TreeSitterCapture[],
        result.degraded,
        () => collectCaptures(layer.tree, runtime, context, options.range),
      ),
    )
  }
  appendItems(
    result.folds,
    runOptionalWorkerPhase('collect range folds', [] as FoldRange[], result.degraded, () =>
      collectFolds(layer.tree, runtime, context, options.range),
    ),
  )
  appendItems(result.brackets, treeData.brackets)
  appendItems(result.errors, treeData.errors)
  if (layer.kind !== 'root') result.injections.push(injectionInfoForLayer(layer))
}

type Writable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K]
}

const injectionInfoForLayer = (layer: ParsedLayer): TreeSitterInjectionInfo => {
  const span = rangeSpan(layer.ranges)
  return {
    parentLanguageId: layer.parentLanguageId ?? layer.languageId,
    languageId: layer.languageId,
    startIndex: span.startIndex,
    endIndex: span.endIndex,
  }
}

const createEmptyFlattenedDocument = (): Writable<FlattenedDocument> => ({
  captures: [],
  folds: [],
  brackets: [],
  errors: [],
  injections: [],
  degraded: [],
  tokens: [],
})

const emptyTreeData = (): Pick<TreeSitterParseResult, 'brackets' | 'errors'> => ({
  brackets: [],
  errors: [],
})

const rangeForNode = (node: Node): TreeSitterRange => ({
  startIndex: node.startIndex,
  endIndex: node.endIndex,
  startPosition: node.startPosition,
  endPosition: node.endPosition,
})

const sortRanges = (ranges: readonly TreeSitterRange[]): TreeSitterRange[] =>
  ranges.toSorted(
    (left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex,
  )

const rangeSpan = (
  ranges: readonly TreeSitterRange[],
): Pick<TreeSitterRange, 'startIndex' | 'endIndex'> => ({
  startIndex: minRangeStartIndex(ranges),
  endIndex: maxRangeEndIndex(ranges),
})

const normalizedSyntaxRange = (
  range: TreeSitterSyntaxRange,
  documentLength: number,
): TreeSitterSyntaxRange => {
  const startIndex = Math.max(0, Math.min(range.startIndex, documentLength))
  const endIndex = Math.max(startIndex, Math.min(range.endIndex, documentLength))
  return { startIndex, endIndex }
}

const layerIntersectsSyntaxRange = (layer: ParsedLayer, range: TreeSitterSyntaxRange): boolean => {
  if (layer.kind === 'root') return true
  return layer.ranges.some((layerRange) =>
    indexesIntersectRange(layerRange.startIndex, layerRange.endIndex, range),
  )
}

const indexesIntersectRange = (
  startIndex: number,
  endIndex: number,
  range: TreeSitterSyntaxRange,
): boolean => startIndex < range.endIndex && endIndex > range.startIndex

const minRangeStartIndex = (ranges: readonly TreeSitterRange[]): number => {
  let result = Infinity
  for (const range of ranges) result = Math.min(result, range.startIndex)
  return result
}

const maxRangeEndIndex = (ranges: readonly TreeSitterRange[]): number => {
  let result = -Infinity
  for (const range of ranges) result = Math.max(result, range.endIndex)
  return result
}

const rangesWithBridgeNewlines = (
  ranges: readonly TreeSitterRange[],
  source: TreeSitterPieceTableInput,
): TreeSitterRange[] => {
  const nextRanges: TreeSitterRange[] = []
  for (const range of ranges) {
    appendBridgeNewline(nextRanges, range, source)
    nextRanges.push(range)
  }

  return nextRanges
}

const appendBridgeNewline = (
  ranges: TreeSitterRange[],
  nextRange: TreeSitterRange,
  source: TreeSitterPieceTableInput,
): void => {
  const previous = ranges[ranges.length - 1]
  if (!previous) return
  if (previous.endPosition.row >= nextRange.startPosition.row) return
  if (previous.endPosition.column === 0) return

  const bridge = bridgeNewlineRange(
    source,
    previous.endIndex,
    nextRange.startIndex,
    previous.endPosition,
  )
  if (bridge) ranges.push(bridge)
}

const bridgeNewlineRange = (
  source: TreeSitterPieceTableInput,
  startIndex: number,
  endIndex: number,
  startPosition: TreeSitterRange['startPosition'],
): TreeSitterRange | null => {
  const text = readTreeSitterInputRange(source, startIndex, endIndex)
  let row = startPosition.row
  let column = startPosition.column

  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') {
      return {
        startIndex: startIndex + index,
        endIndex: startIndex + index + 1,
        startPosition: { row, column },
        endPosition: { row: row + 1, column: 0 },
      }
    }

    column += 1
  }

  return null
}

const sortCaptures = (captures: readonly TreeSitterCapture[]): TreeSitterCapture[] =>
  captures.toSorted((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)

const sortFolds = (folds: readonly FoldRange[]): FoldRange[] =>
  folds.toSorted((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)

const sortBrackets = (brackets: readonly BracketInfo[]): BracketInfo[] =>
  brackets.toSorted((a, b) => a.index - b.index || a.depth - b.depth)

const sortErrors = (errors: readonly TreeSitterError[]): TreeSitterError[] =>
  errors.toSorted((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)

const sortInjections = (
  injections: readonly TreeSitterInjectionInfo[],
): TreeSitterInjectionInfo[] =>
  injections.toSorted((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex)

const collectTreeData = (
  tree: Tree | null,
  range?: TreeSitterSyntaxRange,
): Pick<TreeSitterParseResult, 'brackets' | 'errors'> => {
  const brackets: BracketInfo[] = []
  const errors: TreeSitterError[] = []
  const bracketStack: { char: string; index: number }[] = []
  const cursor = tree?.walk()
  if (!cursor) return emptyTreeData()

  try {
    if (range) {
      walkTreeCursorRange(cursor, range, {
        onBracket: (info) => brackets.push(info),
        onError: (info) => errors.push(info),
      })
      return { brackets, errors }
    }

    walkTreeCursor(
      cursor,
      {
        onBracket: (info) => brackets.push(info),
        onError: (info) => errors.push(info),
      },
      bracketStack,
    )
  } finally {
    cursor.delete()
  }

  return { brackets, errors }
}

const walkTreeCursorRange = (
  cursor: TreeCursor,
  range: TreeSitterSyntaxRange,
  visitors: TreeWalkVisitors,
): void => {
  const bracketStack: { char: string; index: number }[] = []

  while (true) {
    if (cursor.endIndex <= range.startIndex) {
      if (!advanceCursorPastSubtree(cursor)) return
      continue
    }
    if (cursor.startIndex >= range.endIndex) {
      if (!advanceCursorPastSubtree(cursor)) return
      continue
    }

    collectCursorDiagnostics(cursor, visitors, bracketStack)
    if (cursor.gotoFirstChild()) continue
    if (advanceCursorPastSubtree(cursor)) continue
    return
  }
}

const advanceCursorPastSubtree = (cursor: TreeCursor): boolean => {
  if (cursor.gotoNextSibling()) return true
  return advanceCursorToAncestorSibling(cursor)
}

const advanceCursorToAncestorSibling = (cursor: TreeCursor): boolean => {
  while (cursor.gotoParent()) {
    if (cursor.gotoNextSibling()) return true
  }

  return false
}

const walkTreeCursor = (
  cursor: TreeCursor,
  visitors: TreeWalkVisitors,
  bracketStack: { char: string; index: number }[],
): void => {
  while (true) {
    collectCursorDiagnostics(cursor, visitors, bracketStack)

    if (cursor.gotoFirstChild()) continue
    if (cursor.gotoNextSibling()) continue

    while (true) {
      if (!cursor.gotoParent()) return
      if (cursor.gotoNextSibling()) break
    }
  }
}

const collectCursorDiagnostics = (
  cursor: TreeCursor,
  visitors: TreeWalkVisitors,
  bracketStack: { char: string; index: number }[],
): void => {
  const bracket = collectCursorBracket(cursor, bracketStack)
  if (bracket) visitors.onBracket(bracket)

  const error = collectCursorError(cursor)
  if (error) visitors.onError(error)
}

const collectCursorBracket = (
  cursor: TreeCursor,
  bracketStack: { char: string; index: number }[],
): BracketInfo | null => collectBracketInfo(cursor.nodeType, cursor.startIndex, bracketStack)

const collectBracket = (
  node: Node,
  bracketStack: { char: string; index: number }[],
): BracketInfo | null => collectBracketInfo(node.type, node.startIndex, bracketStack)

const collectBracketInfo = (
  type: string,
  startIndex: number,
  bracketStack: { char: string; index: number }[],
): BracketInfo | null => {
  if (OPEN_BRACKETS.has(type)) {
    bracketStack.push({ char: type, index: startIndex })
    return { index: startIndex, char: type, depth: bracketStack.length }
  }

  if (!CLOSE_BRACKETS.has(type)) return null

  const depth = bracketStack.length > 0 ? bracketStack.length : 1
  const last = bracketStack[bracketStack.length - 1]
  if (last && BRACKET_PAIRS[last.char] === type) bracketStack.pop()
  return { index: startIndex, char: type, depth }
}

const collectCursorError = (cursor: TreeCursor): TreeSitterError | null => {
  const isError = cursor.nodeType === 'ERROR'
  if (!isError && !cursor.nodeIsMissing) return null

  return {
    startIndex: cursor.startIndex,
    endIndex: cursor.endIndex,
    isMissing: cursor.nodeIsMissing,
    message: cursor.nodeType,
  }
}

const collectError = (node: Node): TreeSitterError | null => {
  if (!node.isError && !node.isMissing) return null

  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    isMissing: node.isMissing,
    message: node.type,
  }
}

const selectDocument = async (
  request: TreeSitterSelectionRequest,
): Promise<TreeSitterSelectionResult> => {
  const cached = cachedDocumentForVersion(
    request.runtimeSessionId,
    request.languageId,
    request.snapshotVersion,
  )

  if (!cached) return staleSelectionResult(request)
  return {
    documentId: request.documentId,
    snapshotVersion: request.snapshotVersion,
    languageId: request.languageId,
    status: 'ok',
    ranges: request.ranges.map((range) =>
      selectionRangeForAction(layerForSelection(cached, range).tree, request.action, range),
    ),
  }
}

const selectionRangeForAction = (
  tree: Tree,
  action: TreeSitterSelectionRequest['action'],
  range: TreeSitterSelectionRange,
): TreeSitterSelectionRange => {
  if (action === 'selectToken') return tokenRangeAt(tree.rootNode, range)
  return expandedRangeAt(tree.rootNode, range)
}

const tokenRangeAt = (root: Node, range: TreeSitterSelectionRange): TreeSitterSelectionRange => {
  const index = clampSelectionIndex(root, range.startIndex)
  const node = nonEmptyNode(root.descendantForIndex(index, index), root)
  return rangeForSelectionNode(node)
}

const expandedRangeAt = (root: Node, range: TreeSitterSelectionRange): TreeSitterSelectionRange => {
  const node = root.namedDescendantForIndex(range.startIndex, range.endIndex) ?? root
  const containing = containingNamedNode(node, range)
  return rangeForSelectionNode(containing)
}

const containingNamedNode = (node: Node, range: TreeSitterSelectionRange): Node => {
  let current: Node | null = node

  while (current) {
    if (current.isNamed && strictlyContainsRange(current, range)) return current
    current = current.parent
  }

  return node.tree.rootNode
}

const nonEmptyNode = (node: Node | null, fallback: Node): Node => {
  let current = node

  while (current) {
    if (current.endIndex > current.startIndex) return current
    current = current.parent
  }

  return fallback
}

const rangeForSelectionNode = (node: Node): TreeSitterSelectionRange => ({
  startIndex: node.startIndex,
  endIndex: node.endIndex,
})

const strictlyContainsRange = (node: Node, range: TreeSitterSelectionRange): boolean => {
  if (node.startIndex > range.startIndex) return false
  if (node.endIndex < range.endIndex) return false
  return node.startIndex < range.startIndex || node.endIndex > range.endIndex
}

const clampSelectionIndex = (root: Node, index: number): number => {
  if (root.endIndex <= root.startIndex) return root.startIndex
  return Math.max(root.startIndex, Math.min(index, root.endIndex - 1))
}

const layerForSelection = (
  document: ParsedDocument,
  range: TreeSitterSelectionRange,
): ParsedLayer => {
  let best = rootLayerForDocument(document)
  for (const layer of document.layers) {
    if (!layerContainsSelection(layer, range)) continue
    if (layer.depth < best.depth) continue
    best = layer
  }

  return best
}

const layerContainsSelection = (layer: ParsedLayer, range: TreeSitterSelectionRange): boolean => {
  if (layer.kind === 'root') return true
  return layer.ranges.some((layerRange) => rangeInsideLayerRange(range, layerRange))
}

const rangeInsideLayerRange = (
  range: TreeSitterSelectionRange,
  layerRange: TreeSitterRange,
): boolean => {
  const start = Math.min(range.startIndex, range.endIndex)
  const end = Math.max(range.startIndex, range.endIndex)
  if (start < layerRange.startIndex) return false
  if (end > layerRange.endIndex) return false
  return true
}

const rootLayerForDocument = (document: ParsedDocument): ParsedLayer => {
  const root = document.layers.find((layer) => layer.kind === 'root')
  if (!root) throw new Error('Tree-sitter parsed document is missing a root layer')
  return root
}

const staleSelectionResult = (request: TreeSitterSelectionRequest): TreeSitterSelectionResult => ({
  documentId: request.documentId,
  snapshotVersion: request.snapshotVersion,
  languageId: request.languageId,
  status: 'stale',
  ranges: request.ranges,
})

const replaceCachedDocument = (documentId: string, snapshot: ParsedDocument): void => {
  const cache = ensureDocumentCache(documentId)
  const existingIndex = cache.snapshots.findIndex(
    (item) => item.snapshotVersion === snapshot.snapshotVersion,
  )

  if (existingIndex !== -1) {
    const existing = cache.snapshots.splice(existingIndex, 1, snapshot)[0]
    if (existing) disposeCachedSnapshot(existing)
  } else {
    cache.snapshots.push(snapshot)
  }

  evictCachedSnapshots(cache)
}

const ensureDocumentCache = (documentId: string): DocumentCache => {
  const existing = documentCaches.get(documentId)
  if (existing) return existing

  const cache = { documentId, snapshots: [] }
  documentCaches.set(documentId, cache)
  return cache
}

const cachedDocumentForVersion = (
  documentId: string,
  languageId: TreeSitterLanguageId,
  snapshotVersion: number,
): ParsedDocument | null => {
  const cache = documentCaches.get(documentId)
  if (!cache) return null

  const snapshot = cache.snapshots.find((item) => {
    return item.languageId === languageId && item.snapshotVersion === snapshotVersion
  })
  if (!snapshot) return null

  snapshot.lastUsed = nextUse++
  return snapshot
}

const evictCachedSnapshots = (cache: DocumentCache): void => {
  cache.snapshots.sort((left, right) => right.snapshotVersion - left.snapshotVersion)

  while (cache.snapshots.length > MAX_RETAINED_SNAPSHOTS) {
    disposeOldestRetainedSnapshot(cache.snapshots)
  }

  while (retainedSourceUnits(cache.snapshots) > MAX_RETAINED_SOURCE_UNITS) {
    if (cache.snapshots.length <= 2) return
    disposeOldestRetainedSnapshot(cache.snapshots)
  }
}

const disposeOldestRetainedSnapshot = (snapshots: ParsedDocument[]): void => {
  let oldestIndex = Math.min(2, snapshots.length - 1)

  for (let index = oldestIndex + 1; index < snapshots.length; index++) {
    if (snapshots[index]!.lastUsed >= snapshots[oldestIndex]!.lastUsed) continue
    oldestIndex = index
  }

  const [oldest] = snapshots.splice(oldestIndex, 1)
  if (oldest) disposeCachedSnapshot(oldest)
}

const retainedSourceUnits = (snapshots: readonly ParsedDocument[]): number =>
  snapshots.reduce((sum, snapshot) => sum + snapshot.size, 0)

const disposeCachedSnapshot = (snapshot: ParsedDocument): void => {
  for (const layer of snapshot.layers) layer.tree.delete()
}

const disposeDocument = (runtimeSessionId: string): void => {
  markRuntimeSessionDisposed(runtimeSessionId)
  const cache = documentCaches.get(runtimeSessionId)
  disposeTreeSitterSourceDocument(sourceCache, runtimeSessionId)
  if (!cache) return

  for (const snapshot of cache.snapshots) disposeCachedSnapshot(snapshot)
  documentCaches.delete(runtimeSessionId)
}

const markRuntimeSessionDisposed = (runtimeSessionId: string): void => {
  disposedRuntimeSessions.add(runtimeSessionId)
  if (disposedRuntimeSessions.size <= MAX_DISPOSED_RUNTIME_SESSIONS) return

  const oldest = disposedRuntimeSessions.values().next().value
  if (oldest) disposedRuntimeSessions.delete(oldest)
}

const disposeCachedSnapshotsForLanguage = (languageId: TreeSitterLanguageId): void => {
  for (const cache of documentCaches.values()) {
    disposeCachedSnapshotsMatchingLanguage(cache, languageId)
  }
}

const disposeCachedSnapshotsMatchingLanguage = (
  cache: DocumentCache,
  languageId: TreeSitterLanguageId,
): void => {
  const retained: ParsedDocument[] = []

  for (const snapshot of cache.snapshots) {
    if (snapshot.languageId !== languageId) {
      retained.push(snapshot)
      continue
    }

    disposeCachedSnapshot(snapshot)
  }

  cache.snapshots.length = 0
  appendItems(cache.snapshots, retained)
}

const disposeAll = (): void => {
  for (const cache of documentCaches.values()) {
    for (const snapshot of cache.snapshots) disposeCachedSnapshot(snapshot)
  }

  documentCaches.clear()
  clearTreeSitterSourceCache(sourceCache)
  languageDescriptors.clear()
  languageDescriptorOrder.length = 0
  for (const promise of runtimePromises.values()) {
    void promise.then(disposeRuntime).catch(() => undefined)
  }
  runtimePromises.clear()
  activeRuntimeTasks.clear()
  activeWorkerTasks.clear()
  disposedRuntimeSessions.clear()
  parserInitPromise = null
}

const disposeRuntime = (runtime: Runtime): void => {
  runtime.highlightQuery?.delete()
  runtime.foldQuery?.delete()
  runtime.injectionQuery?.delete()
  runtime.parser.delete()
}

const disposeRuntimeForLanguage = (languageId: TreeSitterLanguageId): void => {
  const runtime = runtimePromises.get(languageId)
  if (!runtime) return

  runtimePromises.delete(languageId)
  void runtime.then(disposeRuntime).catch(() => undefined)
}

const normalizeLanguageDescriptor = (
  descriptor: TreeSitterLanguageDescriptor,
): TreeSitterLanguageDescriptor => ({
  id: normalizeLanguageId(descriptor.id),
  wasmUrl: normalizeWasmUrl(descriptor.wasmUrl, descriptor.id),
  extensions: uniqueItems(descriptor.extensions.map(normalizeExtension)),
  aliases: uniqueItems(descriptor.aliases.map(normalizeAlias)),
  highlightQuerySource: descriptor.highlightQuerySource,
  foldQuerySource: descriptor.foldQuerySource,
  injectionQuerySource: descriptor.injectionQuerySource,
})

const moveLanguageToEnd = (languageId: TreeSitterLanguageId): void => {
  const index = languageDescriptorOrder.indexOf(languageId)
  if (index !== -1) languageDescriptorOrder.splice(index, 1)
  languageDescriptorOrder.push(languageId)
}

const languageDescriptorsEqual = (
  left: TreeSitterLanguageDescriptor,
  right: TreeSitterLanguageDescriptor,
): boolean =>
  left.id === right.id &&
  left.wasmUrl === right.wasmUrl &&
  sameItems(left.extensions, right.extensions) &&
  sameItems(left.aliases, right.aliases) &&
  left.highlightQuerySource === right.highlightQuerySource &&
  left.foldQuerySource === right.foldQuerySource &&
  left.injectionQuerySource === right.injectionQuerySource

const sameItems = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

const normalizeLanguageId = (languageId: string): TreeSitterLanguageId => {
  const normalized = languageId.trim()
  if (normalized) return normalized

  throw new Error('Tree-sitter language id cannot be empty')
}

const normalizeWasmUrl = (wasmUrl: string, languageId: string): string => {
  const normalized = wasmUrl.trim()
  if (normalized) return normalized

  throw new Error(`Tree-sitter language "${languageId}" is missing a wasmUrl`)
}

const normalizeExtension = (extension: string): string => {
  const normalized = extension.trim().toLowerCase()
  if (!normalized) throw new Error('Tree-sitter language extension cannot be empty')
  if (normalized.startsWith('.')) return normalized
  return `.${normalized}`
}

const normalizeAlias = (alias: string): string => {
  const normalized = alias.trim().toLowerCase()
  if (normalized) return normalized

  throw new Error('Tree-sitter language alias cannot be empty')
}

const uniqueItems = <T>(items: readonly T[]): readonly T[] => Array.from(new Set(items))

const isCancelled = (context: CancellationContext): boolean => {
  if (context.flag && Atomics.load(context.flag, 0) === 1) return true
  return nowMs() - context.startedAt > context.budgetMs
}

const assertNotCancelled = (context: CancellationContext): void => {
  if (isCancelled(context)) throw new SyntaxRequestCancelled()
}

const nowMs = (): number => globalThis.performance?.now() ?? Date.now()

const applyTextEdit = (
  text: string,
  startIndex: number,
  oldEndIndex: number,
  insertedText: string,
): string => text.slice(0, startIndex) + insertedText + text.slice(oldEndIndex)

const applyTextEdits = (
  text: string,
  edits: readonly TreeSitterEditRequest['edits'][number][],
): string => {
  let next = text
  const sorted = edits.toSorted((left, right) => right.from - left.from || right.to - left.to)

  for (const edit of sorted) {
    next = applyTextEdit(next, edit.from, edit.to, edit.text)
  }

  return next
}

const appendItems = <T>(target: T[], items: readonly T[]): void => {
  for (const item of items) target.push(item)
}

const handleRequest = async (request: TreeSitterWorkerRequest): Promise<TreeSitterWorkerResult> => {
  const { payload } = request

  if (payload.type === 'init') {
    await ensureParserRuntime()
    return undefined
  }

  if (payload.type === 'registerLanguages') {
    registerLanguages(payload.languages)
    return undefined
  }

  if (payload.type === 'parse') return parseDocument(payload, resolveRequestSource(payload))
  if (payload.type === 'edit') return editDocument(payload, resolveRequestSource(payload))
  if (payload.type === 'queryRange') return queryDocumentRange(payload)
  if (payload.type === 'selection') return selectDocument(payload)

  disposeAll()
  return undefined
}

const executeRequest = (request: TreeSitterWorkerRequest): Promise<TreeSitterWorkerResult> => {
  const { payload } = request
  if (payload.type === 'runtimeBarrier') {
    return awaitRuntimeTasks(payload.runtimeSessionId)
  }
  if (payload.type === 'idleFence') return awaitAllWorkerTasks()
  if (payload.type === 'disposeDocument') {
    markRuntimeSessionDisposed(payload.runtimeSessionId)
    return awaitRuntimeTasks(payload.runtimeSessionId).then(() => {
      disposeDocument(payload.runtimeSessionId)
      return undefined
    })
  }
  if (payload.type === 'dispose') {
    return awaitAllWorkerTasks().then(() => handleRequest(request))
  }

  const runtimeSessionId = runtimeSessionIdForRequest(payload)
  const task = handleRequest(request)
  trackWorkerTask(task)
  if (runtimeSessionId) trackRuntimeTask(runtimeSessionId, task)
  return task
}

const trackWorkerTask = (task: Promise<TreeSitterWorkerResult>): void => {
  activeWorkerTasks.add(task)
  void task.finally(() => activeWorkerTasks.delete(task)).catch(() => undefined)
}

const runtimeSessionIdForRequest = (payload: TreeSitterWorkerRequest['payload']): string | null => {
  if (!('runtimeSessionId' in payload)) return null
  return payload.runtimeSessionId
}

const trackRuntimeTask = (
  runtimeSessionId: string,
  task: Promise<TreeSitterWorkerResult>,
): void => {
  const tasks = activeRuntimeTasks.get(runtimeSessionId) ?? new Set()
  tasks.add(task)
  activeRuntimeTasks.set(runtimeSessionId, tasks)
  void task.finally(() => clearRuntimeTask(runtimeSessionId, task)).catch(() => undefined)
}

const clearRuntimeTask = (
  runtimeSessionId: string,
  task: Promise<TreeSitterWorkerResult>,
): void => {
  const tasks = activeRuntimeTasks.get(runtimeSessionId)
  if (!tasks) return

  tasks.delete(task)
  if (tasks.size === 0) activeRuntimeTasks.delete(runtimeSessionId)
}

const awaitRuntimeTasks = (runtimeSessionId: string): Promise<TreeSitterWorkerResult> => {
  const tasks = [...(activeRuntimeTasks.get(runtimeSessionId) ?? [])]
  return Promise.allSettled(tasks).then(() => undefined)
}

const awaitAllWorkerTasks = (): Promise<TreeSitterWorkerResult> =>
  Promise.allSettled(Array.from(activeWorkerTasks)).then(() => undefined)

const workerScope = globalThis as typeof globalThis & {
  readonly importScripts?: unknown
  onmessage?: (event: MessageEvent<TreeSitterWorkerRequest>) => void
  postMessage?: (response: TreeSitterWorkerResponse, transfer?: Transferable[]) => void
}

const shouldInstallWorkerHandler = (): boolean => {
  if (typeof workerScope.postMessage !== 'function') return false
  return typeof document === 'undefined'
}

if (shouldInstallWorkerHandler()) {
  workerScope.onmessage = (event: MessageEvent<TreeSitterWorkerRequest>): void => {
    const request = event.data
    void executeRequest(request)
      .then((result) => postResponse({ id: request.id, ok: true, result }))
      .catch((error) => {
        postResponse({ id: request.id, ok: false, error: createErrorMessage(error) })
      })
  }
}

export const __treeSitterWorkerInternalsForTests = {
  applyTextEdit,
  applyTextEdits,
  collectBracket,
  collectCaptures,
  collectError,
  collectTreeData,
  appendItems,
  rangeSpan,
  resolveTreeSitterSourceDescriptor,
  readTreeSitterPieceTableInput,
  replaceCachedDocument,
  reusableParsedDocument,
  disposeDocument,
}

const postResponse = (response: TreeSitterWorkerResponse): void => {
  workerScope.postMessage?.(response, responseTransfers(response))
}

function responseTransfers(response: TreeSitterWorkerResponse): Transferable[] {
  if (!response.ok) return []

  const result = response.result as { tokensPacked?: PackedEditorTokens } | undefined
  if (!result?.tokensPacked) return []

  return packedEditorTokenTransfers(result.tokensPacked)
}
