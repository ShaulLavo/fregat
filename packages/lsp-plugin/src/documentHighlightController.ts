import type * as lsp from 'vscode-languageserver-protocol'

import type {
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core'
import { lspPositionToOffsetInSnapshot, offsetToLspPositionInSnapshot } from '@singapore-editor/lsp'

import type { ActiveDocument } from './pluginTypes'
import type { LanguageServerFeatureRouter } from './serverSet'

/** Matches the hover debounce: both answer "what is under the caret", and should feel alike. */
const DOCUMENT_HIGHLIGHT_DEBOUNCE_MS = 150

export type DocumentHighlightControllerOptions = {
  readonly context: EditorViewContributionContext
  readonly router: LanguageServerFeatureRouter
  readonly highlightName: string
  readonly getActiveDocument: () => ActiveDocument | null
  readonly onRequestError: (error: unknown) => void
}

/**
 * Paints every reference to the symbol under the caret, as the language server sees them.
 *
 * More precise than a textual occurrence match: the server knows scope, so a local `value` does not
 * light up an unrelated `value` in another function. The textual highlighter stays as the fallback
 * for documents with no server.
 */
export class DocumentHighlightController {
  private timer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  private requestId = 0
  private painted = false
  private disposed = false

  public constructor(private readonly options: DocumentHighlightControllerOptions) {}

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'document' || kind === 'clear') {
      this.clear()
      return
    }
    if (kind !== 'selection' && kind !== 'content') return

    const primary = snapshot.selections[0]
    // A dragged selection has its own meaning; only a resting caret asks "where else is this used".
    if (!primary || primary.startOffset !== primary.endOffset) {
      this.clear()
      return
    }

    this.schedule(primary.headOffset)
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.clear()
  }

  private schedule(offset: number): void {
    this.cancel()
    /**
     * @justification Debounces a request to the language server against the caret, not against
     * rendering, and `cancel()` clears it on every move — so the server sees one question per
     * pause rather than one per keystroke.
     */
    this.timer = setTimeout(() => {
      this.timer = null
      void this.request(offset)
    }, DOCUMENT_HIGHLIGHT_DEBOUNCE_MS)
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.abort?.abort()
    this.abort = null
  }

  private async request(offset: number): Promise<void> {
    const active = this.options.getActiveDocument()
    if (!active) return this.clear()
    if (!this.options.router.hasReady('documentHighlights', 'textDocument/documentHighlight')) {
      return
    }

    const abort = new AbortController()
    const requestId = this.requestId + 1
    this.requestId = requestId
    this.abort = abort

    try {
      const highlights = await this.options.router.request<lsp.DocumentHighlight[] | null>(
        'textDocument/documentHighlight',
        {
          position: offsetToLspPositionInSnapshot(active, offset),
          textDocument: { uri: active.uri },
        },
        { signal: abort.signal },
      )
      if (requestId !== this.requestId) return
      if (this.disposed) return
      if (active !== this.options.getActiveDocument()) return

      this.paint(active, highlights)
    } catch (error) {
      this.options.onRequestError(error)
    }
  }

  private paint(active: ActiveDocument, highlights: lsp.DocumentHighlight[] | null): void {
    const ranges = (highlights ?? []).map((highlight) => ({
      end: lspPositionToOffsetInSnapshot(active, highlight.range.end),
      start: lspPositionToOffsetInSnapshot(active, highlight.range.start),
    }))
    // A lone highlight is the symbol the caret is already in — painting it says nothing.
    if (ranges.length < 2) {
      this.clear()
      return
    }

    this.painted = true
    this.options.context.setRangeHighlight(this.options.highlightName, ranges, {
      backgroundColor: 'rgba(128, 128, 128, 0.18)',
    })
  }

  private clear(): void {
    this.cancel()
    if (!this.painted) return

    this.painted = false
    this.options.context.clearRangeHighlight(this.options.highlightName)
  }
}
