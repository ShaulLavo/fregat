import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import { locationsOf, type DocumentContext } from './context'
import { isRecord, positionParam } from './protocol'

const DOCUMENT_HIGHLIGHT_TEXT = 1
const DOCUMENT_HIGHLIGHT_READ = 2
const DOCUMENT_HIGHLIGHT_WRITE = 3

export function definition(ctx: DocumentContext, params: unknown): lsp.Location[] {
  const offset = requestOffset(ctx, params)
  if (offset === null) return []

  const service = ctx.env.languageService
  const fileName = ctx.document.fileName
  const withSpan = service.getDefinitionAndBoundSpan(fileName, offset)
  const definitions = withSpan?.definitions ?? service.getDefinitionAtPosition(fileName, offset)
  return locationsOf(ctx, definitions ?? [])
}

export function references(ctx: DocumentContext, params: unknown): lsp.Location[] {
  const offset = requestOffset(ctx, params)
  if (offset === null) return []

  const includeDeclaration = referencesIncludeDeclaration(params)
  const entries =
    ctx.env.languageService.getReferencesAtPosition(ctx.document.fileName, offset) ?? []
  return locationsOf(
    ctx,
    entries.filter((entry) => includeDeclaration || !referenceIsDefinition(entry)),
  )
}

export function implementation(ctx: DocumentContext, params: unknown): lsp.Location[] {
  const offset = requestOffset(ctx, params)
  if (offset === null) return []

  return locationsOf(
    ctx,
    ctx.env.languageService.getImplementationAtPosition(ctx.document.fileName, offset) ?? [],
  )
}

export function typeDefinition(ctx: DocumentContext, params: unknown): lsp.Location[] {
  const offset = requestOffset(ctx, params)
  if (offset === null) return []

  return locationsOf(
    ctx,
    ctx.env.languageService.getTypeDefinitionAtPosition(ctx.document.fileName, offset) ?? [],
  )
}

/** Occurrences in this document only; TypeScript also reports other files, which LSP does not ask for. */
export function documentHighlight(ctx: DocumentContext, params: unknown): lsp.DocumentHighlight[] {
  const offset = requestOffset(ctx, params)
  if (offset === null) return []

  const fileName = ctx.document.fileName
  const highlights =
    ctx.env.languageService.getDocumentHighlights(fileName, offset, [fileName]) ?? []
  return highlights
    .filter((entry) => entry.fileName === fileName)
    .flatMap((entry) => entry.highlightSpans)
    .map((span) => ({ range: ctx.lines.range(span.textSpan), kind: highlightKind(span.kind) }))
}

function highlightKind(kind: ts.HighlightSpanKind): lsp.DocumentHighlightKind {
  if (kind === 'writtenReference') return DOCUMENT_HIGHLIGHT_WRITE
  if (kind === 'none') return DOCUMENT_HIGHLIGHT_TEXT
  return DOCUMENT_HIGHLIGHT_READ
}

function requestOffset(ctx: DocumentContext, params: unknown): number | null {
  const position = positionParam(params)
  if (!position) return null
  return ctx.lines.offset(position)
}

function referencesIncludeDeclaration(params: unknown): boolean {
  if (!isRecord(params)) return true
  if (!isRecord(params.context)) return true
  return params.context.includeDeclaration !== false
}

function referenceIsDefinition(reference: ts.ReferenceEntry): boolean {
  return (reference as { readonly isDefinition?: boolean }).isDefinition === true
}
