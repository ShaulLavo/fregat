import type { DiffFile, DiffGutterSide } from '@singapore-editor/diff'
import {
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
} from '@singapore-editor/core/document'
import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import {
  effectiveEditorTheme,
  resolveEditorThemeColor,
  type EditorTheme,
} from '@singapore-editor/core/rendering'
import { toEditorTokenStore, type EditorToken } from '@singapore-editor/core/syntax'
import {
  createShikiHighlighterProvider,
  createShikiWorkerOwner,
  shikiLanguageForDocument,
  type ShikiWorkerLanguageRegistration,
  type ShikiWorkerOwner,
  type ShikiWorkerOwnerSnapshot,
  type ShikiWorkerThemeRegistration,
  type VscodeThemeRegistration,
} from '@singapore-editor/core/shiki'
import { unpackEditorTokens } from '@singapore-editor/core/syntax'
import {
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerBackend,
  type TreeSitterBackend,
  type TreeSitterSyntaxProvider,
} from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'
import { TREE_SITTER_LANGUAGE_METADATA } from '@singapore-editor/tree-sitter-languages/metadata'

import { bundledThemes } from 'shiki/themes'

import { DiffSyntaxStore, type DiffSyntaxSnapshot, type HighlightingDiffView } from './diffs'
import { HIGHLIGHTING_DOCUMENT_LANGUAGES, highlightingGrammar, loadGrammar } from './languages'
import {
  resolveHighlightTheme,
  revisionName,
  workerThemeRegistration,
  type HighlightTheme,
} from './theme'

/** A language a host expects to open, by editor language id and optionally a path for inference. */
export type HighlightingLanguage = {
  readonly languageId: string
  readonly documentId?: string
}

/** Which palette documents paint with. Built-in palettes color through Tree-sitter captures. */
export type HighlightingThemeSelection =
  | { readonly format: 'editor' }
  | { readonly format: 'vscode'; readonly id: string }

export type HighlightingThemeSource = {
  readonly current: () => HighlightingThemeSelection
  /** Called when `current` may answer differently; returns an unsubscribe. */
  readonly subscribe?: (listener: () => void) => () => void
  /** The imported theme a document keeps if it asks for colors while a built-in palette is on. */
  readonly importedFallback?: () => string
}

export type HighlightingServiceOptions = {
  /** Loads an imported theme by the id a `vscode` selection names. */
  readonly resolveTheme?: (id: string) => Promise<VscodeThemeRegistration>
  /** Languages to prepare after first paint; `null` prepares Editor's default grammar set. */
  readonly preloadLanguages?: () => readonly HighlightingLanguage[] | null
  readonly shikiWorker?: () => Worker
  readonly treeSitterBackend?: () => TreeSitterBackend
}

export type HighlightOptions = {
  readonly language: string
  readonly theme?: HighlightTheme
  readonly signal?: AbortSignal
}

export type HighlightResult = {
  /** The grammar used, or `text` when the language has none. */
  readonly language: string
  readonly themeRevision: string
  /** UTF-16 offsets into exactly the submitted text. */
  readonly tokens: readonly Readonly<EditorToken>[]
  readonly foreground: string
  readonly background: string
}

/** A document backend in the shape `@singapore-editor/diff` accepts. */
export type HighlightingDocumentBackend =
  | { readonly kind: 'highlighter'; readonly provider: EditorHighlighterProvider }
  | { readonly kind: 'tree-sitter'; readonly provider: TreeSitterSyntaxProvider }

export type HighlightingServiceSnapshot = {
  readonly disposed: boolean
  readonly pendingHighlights: number
  /** Tree-sitter sessions opened for snippets and not yet disposed. */
  readonly snippetSessions: number
  readonly diffs: DiffSyntaxSnapshot
  readonly shiki: ShikiWorkerOwnerSnapshot | null
}

export interface HighlightingService {
  /** Highlights a standalone snippet off the main thread. Rejects on abort, failure or disposal. */
  highlight(text: string, options: HighlightOptions): Promise<HighlightResult>
  /** The grammar a label or language id selects, or null for plain text. */
  grammarFor(language: string): string | null
  /** Structure (folds, brackets, injections, selection) and built-in palette colors. */
  syntaxProvider(): TreeSitterSyntaxProvider
  /** Imported-theme colors for documents; one provider per theme source. */
  highlighterProvider(theme: HighlightingThemeSource): EditorHighlighterProvider
  /** Whether documents under this theme take colors from the highlighter provider. */
  usesHighlighter(theme: HighlightingThemeSource): boolean
  /** The backend documents and diffs use under this theme; one object per source and engine. */
  documentBackend(theme: HighlightingThemeSource): HighlightingDocumentBackend
  /** False when the diff is prepared, on screen, or being prepared under this theme's engine. */
  canPrepareDiff(file: DiffFile, theme: HighlightingThemeSource): boolean
  /** Parses a diff ahead of its view and keeps the result; resolves true when it kept one. */
  prepareDiff(file: DiffFile, theme: HighlightingThemeSource): Promise<boolean>
  /** Shows a diff with any kept or running preparation; disposing hands the view's parse back. */
  showDiff(
    view: HighlightingDiffView,
    file: DiffFile,
    side: DiffGutterSide,
    theme: HighlightingThemeSource,
  ): { dispose(): void }
  awaitIdle(): Promise<void>
  awaitRuntimeSessionIdle(runtimeSessionId: string): Promise<void>
  inspect(): HighlightingServiceSnapshot
  dispose(): Promise<void>
}

export class HighlightingError extends Error {
  public constructor(
    public readonly code: 'aborted' | 'disposed' | 'unavailable' | 'failed',
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = code === 'aborted' ? 'AbortError' : 'HighlightingError'
  }
}

const PLAIN_TEXT = 'text'
const DEFAULT_FOREGROUND = '#d4d4d4'
const DEFAULT_BACKGROUND = '#1e1e1e'
// The palette a plugin-free `highlight` paints with when the caller names none.
const DEFAULT_THEME_NAME = 'github-dark'
// Without a workspace census, every grammar a code workspace commonly holds, loaded behind paint.
const DEFAULT_PRELOAD_GRAMMARS = [
  'css',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'tsx',
  'typescript',
  'python',
  'rust',
  'go',
  'shellscript',
  'yaml',
  'toml',
] as const

const TREE_SITTER_ALIASES = new Map<string, string>(
  TREE_SITTER_LANGUAGE_METADATA.flatMap((language) =>
    [language.id, ...language.aliases].map((alias) => [alias.toLowerCase(), language.id] as const),
  ),
)

export function createHighlightingService(
  options: HighlightingServiceOptions = {},
): HighlightingService {
  return new EditorHighlightingService(options)
}

class EditorHighlightingService implements HighlightingService {
  private shikiOwner: ShikiWorkerOwner | null = null
  private treeSitterBackend: TreeSitterBackend | null = null
  private treeSitterProvider: TreeSitterSyntaxProvider | null = null
  private readonly highlighterProviders = new WeakMap<
    HighlightingThemeSource,
    EditorHighlighterProvider
  >()
  private readonly lastImportedTheme = new WeakMap<HighlightingThemeSource, string>()
  private readonly backends = new WeakMap<
    HighlightingThemeSource,
    Partial<Record<HighlightingDocumentBackend['kind'], HighlightingDocumentBackend>>
  >()
  private readonly sourceIds = new WeakMap<HighlightingThemeSource, number>()
  private readonly diffs = new DiffSyntaxStore()
  private defaultTheme: Promise<HighlightTheme> | null = null
  private snippetSessions = 0
  private nextSnippetId = 1
  private readonly grammars = new Map<string, Promise<readonly ShikiWorkerLanguageRegistration[]>>()
  private readonly pending = new Set<Promise<unknown>>()
  // Callers waiting on shared acquisition settle when the service goes; the acquisition itself
  // belongs to no single caller.
  private readonly lifetime = new AbortController()
  // Imported themes by id: the content revision documents were last given, and the worker name
  // that carries it, so same-id content changes reach open sessions as a theme change.
  private readonly documentThemes = new Map<string, { revision: string; name: string }>()
  // The exact registration each worker name was given, captured with its revision: resolving the
  // id again later could return newer content under an older revision's name.
  private readonly documentThemeContent = new Map<string, ShikiWorkerThemeRegistration>()
  // The latest notification per id; an acquisition that a newer one overtook publishes nothing.
  private readonly documentThemeRefreshes = new Map<string, number>()
  private disposeTask: Promise<void> | null = null

  public constructor(private readonly options: HighlightingServiceOptions) {}

  public async highlight(text: string, highlight: HighlightOptions): Promise<HighlightResult> {
    const task = this.runHighlight(text, highlight)
    this.pending.add(task)
    void task.finally(() => this.pending.delete(task)).catch(() => undefined)
    return task
  }

  public grammarFor(language: string): string | null {
    return highlightingGrammar(language)
  }

  public syntaxProvider(): TreeSitterSyntaxProvider {
    this.assertLive()
    if (this.treeSitterProvider) return this.treeSitterProvider

    const backend = this.options.treeSitterBackend?.() ?? createTreeSitterWorkerBackend()
    const provider = createTreeSitterSyntaxProvider({
      backend,
      warmLanguages: () => this.treeSitterPreload(),
    })
    for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS) {
      provider.registerLanguage(contribution, { replace: true })
    }
    this.treeSitterBackend = backend
    this.treeSitterProvider = provider
    return provider
  }

  public highlighterProvider(theme: HighlightingThemeSource): EditorHighlighterProvider {
    this.assertLive()
    const existing = this.highlighterProviders.get(theme)
    if (existing) return existing

    const provider = createShikiHighlighterProvider({
      languages: HIGHLIGHTING_DOCUMENT_LANGUAGES,
      preloadLanguages: () => this.shikiPreload(),
      onThemeChanged: theme.subscribe && ((listener) => this.onDocumentTheme(theme, listener)),
      resolveLanguage: (language) => this.grammar(language),
      resolveTheme: (name) => this.importedTheme(name),
      theme: () => this.documentThemeName(this.importedThemeId(theme)),
      workerOwner: this.shiki(),
    })
    this.highlighterProviders.set(theme, provider)
    return provider
  }

  public usesHighlighter(theme: HighlightingThemeSource): boolean {
    return theme.current().format === 'vscode'
  }

  public documentBackend(theme: HighlightingThemeSource): HighlightingDocumentBackend {
    this.assertLive()
    const kind = this.usesHighlighter(theme) ? 'highlighter' : 'tree-sitter'
    const cached = this.backends.get(theme) ?? {}
    this.backends.set(theme, cached)
    // Stable identity keeps diff sessions alive when only their colors change.
    cached[kind] ??=
      kind === 'highlighter'
        ? { kind, provider: this.highlighterProvider(theme) }
        : { kind, provider: this.syntaxProvider() }
    return cached[kind]
  }

  public canPrepareDiff(file: DiffFile, theme: HighlightingThemeSource): boolean {
    this.assertLive()
    return this.diffs.canPrepare(file, this.diffScope(theme))
  }

  public prepareDiff(file: DiffFile, theme: HighlightingThemeSource): Promise<boolean> {
    if (this.disposeTask) return Promise.reject(disposedError())
    return this.diffs.prepare(file, this.diffScope(theme), this.documentBackend(theme))
  }

  public showDiff(
    view: HighlightingDiffView,
    file: DiffFile,
    side: DiffGutterSide,
    theme: HighlightingThemeSource,
  ): { dispose(): void } {
    this.assertLive()
    return this.diffs.show(view, file, side, this.diffScope(theme))
  }

  public async awaitIdle(): Promise<void> {
    await Promise.allSettled(this.pending)
    await Promise.all([
      this.treeSitterBackend?.awaitIdleFence?.() ?? Promise.resolve(),
      this.shikiOwner?.awaitIdleFence() ?? Promise.resolve(),
    ])
  }

  public async awaitRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
    await Promise.all([
      this.treeSitterBackend?.awaitRuntimeSessionIdle?.(runtimeSessionId) ?? Promise.resolve(),
      this.shikiOwner?.awaitRuntimeSessionIdle(runtimeSessionId) ?? Promise.resolve(),
    ])
  }

  public inspect(): HighlightingServiceSnapshot {
    return {
      disposed: this.disposeTask !== null,
      pendingHighlights: this.pending.size,
      snippetSessions: this.snippetSessions,
      diffs: this.diffs.inspect(),
      shiki: this.shikiOwner?.inspect() ?? null,
    }
  }

  public dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask

    this.lifetime.abort()
    const pending = [...this.pending]
    const shiki = this.shikiOwner
    const treeSitter = this.treeSitterBackend
    this.shikiOwner = null
    this.treeSitterBackend = null
    this.treeSitterProvider = null
    this.grammars.clear()
    this.diffs.dispose()
    this.disposeTask = Promise.allSettled(pending)
      .then(() => Promise.allSettled([shiki?.dispose(), treeSitter?.dispose?.()]))
      .then(() => undefined)
    return this.disposeTask
  }

  private async runHighlight(text: string, highlight: HighlightOptions): Promise<HighlightResult> {
    const { signal } = highlight
    this.assertLive()
    throwIfAborted(signal)
    const requested = highlight.theme ?? (await this.live(this.loadDefaultTheme(), signal))
    const structure = requested.format === 'editor' ? structureLanguage(highlight.language) : null
    if (structure && requested.format === 'editor') {
      return this.highlightStructure(text, structure, requested, signal)
    }
    const theme = resolveHighlightTheme(requested)
    const grammar = highlightingGrammar(highlight.language)
    // An unknown language is documented plain text; a known grammar that fails to load is an
    // outage the caller must not cache as a result.
    const languageRegistrations = grammar
      ? await this.live(this.grammar(grammar), signal).catch((error: unknown) => {
          if (error instanceof HighlightingError) throw error
          throw new HighlightingError('failed', `The ${grammar} grammar did not load`, {
            cause: error,
          })
        })
      : []
    const lang = grammar
    this.assertLive()
    const reply = await this.live(
      this.shiki().highlight({
        text,
        lang,
        theme: theme.revision,
        languageRegistrations,
        themeRegistration: theme.registration,
      }),
      signal,
    ).catch((error: unknown) => {
      if (error instanceof HighlightingError) throw error
      throw new HighlightingError('failed', 'The highlighting worker failed', { cause: error })
    })
    this.assertLive()
    if (!reply) {
      throw new HighlightingError(
        'unavailable',
        'This environment cannot start a highlighting worker',
      )
    }

    const tokens = reply.tokensPacked ? unpackEditorTokens(reply.tokensPacked).map(freezeToken) : []
    return Object.freeze({
      language: lang ?? PLAIN_TEXT,
      themeRevision: theme.revision,
      tokens: Object.freeze(tokens),
      foreground: reply.theme?.foregroundColor ?? theme.registration.fg ?? DEFAULT_FOREGROUND,
      background: reply.theme?.backgroundColor ?? theme.registration.bg ?? DEFAULT_BACKGROUND,
    })
  }

  /**
   * A built-in palette colors through Tree-sitter captures, as its documents do: one transient
   * session, disposed however the request ends, with capture variables resolved against the palette.
   */
  private async highlightStructure(
    text: string,
    languageId: string,
    theme: Extract<HighlightTheme, { format: 'editor' }>,
    signal: AbortSignal | undefined,
  ): Promise<HighlightResult> {
    if (typeof Worker === 'undefined') {
      throw new HighlightingError('unavailable', 'This environment cannot start a syntax worker')
    }
    const palette = effectiveEditorTheme(theme.definition)
    const foreground = palette.foregroundColor ?? DEFAULT_FOREGROUND
    const snapshot = createPieceTableSnapshot(text)
    const textSnapshot = createDocumentTextSnapshot(snapshot, text)
    const session = this.syntaxProvider().createSession({
      documentId: `highlight-snippet-${this.nextSnippetId++}`,
      languageId,
      includeHighlights: true,
      textSnapshot,
      snapshot,
    })
    if (!session) throw new HighlightingError('failed', `No syntax session for ${languageId}`)

    this.snippetSessions += 1
    try {
      const result = await this.live(session.refresh(textSnapshot), signal).catch(
        (error: unknown) => {
          if (error instanceof HighlightingError) throw error
          throw new HighlightingError('failed', 'The syntax worker failed', { cause: error })
        },
      )
      this.assertLive()
      const tokens = toEditorTokenStore(result.tokens)
        .toTokens()
        .map((token) => paletteToken(token, palette, foreground))
      return Object.freeze({
        language: languageId,
        themeRevision: resolveHighlightTheme(theme).revision,
        tokens: Object.freeze(tokens),
        foreground,
        background: palette.backgroundColor ?? DEFAULT_BACKGROUND,
      })
    } finally {
      session.dispose()
      this.snippetSessions -= 1
    }
  }

  /** `task` for one caller: rejects when that caller aborts or the service is disposed. */
  private live<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    const lifetime = this.lifetime.signal
    if (lifetime.aborted) return Promise.reject(disposedError())
    return new Promise<T>((resolve, reject) => {
      const onDispose = () => reject(disposedError())
      lifetime.addEventListener('abort', onDispose, { once: true })
      abortable(task, signal)
        .then(resolve, reject)
        .finally(() => {
          lifetime.removeEventListener('abort', onDispose)
        })
    })
  }

  private loadDefaultTheme(): Promise<HighlightTheme> {
    this.defaultTheme ??= bundledThemes[DEFAULT_THEME_NAME]().then((module): HighlightTheme => ({
      format: 'vscode',
      definition: module.default as unknown as VscodeThemeRegistration,
    }))
    return this.defaultTheme
  }

  private diffScope(theme: HighlightingThemeSource): string {
    let id = this.sourceIds.get(theme)
    if (id === undefined) {
      id = this.nextSnippetId++
      this.sourceIds.set(theme, id)
    }
    return `${this.documentBackend(theme).kind}:${id}`
  }

  private shiki(): ShikiWorkerOwner {
    this.assertLive()
    if (this.shikiOwner) return this.shikiOwner

    this.shikiOwner = createShikiWorkerOwner({ workerFactory: this.options.shikiWorker })
    return this.shikiOwner
  }

  private grammar(language: string): Promise<readonly ShikiWorkerLanguageRegistration[]> {
    const existing = this.grammars.get(language)
    if (existing) return existing

    const pending = loadGrammar(language)
    this.grammars.set(language, pending)
    void pending.catch(() => this.grammars.delete(language))
    return pending
  }

  // `name` is the id, or the id's revision name after its content changed.
  private async importedTheme(name: string) {
    const captured = this.documentThemeContent.get(name)
    if (captured) return workerThemeRegistration(captured, name)

    const registration = await this.resolveImported(name)
    if (!this.documentThemes.has(name)) {
      this.documentThemes.set(name, { revision: revisionName(name, registration), name })
      this.documentThemeContent.set(name, registration)
    }
    return workerThemeRegistration(registration, name)
  }

  private async resolveImported(id: string) {
    const resolve = this.options.resolveTheme
    if (!resolve) throw new Error(`No theme resolver configured for ${id}`)

    return workerThemeRegistration(await resolve(id), id)
  }

  private documentThemeName(id: string): string {
    return this.documentThemes.get(id)?.name ?? id
  }

  /**
   * Sessions hear a theme change only after the id's current content has been read, so a
   * same-id replacement arrives under a new worker name and recolours instead of being skipped.
   */
  private onDocumentTheme(theme: HighlightingThemeSource, listener: () => void): () => void {
    return (
      theme.subscribe?.(() => {
        void this.refreshDocumentTheme(theme).then(listener, listener)
      }) ?? (() => undefined)
    )
  }

  private async refreshDocumentTheme(theme: HighlightingThemeSource): Promise<void> {
    const selection = theme.current()
    if (selection.format !== 'vscode') return

    const id = selection.id
    const refresh = (this.documentThemeRefreshes.get(id) ?? 0) + 1
    this.documentThemeRefreshes.set(id, refresh)
    const registration = await this.resolveImported(id)
    if (this.documentThemeRefreshes.get(id) !== refresh) return

    const revision = revisionName(id, registration)
    const known = this.documentThemes.get(id)
    if (known?.revision === revision) return

    const name = known ? revision : id
    this.documentThemes.set(id, { revision, name })
    this.documentThemeContent.set(name, registration)
  }

  // A document asked for colors in the instant a built-in palette replaced the imported one keeps
  // the last imported theme rather than naming one the resolver cannot load.
  private importedThemeId(theme: HighlightingThemeSource): string {
    const selection = theme.current()
    if (selection.format === 'vscode') {
      this.lastImportedTheme.set(theme, selection.id)
      return selection.id
    }
    const fallback = this.lastImportedTheme.get(theme) ?? theme.importedFallback?.()
    if (fallback) return fallback
    throw new Error('Documents requested imported-theme colors under a built-in palette')
  }

  private shikiPreload(): readonly string[] {
    const languages = this.options.preloadLanguages?.()
    if (!languages) return DEFAULT_PRELOAD_GRAMMARS

    const grammars = new Set<string>()
    for (const language of languages) {
      const grammar = shikiLanguageForDocument(
        { documentId: language.documentId ?? '', languageId: language.languageId },
        HIGHLIGHTING_DOCUMENT_LANGUAGES,
      )
      if (grammar) grammars.add(grammar)
    }
    return [...grammars]
  }

  private treeSitterPreload(): readonly string[] {
    const languages = this.options.preloadLanguages?.() ?? []
    const ids = new Set<string>()
    for (const language of languages) {
      const id = TREE_SITTER_ALIASES.get(language.languageId.toLowerCase())
      if (id) ids.add(id)
    }
    return [...ids]
  }

  private assertLive(): void {
    if (!this.disposeTask) return
    throw new HighlightingError('disposed', 'The highlighting service was disposed')
  }
}

/** The Tree-sitter language a label or alias names; languages it lacks stay with Shiki. */
function structureLanguage(language: string): string | null {
  return TREE_SITTER_ALIASES.get(language.trim().toLowerCase()) ?? null
}

function paletteToken(
  token: EditorToken,
  palette: EditorTheme,
  foreground: string,
): Readonly<EditorToken> {
  const style = { ...token.style }
  if (style.color) style.color = resolveEditorThemeColor(style.color, palette) ?? foreground
  if (style.backgroundColor) {
    const background = resolveEditorThemeColor(style.backgroundColor, palette)
    if (background) style.backgroundColor = background
    else delete style.backgroundColor
  }
  return Object.freeze({ start: token.start, end: token.end, style: Object.freeze(style) })
}

function freezeToken(token: EditorToken): Readonly<EditorToken> {
  return Object.freeze({ ...token, style: Object.freeze({ ...token.style }) })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new HighlightingError('aborted', 'Highlight aborted', { cause: signal.reason })
}

function disposedError(): HighlightingError {
  return new HighlightingError('disposed', 'The highlighting service was disposed')
}

// Abort settles the caller now; the shared work it was waiting on runs on for other callers.
function abortable<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return task
  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new HighlightingError('aborted', 'Highlight aborted', { cause: signal.reason }))
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
