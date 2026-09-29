import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { LineIndex } from './lineIndex'
import type { ProjectService } from './projectHost'

export type WorkerDocument = {
  readonly uri: lsp.DocumentUri
  readonly fileName: string
  readonly languageId: string
  readonly version: number
  readonly text: string
}

/** What a request handler may read: the language service and the files it answers about. */
export type ServiceContext = {
  readonly env: ProjectService
  readonly formatSettings: ts.FormatCodeSettings
  readonly preferences: ts.UserPreferences
  /** Lines of the text the service holds for a file, or null when it holds none. */
  linesOf(fileName: string): LineIndex | null
  /** The URI a client knows a file by, undoing the `node_modules` mirror of workspace packages. */
  uriOf(fileName: string): lsp.DocumentUri
  fileNameOf(uri: lsp.DocumentUri): string | null
  /** The version the client holds for an open document, or null for a file it has not opened. */
  versionOf(uri: lsp.DocumentUri): number | null
  /** Whether the client asked for versioned `documentChanges` rather than a `changes` map. */
  readonly documentChanges: boolean
  /** True once the client has cancelled the request, so long work can stop early. */
  cancelled(): boolean
}

export type DocumentContext = ServiceContext & {
  readonly document: WorkerDocument
  readonly lines: LineIndex
}

export type TypeScriptSpanItem = {
  readonly fileName: string
  readonly textSpan: ts.TextSpan
}

export function locationOf(ctx: ServiceContext, item: TypeScriptSpanItem): lsp.Location | null {
  const lines = ctx.linesOf(item.fileName)
  if (!lines) return null

  return { uri: ctx.uriOf(item.fileName), range: lines.range(item.textSpan) }
}

export function locationsOf(
  ctx: ServiceContext,
  items: readonly TypeScriptSpanItem[],
): lsp.Location[] {
  return items.flatMap((item) => locationOf(ctx, item) ?? [])
}
