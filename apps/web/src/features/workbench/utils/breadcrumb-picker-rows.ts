import {
  sortPickerEntries,
  sortPickerSymbols,
  symbolRowKey,
} from '@/features/workbench/utils/breadcrumbs'
import type { DocumentSymbol } from '@/lib/document-symbols'
import { isDirectoryEntry, type TreeEntry } from '@/lib/file-system-types'

export type FolderListing = { entries: readonly TreeEntry[]; pending: boolean; failed: boolean }
export type FolderPickerRow = {
  id: string
  label: string
  parentId: string | undefined
  depth: number
  hasChildren: boolean
  expanded: boolean
  entry: TreeEntry
  pending: boolean
  failed: boolean
}
export type SymbolPickerRow = {
  id: string
  label: string
  parentId: string | undefined
  depth: number
  hasChildren: boolean
  expanded: boolean
  symbol: DocumentSymbol
}

export function folderPickerRows(
  directory: string,
  listings: ReadonlyMap<string, FolderListing>,
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId?: string,
): FolderPickerRow[] {
  return sortPickerEntries(listings.get(directory)?.entries ?? []).flatMap((entry) => {
    const directory = isDirectoryEntry(entry)
    const open = directory && expanded.has(entry.path)
    const child = listings.get(entry.path)
    const row: FolderPickerRow = {
      id: entry.path,
      label: entry.name,
      parentId,
      depth,
      hasChildren: directory,
      expanded: open,
      entry,
      pending: open && (child?.pending ?? true),
      failed: open && (child?.failed ?? false),
    }
    if (!open) return [row]
    return [row, ...folderPickerRows(entry.path, listings, expanded, depth + 1, entry.path)]
  })
}

export function symbolPickerRows(
  symbols: readonly DocumentSymbol[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId?: string,
): SymbolPickerRow[] {
  return sortPickerSymbols(symbols).flatMap((symbol) => {
    const id = symbolRowKey(symbol)
    const children = symbol.children ?? []
    const open = children.length > 0 && expanded.has(id)
    const row: SymbolPickerRow = {
      id,
      label: symbol.name,
      parentId,
      depth,
      hasChildren: children.length > 0,
      expanded: open,
      symbol,
    }
    if (!open) return [row]
    return [row, ...symbolPickerRows(children, expanded, depth + 1, id)]
  })
}

export function togglePickerBranch(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) {
    next.delete(key)
    return next
  }
  next.add(key)
  return next
}
