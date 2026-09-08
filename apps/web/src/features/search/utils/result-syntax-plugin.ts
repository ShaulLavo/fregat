import {
  createDocumentTextSnapshot,
  createEmptySyntaxResult,
  createPieceTableSnapshot,
  type DocumentSessionChange,
  type EditorPlugin,
  type EditorSyntaxLanguageId,
  type EditorSyntaxProvider,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type EditorToken,
  type PieceTableSnapshot,
} from '@singapor/core'

import { SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX } from '@/features/search/utils/result-editor'

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
  return {
    createSession: (options) => {
      if (!searchResultSyntaxSessionOptions(options)) return null

      return new SearchResultSyntaxSession(syntaxProvider, options)
    },
  }
}

function searchResultSyntaxSessionOptions(
  options: EditorSyntaxSessionOptions,
): options is EditorSyntaxSessionOptions & { readonly languageId: EditorSyntaxLanguageId } {
  if (!options.documentId.startsWith(SEARCH_RESULT_FILE_DOCUMENT_ID_PREFIX)) return false

  return options.languageId !== null
}

class SearchResultSyntaxSession implements EditorSyntaxSession {
  public readonly foldingSupport = 'unsupported'
  private readonly syntaxProvider: EditorSyntaxProvider
  private readonly options: EditorSyntaxSessionOptions & {
    readonly languageId: EditorSyntaxLanguageId
  }
  private disposed = false
  private result: EditorSyntaxResult
  private snapshotVersion = 0

  public constructor(
    syntaxProvider: EditorSyntaxProvider,
    options: EditorSyntaxSessionOptions & { readonly languageId: EditorSyntaxLanguageId },
  ) {
    this.syntaxProvider = syntaxProvider
    this.options = options
    this.result = this.createResult([], options.snapshot, 0)
  }

  public async refresh(
    snapshot: PieceTableSnapshot,
    fullText?: string,
  ): Promise<EditorSyntaxResult> {
    if (this.disposed) return this.result

    const text = fullText ?? createDocumentTextSnapshot(snapshot).materializeFullText()
    const snapshotVersion = this.nextSnapshotVersion()
    const tokens = await this.parseLines(searchResultSyntaxLines(text), snapshotVersion)
    if (!this.canApplySnapshotVersion(snapshotVersion)) return this.result

    this.result = this.createResult(tokens, snapshot, snapshotVersion)
    return this.result
  }

  public applyChange(change: DocumentSessionChange): Promise<EditorSyntaxResult> {
    return this.refresh(change.snapshot, change.textSnapshot.materializeFullText())
  }

  public getResult(): EditorSyntaxResult {
    return this.result
  }

  public getTokens(): readonly EditorToken[] {
    return this.result.tokens
  }

  public getSnapshotVersion(): number {
    return this.snapshotVersion
  }

  public dispose(): void {
    this.disposed = true
  }

  private nextSnapshotVersion(): number {
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
  ): Promise<readonly EditorToken[]> {
    const linesToParse = lines.filter((line) => line.text.length > 0)
    if (linesToParse.length === 0) return []

    const tokens: EditorToken[] = []
    for (const line of linesToParse) tokens.push(...(await this.parseLine(line, snapshotVersion)))
    return tokens
  }

  private createLineSyntaxSession(
    line: SearchResultSyntaxLine,
    snapshotVersion: number,
  ): EditorSyntaxSession | null {
    const snapshot = createPieceTableSnapshot('')
    return this.syntaxProvider.createSession({
      documentId: `${this.options.documentId}:excerpt:${snapshotVersion}:${line.start}`,
      languageId: this.options.languageId,
      includeCaptures: this.options.includeCaptures,
      includeHighlights: this.options.includeHighlights,
      syntaxMode: 'full',
      fullText: '',
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, ''),
    })
  }

  private async parseLine(
    line: SearchResultSyntaxLine,
    snapshotVersion: number,
  ): Promise<readonly EditorToken[]> {
    const session = this.createLineSyntaxSession(line, snapshotVersion)
    if (!session) return []

    const snapshot = createPieceTableSnapshot(line.text)
    try {
      const result = await session.refresh(snapshot, line.text)
      return offsetEditorTokens(result.tokens, line.start)
    } finally {
      session.dispose()
    }
  }

  private createResult(
    tokens: readonly EditorToken[],
    snapshot: PieceTableSnapshot,
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

function searchResultSyntaxLines(text: string): readonly SearchResultSyntaxLine[] {
  const lines: SearchResultSyntaxLine[] = []
  let start = 0

  while (start <= text.length) {
    const end = searchResultSyntaxLineEnd(text, start)
    lines.push({
      end,
      start,
      text: text.slice(start, end),
    })
    if (end === text.length) break

    start = end + 1
  }

  return lines
}

function searchResultSyntaxLineEnd(text: string, start: number) {
  const index = text.indexOf('\n', start)
  if (index === -1) return text.length

  return index
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
