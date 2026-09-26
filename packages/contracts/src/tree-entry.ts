export type EntryTypeFilter = 'file' | 'directory' | 'symlink' | 'other'

export type EntryTypeCarrier = {
  type: EntryTypeFilter
  targetType?: EntryTypeFilter
}

export interface FileSystemEntryMetadata extends EntryTypeCarrier {
  /** Canonical root-relative spelling when the server can resolve the entry. */
  canonicalPath?: string
  path: string
  size: number
  mtimeMs: number
  birthtimeMs: number
  version: string
}

export interface TreeEntry extends FileSystemEntryMetadata {
  name: string
}

export type FileTreeEntry = TreeEntry & {
  children?: FileTreeEntry[]
}

export type FileTreeResult = {
  path: string
  entries: FileTreeEntry[]
}

export function effectiveEntryType(entry: EntryTypeCarrier): EntryTypeFilter {
  return entry.targetType ?? entry.type
}

export function isDirectoryEntry(entry: EntryTypeCarrier) {
  return effectiveEntryType(entry) === 'directory'
}

export function isFileEntry(entry: EntryTypeCarrier) {
  return effectiveEntryType(entry) === 'file'
}

export function matchesEntryType(entry: EntryTypeCarrier, entryType?: EntryTypeFilter) {
  if (!entryType) return true
  if (entry.type === entryType) return true

  return entry.targetType === entryType
}

/** A pickable entry resolves to a file or directory, following a symlink's target type. */
export function isPickableEntry(entry: EntryTypeCarrier) {
  const type = effectiveEntryType(entry)
  return type === 'directory' || type === 'file'
}
