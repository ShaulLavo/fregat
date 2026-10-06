import { createEditorCapabilityToken, type EditorPluginHost } from '../plugins'
import { type EditorDisposable } from './disposables'
import type { EditorHighlighterProvider } from '../syntax/highlighter'
import { createSnippetDocument } from '../syntax/snippetDocument'
import type { EditorSyntaxLanguageId, EditorSyntaxProvider } from '../syntax/session'
import { createEditorDocumentAnalysis } from './documentAnalysis'
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

  const documentId = `editor-snippet-${nextSnippetId++}`
  const highlighters = [
    ...sources.flatMap((source) => (source.highlighter ? [source.highlighter] : [])),
    ...pluginHost.getHighlighterProviders(),
  ]
  const structural = [
    ...sources.flatMap((source) => (source.syntax ? [source.syntax] : [])),
    ...pluginHost.getSyntaxProviders(),
  ]
  if (highlighters.length > 0) {
    const submitted = createSnippetDocument(text, 'as-submitted')
    const analysis = createEditorDocumentAnalysis({ buffer: submitted.buffer, documentId })
    try {
      for (const provider of highlighters) {
        const audience = analysis.contributions.createAudience()
        const task = analysis.contributions.request(
          provider.operation,
          { languageId },
          { kind: 'latest', audience },
        )
        const outcome = await task.settled
        audience.dispose()
        if (outcome.kind === 'failed') throw outcome.failure
        if (outcome.kind === 'completed') return submitted.submittedTokens(outcome.result.tokens)
      }
    } finally {
      analysis.dispose()
    }
  }
  const folded = createSnippetDocument(text, 'as-document')
  const analysis = createEditorDocumentAnalysis({ buffer: folded.buffer, documentId })
  try {
    for (const provider of structural) {
      const audience = analysis.contributions.createAudience()
      const task = analysis.contributions.request(
        provider.operation,
        { languageId, includeHighlights: true, syntaxMode: 'full' },
        { kind: 'latest', audience },
      )
      const outcome = await task.settled
      audience.dispose()
      if (outcome.kind === 'failed') throw outcome.failure
      if (outcome.kind === 'completed') return folded.submittedTokens(outcome.result.tokens)
    }
    return []
  } finally {
    analysis.dispose()
  }
}
