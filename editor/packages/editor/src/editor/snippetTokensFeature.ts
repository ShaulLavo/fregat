import { createEditorCapabilityToken, type EditorPluginHost } from '../plugins'
import { type EditorDisposable } from './disposables'
import {
  type EditorHighlighterProvider,
  type EditorHighlighterSession,
  type EditorHighlighterSessionOptions,
} from '../syntax/highlighter'
import { createSnippetDocument, type SnippetDocument } from '../syntax/snippetDocument'
import type {
  EditorSyntaxLanguageId,
  EditorSyntaxProvider,
  EditorSyntaxSession,
  EditorSyntaxSessionOptions,
} from '../syntax/session'
import type { EditorToken } from '../tokens'

export const EDITOR_SNIPPET_TOKENS_FEATURE_ID = 'editor.snippetTokens'

/**
 * Tokens for text that is not the document — a hover's fenced code, a preview — from the same
 * providers, in the same precedence, the document itself is painted by.
 */
export type EditorSnippetTokensFeature = {
  tokenize(text: string, languageId: EditorSyntaxLanguageId): Promise<readonly EditorToken[]>
  /**
   * Lends providers the editor itself was never given. A diff paints from a backend of its own,
   * because handing the editor a language would parse the interleaved buffer; its hovers still
   * want that backend's colours.
   */
  addSource(source: EditorSnippetTokenSource): EditorDisposable
}

export type EditorSnippetTokenSource = {
  readonly highlighter?: EditorHighlighterProvider | null
  readonly syntax?: EditorSyntaxProvider | null
}

export const EDITOR_SNIPPET_TOKENS_FEATURE =
  createEditorCapabilityToken<EditorSnippetTokensFeature>(EDITOR_SNIPPET_TOKENS_FEATURE_ID)

let nextSnippetId = 1

export function createSnippetTokensFeature(
  pluginHost: EditorPluginHost,
): EditorSnippetTokensFeature {
  const sources: EditorSnippetTokenSource[] = []
  return {
    tokenize: (text, languageId) => tokenizeSnippet(pluginHost, sources, text, languageId),
    addSource: (source) => {
      sources.push(source)
      return { dispose: () => void sources.splice(sources.indexOf(source) >>> 0, 1) }
    },
  }
}

async function tokenizeSnippet(
  pluginHost: EditorPluginHost,
  sources: readonly EditorSnippetTokenSource[],
  text: string,
  languageId: EditorSyntaxLanguageId,
): Promise<readonly EditorToken[]> {
  if (text.length === 0) return []

  const opener = new SnippetSessionOpener(text, `editor-snippet-${nextSnippetId}`, languageId)
  nextSnippetId += 1
  const opened = openSnippetSession(pluginHost, sources, opener)
  if (!opened) return []

  try {
    const result = await opened.session.refresh(opened.snippet.textSnapshot)
    return opened.snippet.submittedTokens(result.tokens)
  } finally {
    opened.session.dispose()
  }
}

type OpenedSnippet = {
  readonly session: EditorHighlighterSession | EditorSyntaxSession
  readonly snippet: SnippetDocument
}

// A highlighter, when one takes the language, paints the document instead of the structural
// captures, so it is asked first here too.
function openSnippetSession(
  pluginHost: EditorPluginHost,
  sources: readonly EditorSnippetTokenSource[],
  opener: SnippetSessionOpener,
): OpenedSnippet | null {
  for (const source of sources) {
    const { highlighter, syntax } = source
    const lent =
      (highlighter && opener.highlight((document) => highlighter.createSession(document))) ??
      (syntax && opener.parse((options) => syntax.createSession(options)))
    if (lent) return lent
  }
  return (
    opener.highlight((document) => pluginHost.createHighlighterSession(document)) ??
    opener.parse((options) => pluginHost.createSyntaxSession(options))
  )
}

/** Opens sessions over the snippet, each engine reading the lines it splits by. */
class SnippetSessionOpener {
  #submitted: SnippetDocument | null = null
  #folded: SnippetDocument | null = null

  constructor(
    private readonly text: string,
    private readonly documentId: string,
    private readonly languageId: EditorSyntaxLanguageId,
  ) {}

  highlight(
    open: (document: EditorHighlighterSessionOptions) => EditorHighlighterSession | null,
  ): OpenedSnippet | null {
    this.#submitted ??= createSnippetDocument(this.text, 'as-submitted')
    const session = open(this.options(this.#submitted))
    return session ? { session, snippet: this.#submitted } : null
  }

  parse(
    open: (options: EditorSyntaxSessionOptions) => EditorSyntaxSession | null,
  ): OpenedSnippet | null {
    this.#folded ??= createSnippetDocument(this.text, 'as-document')
    const options = {
      ...this.options(this.#folded),
      includeHighlights: true,
      syntaxMode: 'full' as const,
    }
    const session = open(options)
    return session ? { session, snippet: this.#folded } : null
  }

  private options(snippet: SnippetDocument): EditorHighlighterSessionOptions {
    return {
      documentId: this.documentId,
      languageId: this.languageId,
      snapshot: snippet.snapshot,
      textSnapshot: snippet.textSnapshot,
    }
  }
}
