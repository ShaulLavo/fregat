import {
  createEditorLanguageFeatureToken,
  type EditorDisposable,
  type EditorViewContributionContext,
  type EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  offsetToLspPositionInSnapshot,
  type LspClient,
  type LspTextDocumentSnapshot,
} from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'

import { completionNeedsResolve, type LanguageServerCompletionTrigger } from './completion'

/**
 * Named rather than imported by everyone who answers it: a snippet set, a path completer or a
 * second server has no reason to depend on this package, and restating the id is how they reach the
 * same list.
 */
const EDITOR_COMPLETION_SOURCE_ID = 'editor.completionSource'

/** What is being completed, in the text the caller has, not in a protocol position. */
export type EditorCompletionRequest = {
  readonly uri: string
  readonly document: LspTextDocumentSnapshot
  readonly offset: number
  readonly trigger: LanguageServerCompletionTrigger
  readonly signal: AbortSignal
}

/**
 * What a source hands back: the protocol's own shapes, so a source that already speaks to a server
 * returns the answer as it came and a source that does not can hand over a plain array.
 */
export type EditorCompletionAnswer =
  | lsp.CompletionList
  | readonly lsp.CompletionItem[]
  | null
  | undefined

export type EditorCompletionSource = {
  provideCompletionItems(
    request: EditorCompletionRequest,
  ): PromiseLike<EditorCompletionAnswer> | EditorCompletionAnswer
  /**
   * The rest of an item, for a source that sends a cheap one first, or null when this item is
   * already whole. Judged here because only the source knows what it left out.
   */
  resolveCompletionItem?(item: lsp.CompletionItem): PromiseLike<lsp.CompletionItem> | null
}

const EDITOR_COMPLETION_SOURCE = createEditorLanguageFeatureToken<EditorCompletionSource>(
  EDITOR_COMPLETION_SOURCE_ID,
)

/** The sources a document is answered from, in the order they are to be asked. */
export type EditorCompletionSourceSet = {
  forLanguage(languageId: EditorViewSnapshot['languageId']): readonly EditorCompletionSource[]
}

export function createLanguageServerCompletionSource(
  client: LspClient,
  isAvailable: () => boolean = () => true,
  onRequestSuccess?: () => void,
  onRequestError?: (method: string, error: unknown) => void,
): EditorCompletionSource {
  return {
    // The server's answer is handed on as it arrives rather than repackaged, so nothing stands
    // between the reply and the list but the merge the caller does anyway.
    provideCompletionItems: (request) => {
      // Asking a connection that has not finished handshaking would spend a round-trip to be told
      // so; the other sources answer meanwhile.
      if (!client.initialized || !isAvailable()) return null

      return client
        .request<EditorCompletionAnswer>(
          'textDocument/completion',
          {
            textDocument: { uri: request.uri },
            position: offsetToLspPositionInSnapshot(request.document, request.offset),
            context: request.trigger,
          } satisfies lsp.CompletionParams,
          { signal: request.signal },
        )
        .then(
          (answer) => {
            onRequestSuccess?.()
            return answer
          },
          (error: unknown) => {
            onRequestError?.('textDocument/completion', error)
            return null
          },
        )
    },
    // Most servers send an item without its import edit and expect a resolve round-trip; applying
    // the unresolved item is what silently drops auto-imports.
    resolveCompletionItem: (item) =>
      completionNeedsResolve(item, client.serverCapabilities)
        ? client
            .request<lsp.CompletionItem>('completionItem/resolve', item)
            .then(undefined, (error) => {
              onRequestError?.('completionItem/resolve', error)
              return item
            })
        : null,
  }
}

/**
 * The sources a completion request is answered from.
 *
 * The server's own goes into the editor's channel rather than being called directly, so that a
 * snippet set or a second server registered for the same feature is asked in one order and lands in
 * one list. The registration is held here because the connection it speaks for is: a source outlives
 * neither.
 *
 * A host that cannot take the registration cannot hand the list back either, and is answered from
 * the server alone — which is what it got before there was a channel to join.
 */
export class LanguageServerCompletionSources
  implements EditorCompletionSourceSet, EditorDisposable
{
  private readonly registrations: readonly EditorDisposable[]

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly sources: readonly EditorCompletionSource[],
  ) {
    // Every document, because which ones a server answers for is a question the plugin settles by
    // opening them, not one a language name can be matched against.
    this.registrations = sources.flatMap((source) => {
      const registration = context.registerProvider(
        EDITOR_COMPLETION_SOURCE,
        { language: '*' },
        source,
      )
      return registration ? [registration] : []
    })
  }

  public forLanguage(
    languageId: EditorViewSnapshot['languageId'],
  ): readonly EditorCompletionSource[] {
    const registered = this.context.getProviders(EDITOR_COMPLETION_SOURCE, languageId)
    if (!registered) return this.sources

    const missing = this.sources.filter((source) => !registered.includes(source))
    return registered.concat(missing)
  }

  public dispose(): void {
    for (const registration of this.registrations) registration.dispose()
  }
}
