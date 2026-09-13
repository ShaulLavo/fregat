import type { DocumentSymbol } from '@/lib/document-symbols'
import type { TreeEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { toTreePath } from '@/lib/path-formatters'

export type BreadcrumbPathItem = {
  readonly kind: 'file' | 'folder'
  readonly name: string
  readonly path: string
  readonly parentPath: string
}

export type EditorCursor = { readonly row: number; readonly column: number }

export function breadcrumbPathItems(rootPath: string, filePath: string): BreadcrumbPathItem[] {
  const segments = toTreePath(filePath, rootPath).split('/').filter(Boolean)
  const items: BreadcrumbPathItem[] = []
  let parentPath = rootPath
  for (const [index, name] of segments.entries()) {
    const path = `${parentPath}/${name}`
    items.push({
      kind: index === segments.length - 1 ? 'file' : 'folder',
      name,
      parentPath,
      path,
    })
    parentPath = path
  }

  return items
}

export function symbolChainAtCursor(
  symbols: readonly DocumentSymbol[],
  cursor: EditorCursor | null,
): DocumentSymbol[] {
  if (!cursor) return []

  const chain: DocumentSymbol[] = []
  let level: readonly DocumentSymbol[] = symbols
  for (;;) {
    const enclosing = level.find((symbol) => rangeContainsCursor(symbol, cursor))
    if (!enclosing) return chain

    chain.push(enclosing)
    level = enclosing.children ?? []
  }
}

function rangeContainsCursor(symbol: DocumentSymbol, cursor: EditorCursor) {
  const { end, start } = symbol.range
  if (cursor.row < start.line || cursor.row > end.line) return false
  if (cursor.row === start.line && cursor.column < start.character) return false

  return cursor.row !== end.line || cursor.column <= end.character
}

export function sortPickerEntries(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries.toSorted((left, right) => {
    const leftDirectory = isDirectoryEntry(left)
    const rightDirectory = isDirectoryEntry(right)
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1

    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

export function sortPickerSymbols(symbols: readonly DocumentSymbol[]): DocumentSymbol[] {
  return symbols.toSorted((left, right) => {
    if (left.range.start.line !== right.range.start.line)
      return left.range.start.line - right.range.start.line

    return left.range.start.character - right.range.start.character
  })
}

export function symbolRowKey(symbol: DocumentSymbol) {
  return `${symbol.name}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}`
}
