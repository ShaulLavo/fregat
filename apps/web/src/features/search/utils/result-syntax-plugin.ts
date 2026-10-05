import { type TextReadSnapshot } from '@singapore-editor/core/document'
import {
  createEmptySyntaxResult,
  type EditorSyntaxLanguageId,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
  type EditorSyntaxRuntime,
  type EditorToken,
  type EditorTokenInput,
} from '@singapore-editor/core/syntax'
import { type EditorPlugin } from '@singapore-editor/core/extensions'
import {
  createEditorStructuralOperation,
  type EditorStructuralOperationContext,
  type DocumentRead,
} from '@singapore-editor/core/editor'

import { SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX } from '@/features/search/utils/result-editor'
import {
  searchResultSyntaxCache,
  type SearchResultSyntaxCache,
  type SearchResultSyntaxLease,
} from '@/features/search/state/result-syntax-cache'

type SearchResultSyntaxLine = {
  readonly end: number
  readonly start: number
  readonly text: string
}

export function createSearchResultSyntaxHighlightingPlugin(
  syntaxProvider: EditorSyntaxProvider,
): EditorPlugin {
  return {
    name: 'platform.search-result-syntax',
    activate: (context) =>
      context.registerSyntaxProvider(createSearchResultSyntaxProvider(syntaxProvider)),
  }
}

export function createSearchResultSyntaxProvider(
  syntaxProvider: EditorSyntaxProvider,
): EditorSyntaxProvider {
  const cache = searchResultSyntaxCache(syntaxProvider)
  return {
    operation: createEditorStructuralOperation((options) => {
      if (!searchResultSyntaxSessionOptions(options)) return null

      return new SearchResultSyntaxSession(cache, options)
    }),
  }
}

function searchResultSyntaxSessionOptions(
  options: EditorStructuralOperationContext,
): options is EditorStructuralOperationContext & { readonly languageId: EditorSyntaxLanguageId } {
  if (!options.documentId.startsWith(SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX)) return false

  return options.languageId !== null
}

class SearchResultSyntaxSession implements EditorSyntaxRuntime {
  public readonly foldingSupport = 'unsupported'
  private readonly cache: SearchResultSyntaxCache
  private readonly options: EditorStructuralOperationContext & {
    readonly languageId: EditorSyntaxLanguageId
  }
  private disposed = false
  private result: EditorSyntaxResult
  private snapshotVersion = 0
  private pendingLine: SearchResultSyntaxLease | null = null

  public constructor(
    cache: SearchResultSyntaxCache,
    options: EditorStructuralOperationContext & { readonly languageId: EditorSyntaxLanguageId },
  ) {
    this.cache = cache
    this.options = options
    this.result = this.createResult([], options.initialRead.text, 0)
  }

  public async analyze(read: DocumentRead, signal: AbortSignal): Promise<EditorSyntaxResult> {
    signal.throwIfAborted()
    if (this.disposed) return this.result
    const cancel = () => this.cancelPendingLine()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const snapshotVersion = this.nextSnapshotVersion()
      const tokens = await this.parseLines(
        searchResultSyntaxLines(read.text),
        snapshotVersion,
        signal,
      )
      signal.throwIfAborted()
      if (!this.canApplySnapshotVersion(snapshotVersion)) return this.result
      this.result = this.createResult(tokens, read.text, snapshotVersion)
      return this.result
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  }

  public getResult(): EditorSyntaxResult {
    return this.result
  }

  public getTokens(): EditorTokenInput {
    return this.result.tokens
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion
  }

  public dispose(): void {
    this.disposed = true
    this.cancelPendingLine()
  }

  private nextSnapshotVersion(): number {
    this.cancelPendingLine()
    this.snapshotVersion += 1
    return this.snapshotVersion
  }

  private canApplySnapshotVersion(snapshotVersion: number): boolean {
    if (this.disposed) return false

    return snapshotVersion === this.snapshotVersion
  }

  private async parseLines(
    lines: readonly SearchResultSyntaxLine[],
    snapshotVersion: number,
    signal: AbortSignal,
  ): Promise<readonly EditorToken[]> {
    const linesToParse = lines.filter((line) => line.text.length > 0)
    if (linesToParse.length === 0) return []

    const tokens: EditorToken[] = []
    for (const line of linesToParse) {
      signal.throwIfAborted()
      if (!this.canApplySnapshotVersion(snapshotVersion)) break

      tokens.push(...(await this.parseLine(line, snapshotVersion)))
    }
    return tokens
  }

  private cancelPendingLine(): void {
    this.pendingLine?.release()
    this.pendingLine = null
  }

  private async parseLine(
    line: SearchResultSyntaxLine,
    snapshotVersion: number,
  ): Promise<readonly EditorToken[]> {
    const lease = this.cache.acquire({ ...this.options, text: line.text })
    this.pendingLine = lease
    try {
      return offsetEditorTokens(await lease.result, line.start)
    } catch (error) {
      if (!this.canApplySnapshotVersion(snapshotVersion)) return []
      throw error
    } finally {
      lease.release()
      if (this.pendingLine === lease) this.pendingLine = null
    }
  }

  private createResult(
    tokens: readonly EditorToken[],
    snapshot: Pick<TextReadSnapshot, 'length'>,
    snapshotVersion: number,
  ): EditorSyntaxResult {
    return {
      ...createEmptySyntaxResult({
        language: {
          includeCaptures: this.options.includeCaptures ?? false,
          includeHighlights: this.options.includeHighlights ?? true,
          languageId: this.options.languageId,
          mode: 'full',
        },
        snapshot: {
          documentId: this.options.documentId,
          length: snapshot.length,
          version: snapshotVersion,
        },
      }),
      tokens,
    }
  }
}

function searchResultSyntaxLines(snapshot: TextReadSnapshot): readonly SearchResultSyntaxLine[] {
  const lines: SearchResultSyntaxLine[] = []
  for (let index = 0; index < snapshot.lineCount; index += 1) {
    const { start, end } = snapshot.lineRange(index)
    lines.push({ start, end, text: snapshot.readRange(start, end) })
  }
  return lines
}

function offsetEditorTokens(
  tokens: readonly EditorToken[],
  offset: number,
): readonly EditorToken[] {
  if (offset === 0) return tokens

  return tokens.map((token) => ({
    ...token,
    end: token.end + offset,
    start: token.start + offset,
  }))
}
