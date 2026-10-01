import type { DocumentTextSnapshot } from '@singapore-editor/core/document'
import type {
  EditorHighlighterProvider,
  EditorHighlighterSession,
} from '@singapore-editor/core/extensions'
import {
  createEmptySyntaxResult,
  createSnippetDocument,
  createSyntaxLanguageConfiguration,
  createSyntaxSnapshotTag,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
  type EditorSyntaxServiceRequest,
  type EditorSyntaxSessionOptions,
  type EditorToken,
  type EditorTokenInput,
  type EditorTokenStore,
  toEditorTokenStore,
} from '@singapore-editor/core/syntax'
import { EditorSecondaryViewScheduler } from '@singapore-editor/core/secondary-views'
import { languageIdForPath } from './lines'
import type { DiffFile, DiffRenderRow, DiffSyntaxBackend } from './types'

type DiffSyntaxSide = 'old' | 'new' | 'stacked'
type DiffSyntaxSourceSide = 'old' | 'new'
type DiffSnippetLines = Parameters<typeof createSnippetDocument>[1]

let nextSyntaxControllerId = 0

type DiffSyntaxTokenSource = {
  readonly lineStarts: readonly number[]
  readonly side: DiffSyntaxSourceSide
  readonly tokens: EditorTokenInput
}

export type ProjectDiffSyntaxTokensOptions = {
  readonly rows: readonly DiffRenderRow[]
  readonly side: DiffSyntaxSide
  readonly sources: readonly DiffSyntaxTokenSource[]
}

export type DiffSyntaxControllerOptions = {
  readonly side: DiffSyntaxSide
  readonly backend?: DiffSyntaxBackend
  readonly enabled?: boolean
  /** Fires when a *newly parsed* token stream lands; row-driven re-projection is synchronous. */
  readonly onDidChangeTokens: () => void
}

/** Streams from `prepareDiffSyntax`, or a preparation of them still running. */
export type PreparedDiffSyntaxInput =
  | readonly PreparedDiffSyntaxSource[]
  | Promise<readonly PreparedDiffSyntaxSource[]>

export type PrepareDiffSyntaxOptions = {
  readonly backend?: DiffSyntaxBackend
  /** Which pane the sources are for. `stacked` prepares both source sides. */
  readonly side?: DiffSyntaxSide
  readonly signal?: AbortSignal
}

/**
 * One source side's parsed token stream and the session that recolours it on a theme change.
 * Exactly one holder owns it at a time — a host's store, or the controller that adopted it — and
 * that holder disposes it.
 */
export class PreparedDiffSyntaxSource {
  private readonly listeners = new Set<() => void>()
  private readonly disposables: { dispose(): void }[] = []
  private current: EditorTokenStore = toEditorTokenStore([])
  private disposed = false

  constructor(
    readonly side: DiffSyntaxSourceSide,
    readonly lineStarts: readonly number[],
  ) {}

  get tokens(): EditorTokenStore {
    return this.current
  }

  /** Fires when a theme change recolours the stream. */
  onDidChangeTokens(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.listeners.clear()
    disposeMutableSessions(this.disposables)
  }

  /** @internal */
  own(disposable: { dispose(): void }): void {
    this.disposables.push(disposable)
  }

  /** @internal */
  setTokens(tokens: EditorTokenInput): void {
    this.current = toEditorTokenStore(tokens)
  }

  /** @internal */
  async recolor(session: DiffSyntaxServiceSession): Promise<void> {
    try {
      const result = await session.refresh()
      if (this.disposed) return

      this.setTokens(result.tokens)
      for (const listener of this.listeners) listener()
    } catch {
      // Keep the last colors if the worker fails; a subsequent change can retry.
    }
  }
}

/**
 * Parses a diff's sources ahead of the view that will show them, so `setFile(file, rows, prepared)`
 * paints coloured on its first frame. The caller owns the result; an aborted preparation resolves
 * empty.
 */
export async function prepareDiffSyntax(
  file: DiffFile,
  options: PrepareDiffSyntaxOptions = {},
): Promise<readonly PreparedDiffSyntaxSource[]> {
  const created: PreparedDiffSyntaxSource[] = []
  const isCurrent = () => options.signal?.aborted !== true
  try {
    const sources = await loadSyntaxSources(
      file,
      options.side ?? 'stacked',
      options.backend,
      isCurrent,
      created,
    )
    if (sources) return sources
  } catch (error) {
    disposeMutableSessions(created)
    throw error
  }

  disposeMutableSessions(created)
  return []
}

/**
 * The syntax half of the old `DiffView`, with one behavioural change.
 *
 * `DiffView` re-ran the whole pipeline — new sessions, new parse — on every row change, including
 * every expansion toggle (`updatePaneRows` → `refreshSyntaxHighlighting`, DiffView.ts:564). The
 * parse result does not depend on which regions are expanded: the sources are the two *full files*,
 * and expansion only changes which of their lines the projection shows. So the per-side token
 * streams are cached against the file and re-projected synchronously when rows change, which is
 * what lets a toggle repaint without an uncoloured frame (§C10).
 */
export class DiffSyntaxController {
  private readonly scheduler = new EditorSecondaryViewScheduler()
  private readonly key = `diff.syntax.${nextSyntaxControllerId++}`
  private sources: readonly PreparedDiffSyntaxSource[] = []
  private sourceSubscriptions: (() => void)[] = []
  private indexed: readonly IndexedTokenSource[] = []
  private sourcesFile: DiffFile | null = null
  private file: DiffFile | null = null
  private rows: readonly DiffRenderRow[] = []
  private tokens: readonly EditorToken[] = []
  private disposed = false
  private ready = true

  constructor(private readonly options: DiffSyntaxControllerOptions) {}

  /** A disposed controller is terminal — its scheduler never runs another task. */
  isDisposed(): boolean {
    return this.disposed
  }

  isReady(): boolean {
    return this.ready
  }

  getTokens(): readonly EditorToken[] {
    return this.tokens
  }

  /**
   * New file: drop the cached streams, then adopt `prepared` when it covers this side, or reparse.
   * A preparation still running is awaited instead of parsing the same file twice. Takes ownership
   * of `prepared` either way.
   */
  setFile(
    file: DiffFile | null,
    rows: readonly DiffRenderRow[],
    prepared: PreparedDiffSyntaxInput = [],
  ): void {
    this.file = file
    this.ready = !file || this.options.enabled === false
    this.rows = rows
    this.tokens = []
    this.disposeSources()
    this.scheduler.cancel(this.key)
    if (!file || this.ready) {
      void Promise.resolve(prepared).then(disposePrepared, () => undefined)
      return
    }
    if (isPromiseLike(prepared)) {
      const settle = (sources: readonly PreparedDiffSyntaxSource[]) => {
        if (this.settlePrepared(file, sources)) this.options.onDidChangeTokens()
      }
      void prepared.then(settle, () => settle([]))
      return
    }
    this.settlePrepared(file, prepared)
  }

  /** Whether `prepared` was adopted; otherwise it is disposed, and a current file reparses. */
  private settlePrepared(file: DiffFile, prepared: readonly PreparedDiffSyntaxSource[]): boolean {
    if (this.disposed || this.file !== file || this.ready) {
      disposePrepared(prepared)
      return false
    }
    if (!coversSide(prepared, this.options.side)) {
      disposePrepared(prepared)
      this.load(file)
      return false
    }

    this.adoptSources(file, prepared)
    return true
  }

  /** Same file, different rows — an expansion toggle. Re-project what is already parsed. */
  setRows(rows: readonly DiffRenderRow[]): void {
    this.rows = rows
    this.reproject()
  }

  /**
   * Hands the parsed streams of the current file to the caller, which then owns them; empty while
   * a parse is still running. The controller keeps projecting their current tokens, and stops
   * following their recolouring.
   */
  release(): readonly PreparedDiffSyntaxSource[] {
    if (!this.ready || this.sourcesFile !== this.file) return []

    const sources = this.sources
    this.unsubscribeSources()
    this.sources = []
    return sources
  }

  dispose(): void {
    this.disposed = true
    this.scheduler.cancel(this.key)
    this.scheduler.dispose()
    this.disposeSources()
    this.tokens = []
  }

  private reproject(): void {
    if (this.indexed.length === 0 || this.sourcesFile !== this.file) {
      this.tokens = []
      return
    }

    this.tokens = projectIndexedTokens(this.rows, this.options.side, this.indexed)
  }

  private load(file: DiffFile): void {
    if (this.options.enabled === false) return

    const created: PreparedDiffSyntaxSource[] = []
    this.scheduler.schedule({
      key: this.key,
      taskClass: 'background-derived',
      priority: 'low',
      tags: { configuration: 'syntax', viewport: this.options.side },
      run: (context) =>
        loadSyntaxSources(
          file,
          this.options.side,
          this.options.backend,
          () => context.isCurrent(),
          created,
        ),
      apply: (sources) => this.applySources(file, sources, created),
      fail: () => {
        disposeMutableSessions(created)
        if (this.file !== file) return
        this.ready = true
        this.options.onDidChangeTokens()
      },
      cancel: () => disposeMutableSessions(created),
    })
  }

  private applySources(
    file: DiffFile,
    sources: readonly PreparedDiffSyntaxSource[] | null,
    created: PreparedDiffSyntaxSource[],
  ): void {
    if (this.file !== file) {
      disposeMutableSessions(created)
      return
    }

    // Adopted: the task's cancel path must no longer reach them.
    created.length = 0
    this.adoptSources(file, sources ?? [])
    this.options.onDidChangeTokens()
  }

  private adoptSources(file: DiffFile, sources: readonly PreparedDiffSyntaxSource[]): void {
    this.disposeSources()
    this.sources = sources
    this.sourceSubscriptions = sources.map((source) =>
      source.onDidChangeTokens(() => this.recolor(file)),
    )
    // Indexed here, once per parse. The index depends only on the token streams, and expansion
    // does not change those — so rebuilding it inside every re-projection would be repeated work
    // plus a fresh Map and N arrays of garbage on each toggle.
    this.indexed = indexPreparedSources(sources)
    this.ready = true
    this.sourcesFile = file
    this.reproject()
  }

  private recolor(file: DiffFile): void {
    if (this.disposed || this.file !== file) return

    this.indexed = indexPreparedSources(this.sources)
    this.reproject()
    this.options.onDidChangeTokens()
  }

  private unsubscribeSources(): void {
    for (const unsubscribe of this.sourceSubscriptions) unsubscribe()
    this.sourceSubscriptions = []
  }

  private disposeSources(): void {
    this.unsubscribeSources()
    disposeMutableSessions([...this.sources])
    this.sources = []
    this.indexed = []
    this.sourcesFile = null
  }
}

async function loadSyntaxSources(
  file: DiffFile,
  side: DiffSyntaxSide,
  backend: DiffSyntaxBackend | undefined,
  isCurrent: () => boolean,
  created: PreparedDiffSyntaxSource[],
): Promise<readonly PreparedDiffSyntaxSource[] | null> {
  const service = diffSyntaxService(diffSyntaxBackend(backend))
  if (!service) return null

  // A task cancelled mid-load has already run its cancel callback, so a stale load disposes
  // whatever it created itself: nothing else will.
  const stale = () => {
    disposeMutableSessions(created)
    return null
  }
  const sources: PreparedDiffSyntaxSource[] = []
  for (const document of syntaxDocumentsForFile(file, side, service.lines)) {
    if (!isCurrent()) return stale()

    const session = await service.createSession(document)
    if (!session) continue

    const source = new PreparedDiffSyntaxSource(document.side, document.lineStarts)
    created.push(source)
    source.own(session)
    if (!isCurrent()) return stale()
    const unsubscribe = session.onDidChangeTheme?.(() => void source.recolor(session))
    if (unsubscribe) source.own({ dispose: unsubscribe })
    const result = await session.refresh()
    if (!isCurrent()) return stale()

    source.setTokens(result.tokens)
    sources.push(source)
  }

  return sources
}

function disposePrepared(sources: readonly PreparedDiffSyntaxSource[]): void {
  for (const source of sources) source.dispose()
}

function isPromiseLike(
  value: PreparedDiffSyntaxInput,
): value is Promise<readonly PreparedDiffSyntaxSource[]> {
  return 'then' in value
}

function coversSide(sources: readonly PreparedDiffSyntaxSource[], side: DiffSyntaxSide): boolean {
  const sides = new Set(sources.map((source) => source.side))
  if (side === 'stacked') return sides.size === 2 && sources.length === 2
  return sides.has(side) && sources.length === 1
}

function indexPreparedSources(
  sources: readonly PreparedDiffSyntaxSource[],
): readonly IndexedTokenSource[] {
  return sources.map((source) => ({
    lineStarts: source.lineStarts,
    side: source.side,
    tokens: source.tokens,
  }))
}

export function diffSyntaxBackend(backend: DiffSyntaxBackend | undefined): DiffSyntaxBackend {
  return backend ?? { kind: 'tree-sitter' }
}

export function projectDiffSyntaxTokens({
  rows,
  side,
  sources,
}: ProjectDiffSyntaxTokensOptions): readonly EditorToken[] {
  return projectIndexedTokens(rows, side, indexTokenSources(sources))
}

function projectIndexedTokens(
  rows: readonly DiffRenderRow[],
  side: DiffSyntaxSide,
  sources: readonly IndexedTokenSource[],
): readonly EditorToken[] {
  const projectedTokens: EditorToken[] = []
  let rowOffset = 0

  for (const row of rows) {
    const source = tokenSourceForRow(sources, row, side)
    if (source) {
      appendRowSyntaxTokens(projectedTokens, {
        lineStarts: source.lineStarts,
        row,
        rowOffset,
        side: source.side,
        tokens: source.tokens,
      })
    }
    rowOffset += row.text.length + 1
  }

  return projectedTokens
}

type DiffSyntaxSource = {
  readonly lineStarts: readonly number[]
  readonly side: DiffSyntaxSourceSide
  readonly text: string
}

type DiffSyntaxDocument = DiffSyntaxSource & {
  readonly documentId: string
  readonly languageId: string | null
  readonly request: EditorSyntaxServiceRequest
  readonly snippet: ReturnType<typeof createSnippetDocument>
  readonly textSnapshot: DocumentTextSnapshot
}

type DiffSyntaxService = {
  /** The line model its engine parses with; tokens come back as offsets into the source text. */
  readonly lines: DiffSnippetLines
  createSession(document: DiffSyntaxDocument): Promise<DiffSyntaxServiceSession | null>
}

type DiffSyntaxServiceSession = {
  onDidChangeTheme?: EditorHighlighterSession['onDidChangeTheme']
  refresh(): Promise<EditorSyntaxResult>
  dispose(): void
}

function diffSyntaxService(backend: DiffSyntaxBackend): DiffSyntaxService | null {
  if (backend.kind === 'tree-sitter') return treeSitterDiffSyntaxService(backend.provider ?? null)
  return highlighterDiffSyntaxService(backend.provider ?? null)
}

function highlighterDiffSyntaxService(
  provider: EditorHighlighterProvider | null,
): DiffSyntaxService | null {
  if (!provider) return null

  return {
    lines: 'as-submitted',
    createSession: async (document) => highlighterDiffSyntaxSession(provider, document),
  }
}

function highlighterDiffSyntaxSession(
  provider: EditorHighlighterProvider,
  document: DiffSyntaxDocument,
): DiffSyntaxServiceSession | null {
  const session = provider.createSession(highlighterSessionOptions(document))
  if (!session) return null

  return tokenHighlighterDiffSyntaxSession(document, session)
}

function treeSitterDiffSyntaxService(
  provider: EditorSyntaxProvider | null,
): DiffSyntaxService | null {
  if (!provider) return null

  return {
    lines: 'as-document',
    createSession: async (document) => treeSitterDiffSyntaxSession(provider, document),
  }
}

function treeSitterDiffSyntaxSession(
  provider: EditorSyntaxProvider,
  document: DiffSyntaxDocument,
): DiffSyntaxServiceSession | null {
  const session = provider.createSession(syntaxSessionOptions(document))
  if (!session) return null

  return {
    dispose: () => session.dispose(),
    refresh: async () => {
      const result = await session.refresh(document.textSnapshot)
      return { ...result, tokens: document.snippet.submittedTokens(result.tokens) }
    },
  }
}

function tokenHighlighterDiffSyntaxSession(
  document: DiffSyntaxDocument,
  session: EditorHighlighterSession,
): DiffSyntaxServiceSession {
  return {
    onDidChangeTheme: session.onDidChangeTheme,
    dispose: () => session.dispose(),
    refresh: async () => {
      const result = await session.refresh(document.textSnapshot)
      return syntaxResultFromTokens(document.request, result.tokens)
    },
  }
}

function syntaxSessionOptions(document: DiffSyntaxDocument): EditorSyntaxSessionOptions {
  return {
    documentId: document.documentId,
    includeCaptures: document.request.language.includeCaptures,
    includeHighlights: document.request.language.includeHighlights,
    languageId: document.languageId,
    snapshot: document.request.snapshot,
    syntaxMode: document.request.language.mode === 'range' ? 'range' : 'full',
    textSnapshot: document.textSnapshot,
  }
}

function highlighterSessionOptions(
  document: DiffSyntaxDocument,
): Omit<EditorSyntaxSessionOptions, 'includeCaptures' | 'includeHighlights' | 'syntaxMode'> {
  return {
    documentId: document.documentId,
    languageId: document.languageId,
    snapshot: document.request.snapshot,
    textSnapshot: document.textSnapshot,
  }
}

function syntaxResultFromTokens(
  request: EditorSyntaxServiceRequest,
  tokens: EditorTokenInput,
): EditorSyntaxResult {
  return {
    ...createEmptySyntaxResult({
      language: request.language,
      requestedRanges: request.requestedRanges,
      snapshot: request.snapshotTag,
    }),
    tokens,
  }
}

/**
 * The two full files, parsed whole.
 *
 * This is the language the diff is highlighted in, and §C11 is the reason it lives here rather than
 * on the editor: the editor's own document is the *interleaved* buffer, and giving that a language
 * feeds a garbage parse into folds, brackets and injections.
 */
function syntaxDocumentsForFile(
  file: DiffFile,
  side: DiffSyntaxSide,
  lines: DiffSnippetLines,
): readonly DiffSyntaxDocument[] {
  return syntaxSourcesForSide(file, side).map((source) => syntaxDocument(file, source, lines))
}

function syntaxSourcesForSide(file: DiffFile, side: DiffSyntaxSide): readonly DiffSyntaxSource[] {
  if (side === 'stacked') {
    return [syntaxSource(file.oldLines, 'old'), syntaxSource(file.newLines, 'new')]
  }

  return [syntaxSource(side === 'old' ? file.oldLines : file.newLines, side)]
}

function syntaxSource(lines: readonly string[], side: DiffSyntaxSourceSide): DiffSyntaxSource {
  const text = lines.join('\n')
  return {
    lineStarts: lineStartsForLines(lines),
    side,
    text,
  }
}

function syntaxDocument(
  file: DiffFile,
  source: DiffSyntaxSource,
  lines: DiffSnippetLines,
): DiffSyntaxDocument {
  const snippet = createSnippetDocument(source.text, lines)
  const { snapshot, textSnapshot } = snippet
  const documentId = `${file.path}#diff-${source.side}`
  const languageId = diffSyntaxLanguageId(file)
  const request: EditorSyntaxServiceRequest = {
    editSummary: null,
    language: createSyntaxLanguageConfiguration({
      includeCaptures: true,
      includeHighlights: true,
      languageId,
      mode: 'full',
    }),
    requestedRanges: [{ startIndex: 0, endIndex: snapshot.length }],
    snapshot,
    snapshotTag: createSyntaxSnapshotTag({
      documentId,
      length: snapshot.length,
      version: 0,
    }),
    textSnapshot,
  }
  return { ...source, documentId, languageId, request, snippet, textSnapshot }
}

function diffSyntaxLanguageId(file: DiffFile): string | null {
  return file.languageId ?? languageIdForPath(file.path)
}

type IndexedTokenSource = {
  readonly lineStarts: readonly number[]
  readonly side: DiffSyntaxSourceSide
  readonly tokens: EditorTokenStore
}

/**
 * A row reads its line's tokens by bisection, and rows do not visit source lines in order once
 * expanded regions interleave. The store is sorted whichever producer made the tokens.
 */
function indexTokenSources(
  sources: readonly DiffSyntaxTokenSource[],
): readonly IndexedTokenSource[] {
  return sources.map((source) => ({
    lineStarts: source.lineStarts,
    side: source.side,
    tokens: toEditorTokenStore(source.tokens),
  }))
}

function tokenSourceForRow(
  sources: readonly IndexedTokenSource[],
  row: DiffRenderRow,
  side: DiffSyntaxSide,
): IndexedTokenSource | null {
  const sourceSide = sourceSideForRow(row, side)
  return sources.find((source) => source.side === sourceSide) ?? null
}

function appendRowSyntaxTokens(
  projectedTokens: EditorToken[],
  {
    lineStarts,
    row,
    rowOffset,
    side,
    tokens,
  }: {
    readonly lineStarts: readonly number[]
    readonly row: DiffRenderRow
    readonly rowOffset: number
    readonly side: DiffSyntaxSourceSide
    readonly tokens: EditorTokenStore
  },
): void {
  const lineNumber = sourceLineNumberForRow(row, side)
  if (lineNumber === undefined) return

  const lineStart = lineStarts[lineNumber - 1]
  const nextLineStart = lineStarts[lineNumber]
  if (lineStart === undefined) return

  const lineEnd = Math.min(
    nextLineStart === undefined ? Number.POSITIVE_INFINITY : nextLineStart - 1,
    lineStart + row.text.length,
  )

  const last = tokens.firstStartingAtOrAfter(lineEnd)
  tokens.forEachInRange(tokens.firstEndingAfter(lineStart, last), last, (start, end, styleId) => {
    const token = { start, end, style: tokens.styles[styleId]! }
    appendProjectedToken(projectedTokens, token, lineStart, lineEnd, rowOffset)
  })
}

function appendProjectedToken(
  projectedTokens: EditorToken[],
  token: EditorToken,
  lineStart: number,
  lineEnd: number,
  rowOffset: number,
): void {
  if (token.end <= lineStart) return
  if (token.start >= lineEnd) return

  const start = Math.max(token.start, lineStart)
  const end = Math.min(token.end, lineEnd)
  if (end <= start) return

  projectedTokens.push({
    end: rowOffset + end - lineStart,
    start: rowOffset + start - lineStart,
    style: token.style,
  })
}

function sourceLineNumberForRow(
  row: DiffRenderRow,
  side: DiffSyntaxSourceSide,
): number | undefined {
  if (side === 'old') return row.oldLineNumber
  return row.newLineNumber
}

function sourceSideForRow(row: DiffRenderRow, side: DiffSyntaxSide): DiffSyntaxSourceSide {
  if (side === 'old' || side === 'new') return side
  if (row.type === 'deletion') return 'old'

  return 'new'
}

function lineStartsForLines(lines: readonly string[]): readonly number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}

function disposeMutableSessions(sessions: { dispose(): void }[]): void {
  while (sessions.length > 0) sessions.pop()?.dispose()
}
