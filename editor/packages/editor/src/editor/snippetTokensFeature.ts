import { createEditorCapabilityToken, type EditorPluginHost } from '../plugins'
import { type EditorDisposable } from './disposables'
import {
  type EditorHighlighterProvider,
  type EditorHighlighterSession,
  type EditorHighlighterSessionOptions,
} from '../syntax/highlighter'
import { createSnippetDocument } from '../syntax/snippetDocument'
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

  const snippet = createSnippetDocument(text)
  const document = {
    documentId: `editor-snippet-${nextSnippetId}`,
    languageId,
    snapshot: snippet.snapshot,
    textSnapshot: snippet.textSnapshot,
  }
  nextSnippetId += 1

  // A highlighter, when one takes the language, paints the document instead of the structural
  // captures, so it is asked first here too.
  const syntaxOptions = { ...document, includeHighlights: true, syntaxMode: 'full' as const }
  const session =
    lentSession(sources, document, syntaxOptions) ??
    pluginHost.createHighlighterSession(document) ??
    pluginHost.createSyntaxSession(syntaxOptions)
  if (!session) return []

  try {
    const result = await session.refresh(snippet.textSnapshot)
    return snippet.submittedTokens(result.tokens)
  } finally {
    session.dispose()
  }
}

function lentSession(
  sources: readonly EditorSnippetTokenSource[],
  document: EditorHighlighterSessionOptions,
  syntaxOptions: EditorSyntaxSessionOptions,
): EditorHighlighterSession | EditorSyntaxSession | null {
  for (const source of sources) {
    const session =
      source.highlighter?.createSession(document) ?? source.syntax?.createSession(syntaxOptions)
    if (session) return session
  }
  return null
}
