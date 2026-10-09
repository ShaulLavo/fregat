import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { formatSizeLabel } from '@/features/file-picker/utils/model'
import type {
  FileListSortKey,
  FileListSortDirection,
} from '@/features/file-picker/utils/sort-entries'

/** A name in a picker row, in the file tree's face and size at both densities. */
export const ENTRY_NAME_TEXT =
  'font-(family-name:--workbench-tree-font-family) text-(length:--workbench-tree-font-size)'

const compactModifiedFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export type FileListRow =
  | {
      kind: 'section'
      key: string
      label: string
    }
  | {
      kind: 'entry'
      key: string
      entry: FsEntry
      position: number
      showPath: boolean
      /** A recent folder leading the list, which a tap goes to wherever it lives. */
      recent: boolean
    }

/** Recent folders shown above the folder they lead, which `folder` names. */
export type LeadingRecents = {
  readonly entries: readonly FsEntry[]
  readonly folder: string
}

/** Enough recent folders to reach the usual ones without pushing the folder's own rows away. */
export const LEADING_RECENT_LIMIT = 5

/** The recent folders that lead a folder's rows, newest first. */
export function leadingRecentEntries(recents: readonly FsEntry[]) {
  return recents.slice(0, LEADING_RECENT_LIMIT)
}

export function fileListRows(
  entries: readonly FsEntry[],
  isSearching: boolean,
  recents: LeadingRecents | null = null,
): FileListRow[] {
  if (isSearching && entries.some(hasSearchScope)) return searchRows(entries)

  const leading = isSearching ? [] : (recents?.entries ?? [])
  const folderRows = entries.map((entry, index): FileListRow => ({
    kind: 'entry',
    key: entry.path,
    entry,
    position: leading.length + index + 1,
    showPath: false,
    recent: false,
  }))
  if (!recents || leading.length === 0) return folderRows

  return [
    { kind: 'section', key: 'section:recent', label: 'Recent' },
    ...leading.map((entry, index): FileListRow => ({
      kind: 'entry',
      key: `recent:${entry.path}`,
      entry,
      position: index + 1,
      showPath: true,
      recent: true,
    })),
    {
      kind: 'section',
      key: 'section:folder',
      label: entries.length > 0 ? `In ${recents.folder}` : `Nothing in ${recents.folder}`,
    },
    ...folderRows,
  ]
}

function searchRows(entries: readonly FsEntry[]): FileListRow[] {
  let position = 0
  return searchResultSections(entries).flatMap((section) => {
    if (section.entries.length === 0) return []

    return [
      {
        kind: 'section' as const,
        key: `section:${section.scope}`,
        label: section.label,
      },
      ...section.entries.map((entry) => {
        position += 1
        return {
          kind: 'entry' as const,
          key: `${section.scope}:${entry.path}`,
          entry,
          position,
          showPath: true,
          recent: false,
        }
      }),
    ]
  })
}

export function formatFileListModified(mtimeMs: number) {
  if (mtimeMs <= 0) return 'Unknown'

  return compactModifiedFormatter.format(new Date(mtimeMs))
}

export function fileListSizeLabel(entry: FsEntry) {
  if (isDirectoryEntry(entry)) return '--'

  return formatSizeLabel(entry)
}

export function sortButtonLabel(key: FileListSortKey, direction?: FileListSortDirection) {
  if (!direction) return `Sort by ${key}`

  return `Sort by ${key}, currently ${direction}`
}

function hasSearchScope(entry: FsEntry) {
  return entry.searchScope === 'current' || entry.searchScope === 'system'
}

function searchResultSections(entries: readonly FsEntry[]) {
  return [
    {
      scope: 'current' as const,
      label: 'Current folder',
      entries: entries.filter((entry) => entry.searchScope === 'current'),
    },
    {
      scope: 'system' as const,
      label: 'System-wide',
      entries: entries.filter((entry) => entry.searchScope === 'system'),
    },
  ]
}

export const FILE_LIST_GRID = 'grid-cols-[minmax(0,1fr)_116px_74px] max-sm:grid-cols-1'
