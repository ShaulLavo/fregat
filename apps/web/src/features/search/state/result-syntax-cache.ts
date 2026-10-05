import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis, type EditorDocumentAnalysis } from '@singapore-editor/core/editor'
import {
  toEditorTokenStore,
  type EditorSyntaxProvider,
  type EditorToken,
} from '@singapore-editor/core/syntax'

type ExcerptOptions = {
  readonly documentId: string
  readonly languageId: string | null
  readonly includeCaptures?: boolean
  readonly includeHighlights?: boolean
  readonly text: string
}

export type SearchResultSyntaxLease = {
  readonly result: Promise<readonly EditorToken[]>
  readonly release: () => void
}

type PendingExcerpt = {
  readonly result: Promise<readonly EditorToken[]>
  readonly analysis: EditorDocumentAnalysis
  readers: number
}

const caches = new WeakMap<EditorSyntaxProvider, SearchResultSyntaxCache>()
const EXCERPT_CACHE_CAPACITY = 2_048

export function searchResultSyntaxCache(provider: EditorSyntaxProvider): SearchResultSyntaxCache {
  const existing = caches.get(provider)
  if (existing) return existing

  const cache = new SearchResultSyntaxCache(provider)
  caches.set(provider, cache)
  return cache
}

export class SearchResultSyntaxCache {
  private readonly completed = new Map<string, readonly EditorToken[]>()
  private readonly pending = new Map<string, PendingExcerpt>()
  private nextDocumentId = 0

  public constructor(
    private readonly provider: EditorSyntaxProvider,
    private readonly capacity = EXCERPT_CACHE_CAPACITY,
  ) {}

  public acquire(options: ExcerptOptions): SearchResultSyntaxLease {
    const key = excerptKey(options)
    const cached = this.completed.get(key)
    if (cached) {
      this.completed.delete(key)
      this.completed.set(key, cached)
      return completedLease(cached)
    }

    const entry = this.pending.get(key) ?? this.start(key, options)
    if (!entry) return completedLease([])

    entry.readers += 1
    let released = false
    return {
      result: entry.result,
      release: () => {
        if (released) return
        released = true
        this.release(key, entry)
      },
    }
  }

  private start(key: string, options: ExcerptOptions): PendingExcerpt | null {
    const buffer = createEditorTextBuffer(options.text)
    const analysis = createEditorDocumentAnalysis({ buffer, documentId: `${options.documentId}:excerpt:${++this.nextDocumentId}` })
    const owner = analysis.contributions.pin()
    if (!owner) { analysis.dispose(); return null }
    const task = analysis.contributions.request(this.provider.operation, {
      languageId: options.languageId,
      includeCaptures: options.includeCaptures,
      includeHighlights: options.includeHighlights,
      syntaxMode: 'full',
    }, { kind: 'pinned', owner })
    const result = task.settled.then(outcome => {
      if (outcome.kind === 'failed') throw outcome.failure
      return outcome.kind === 'completed' ? toEditorTokenStore(outcome.result.tokens).toTokens() : []
    }).finally(() => owner.dispose())
    const entry = { readers: 0, result, analysis }
    this.pending.set(key, entry)
    void result.then(
      (tokens) => this.finish(key, entry, tokens),
      () => this.discard(key, entry),
    )
    return entry
  }

  private finish(key: string, entry: PendingExcerpt, tokens: readonly EditorToken[]): void {
    if (this.pending.get(key) !== entry) return

    this.discard(key, entry)
    this.completed.set(key, tokens)
    if (this.completed.size <= this.capacity) return

    const oldest = this.completed.keys().next().value
    if (oldest !== undefined) this.completed.delete(oldest)
  }

  private release(key: string, entry: PendingExcerpt): void {
    entry.readers -= 1
    if (entry.readers > 0) return

    this.discard(key, entry)
  }

  private discard(key: string, entry: PendingExcerpt): void {
    if (this.pending.get(key) !== entry) return

    this.pending.delete(key)
    entry.analysis.dispose()
  }
}

function excerptKey(options: ExcerptOptions): string {
  return JSON.stringify([
    options.languageId,
    options.includeCaptures,
    options.includeHighlights,
    options.text,
  ])
}

function completedLease(tokens: readonly EditorToken[]): SearchResultSyntaxLease {
  return { result: Promise.resolve(tokens), release: () => {} }
}
