import type { EditorHighlighterProvider } from '@singapore-editor/core/extensions'
import type { EditorToken } from '@singapore-editor/core/syntax'
import {
  createShikiHighlighterProvider,
  createShikiWorkerOwner,
  shikiLanguageForDocument,
  type ShikiWorkerLanguageRegistration,
  type ShikiWorkerOwner,
  type ShikiWorkerOwnerSnapshot,
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

import { HIGHLIGHTING_DOCUMENT_LANGUAGES, highlightingGrammar, loadGrammar } from './languages'
import { resolveHighlightTheme, workerThemeRegistration, type HighlightTheme } from './theme'

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
  documentBackend(theme: HighlightingThemeSource): HighlightingDocumentBackend
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
  private readonly grammars = new Map<string, Promise<readonly ShikiWorkerLanguageRegistration[]>>()
  private readonly pending = new Set<Promise<unknown>>()
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
      onThemeChanged: theme.subscribe,
      resolveLanguage: (language) => this.grammar(language),
      resolveTheme: (id) => this.importedTheme(id),
      theme: () => this.importedThemeId(theme),
      workerOwner: this.shiki(),
    })
    this.highlighterProviders.set(theme, provider)
    return provider
  }

  public usesHighlighter(theme: HighlightingThemeSource): boolean {
    return theme.current().format === 'vscode'
  }

  public documentBackend(theme: HighlightingThemeSource): HighlightingDocumentBackend {
    if (this.usesHighlighter(theme)) {
      return { kind: 'highlighter', provider: this.highlighterProvider(theme) }
    }
    return { kind: 'tree-sitter', provider: this.syntaxProvider() }
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
      shiki: this.shikiOwner?.inspect() ?? null,
    }
  }

  public dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask

    const shiki = this.shikiOwner
    const treeSitter = this.treeSitterBackend
    this.shikiOwner = null
    this.treeSitterBackend = null
    this.treeSitterProvider = null
    this.grammars.clear()
    this.disposeTask = Promise.allSettled([shiki?.dispose(), treeSitter?.dispose?.()]).then(
      () => undefined,
    )
    return this.disposeTask
  }

  private async runHighlight(text: string, highlight: HighlightOptions): Promise<HighlightResult> {
    const { signal } = highlight
    this.assertLive()
    throwIfAborted(signal)
    const theme = resolveHighlightTheme(highlight.theme)
    const grammar = highlightingGrammar(highlight.language)
    const languageRegistrations = grammar
      ? await abortable(this.grammar(grammar), signal).catch((error: unknown) => {
          if (isAbort(error)) throw error
          return null
        })
      : []
    // A grammar that cannot load renders as documented plain text, not as an error.
    const lang = languageRegistrations ? grammar : null
    this.assertLive()
    const reply = await abortable(
      this.shiki().highlight({
        text,
        lang,
        theme: theme.revision,
        languageRegistrations: languageRegistrations ?? [],
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

  private async importedTheme(id: string) {
    const resolve = this.options.resolveTheme
    if (!resolve) throw new Error(`No theme resolver configured for ${id}`)

    return workerThemeRegistration(await resolve(id), id)
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

function freezeToken(token: EditorToken): Readonly<EditorToken> {
  return Object.freeze({ ...token, style: Object.freeze({ ...token.style }) })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new HighlightingError('aborted', 'Highlight aborted', { cause: signal.reason })
}

function isAbort(error: unknown): boolean {
  return error instanceof HighlightingError && error.code === 'aborted'
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
