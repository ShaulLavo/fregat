import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { formatSizeLabel, type FilePickerMode } from '@/features/file-picker/utils/model'
import type {
  FileListSortKey,
  FileListSortDirection,
} from '@/features/file-picker/utils/sort-entries'

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
    }

export function fileListRows(entries: FsEntry[], isSearching: boolean): FileListRow[] {
  if (!isSearching || !entries.some(hasSearchScope)) {
    return entries.map((entry, index) => ({
      kind: 'entry',
      key: entry.path,
      entry,
      position: index + 1,
      showPath: false,
    }))
  }

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

function searchResultSections(entries: FsEntry[]) {
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

export function fileListGridClass(mode: FilePickerMode) {
  if (mode === 'folder') {
    return 'grid-cols-[minmax(0,1fr)_116px_74px] max-sm:grid-cols-1'
  }

  return 'grid-cols-[minmax(0,1fr)_80px_116px_74px] max-sm:grid-cols-[minmax(0,1fr)_68px]'
}
