import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext, ServiceContext } from './context'
import { locationOf } from './context'
import type { LineIndex } from './lineIndex'
import { stringParam } from './protocol'

const MAX_WORKSPACE_SYMBOLS = 256
const SYMBOL_TAG_DEPRECATED = 1

const SymbolKind = {
  Module: 2,
  Class: 5,
  Method: 6,
  Property: 7,
  Field: 8,
  Constructor: 9,
  Enum: 10,
  Interface: 11,
  Function: 12,
  Variable: 13,
  EnumMember: 22,
  TypeParameter: 26,
} as const

/**
 * The file's outline, in document order: TypeScript sorts its navigation tree by name, the server
 * path does not. Nested symbols need the client to say it can show a tree; otherwise the same
 * symbols come back flat, each naming its container, as the protocol requires.
 */
export function documentSymbol(
  ctx: DocumentContext,
  hierarchical: boolean,
): lsp.DocumentSymbol[] | lsp.SymbolInformation[] {
  const tree = ctx.env.languageService.getNavigationTree(ctx.document.fileName)
  const symbols = (tree.childItems ?? [])
    .flatMap((item) => documentSymbols(ctx.lines, item))
    .sort(compareSymbols)
  if (hierarchical) return symbols

  return flattenSymbols(ctx.document.uri, symbols, undefined)
}

/** One symbol per span, so a declaration merged across places shows at each of them. */
function documentSymbols(lines: LineIndex, item: ts.NavigationTree): lsp.DocumentSymbol[] {
  const children = new Set(item.childItems ?? [])
  const include = shouldInclude(item)
  const output: lsp.DocumentSymbol[] = []

  for (const span of item.spans) {
    const symbol = documentSymbolAt(lines, item, span)
    for (const child of children) {
      if (!child.spans.some((childSpan) => spansIntersect(span, childSpan))) continue

      symbol.children?.push(...documentSymbols(lines, child))
      children.delete(child)
    }
    symbol.children?.sort(compareSymbols)
    if (include || (symbol.children?.length ?? 0) > 0) output.push(symbol)
  }

  return output
}

function compareSymbols(left: lsp.DocumentSymbol, right: lsp.DocumentSymbol): number {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character
  )
}

function documentSymbolAt(
  lines: LineIndex,
  item: ts.NavigationTree,
  span: ts.TextSpan,
): lsp.DocumentSymbol {
  const nameSpan = item.nameSpan && spanContains(span, item.nameSpan) ? item.nameSpan : span
  const symbol: lsp.DocumentSymbol = {
    name: symbolName(item),
    kind: documentSymbolKind(item.kind),
    range: lines.range(span),
    selectionRange: lines.range(nameSpan),
    children: [],
  }
  if (isDeprecated(item.kindModifiers)) symbol.tags = [SYMBOL_TAG_DEPRECATED]
  return symbol
}

function flattenSymbols(
  uri: lsp.DocumentUri,
  symbols: readonly lsp.DocumentSymbol[],
  containerName: string | undefined,
): lsp.SymbolInformation[] {
  return symbols.flatMap((symbol) => {
    const information: lsp.SymbolInformation = {
      name: symbol.name,
      kind: symbol.kind,
      location: { uri, range: symbol.range },
    }
    if (containerName) information.containerName = containerName
    if (symbol.tags) information.tags = symbol.tags
    return [information, ...flattenSymbols(uri, symbol.children ?? [], symbol.name)]
  })
}

export function workspaceSymbol(ctx: ServiceContext, params: unknown): lsp.SymbolInformation[] {
  const query = stringParam(params, 'query') ?? ''
  const program = ctx.env.languageService.getProgram()
  const items = ctx.env.languageService.getNavigateToItems(query, MAX_WORKSPACE_SYMBOLS)

  return items.flatMap((item) => {
    if (item.kind === 'alias' && !item.containerName) return []
    const sourceFile = program?.getSourceFile(item.fileName)
    if (sourceFile && program?.isSourceFileDefaultLibrary(sourceFile)) return []

    const location = locationOf(ctx, item)
    if (!location) return []

    const information: lsp.SymbolInformation = {
      name: item.name,
      kind: workspaceSymbolKind(item.kind),
      location,
    }
    if (item.containerName) information.containerName = item.containerName
    if (isDeprecated(item.kindModifiers)) information.tags = [SYMBOL_TAG_DEPRECATED]
    return [information]
  })
}

function shouldInclude(item: ts.NavigationTree): boolean {
  if (item.kind === 'alias') return false
  return Boolean(item.text) && item.text !== '<function>' && item.text !== '<class>'
}

function symbolName(item: ts.NavigationTree): string {
  if (item.kind === 'getter') return `(get) ${item.text}`
  if (item.kind === 'setter') return `(set) ${item.text}`
  return item.text
}

function documentSymbolKind(kind: string): lsp.SymbolKind {
  if (kind === 'module') return SymbolKind.Module
  if (kind === 'class') return SymbolKind.Class
  if (kind === 'enum') return SymbolKind.Enum
  if (kind === 'enum member') return SymbolKind.EnumMember
  if (kind === 'interface') return SymbolKind.Interface
  if (kind === 'method') return SymbolKind.Method
  if (kind === 'property' || kind === 'getter' || kind === 'setter') return SymbolKind.Property
  if (kind === 'function' || kind === 'local function') return SymbolKind.Function
  if (kind === 'construct' || kind === 'constructor') return SymbolKind.Constructor
  if (kind === 'type parameter') return SymbolKind.TypeParameter
  return SymbolKind.Variable
}

function workspaceSymbolKind(kind: string): lsp.SymbolKind {
  if (kind === 'method') return SymbolKind.Method
  if (kind === 'enum') return SymbolKind.Enum
  if (kind === 'enum member') return SymbolKind.EnumMember
  if (kind === 'function') return SymbolKind.Function
  if (kind === 'class' || kind === 'type') return SymbolKind.Class
  if (kind === 'interface') return SymbolKind.Interface
  if (kind === 'property' || kind === 'getter' || kind === 'setter') return SymbolKind.Field
  return SymbolKind.Variable
}

function isDeprecated(kindModifiers: string | undefined): boolean {
  return kindModifiers?.split(',').includes('deprecated') === true
}

function spansIntersect(left: ts.TextSpan, right: ts.TextSpan): boolean {
  return left.start <= right.start + right.length && right.start <= left.start + left.length
}

function spanContains(outer: ts.TextSpan, inner: ts.TextSpan): boolean {
  return outer.start <= inner.start && inner.start + inner.length <= outer.start + outer.length
}
