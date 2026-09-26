import { parentPath } from '@/lib/path-formatters'
import { fileMatchesAccept } from '@/lib/file-icons'
import type { FsEntry, PickedFsEntry } from '@/lib/file-system-types'
import { effectiveEntryType, isDirectoryEntry, isFileEntry } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'
import { formatSize } from '@/lib/path-formatters'

export { basename, displayPath, formatSize } from '@/lib/path-formatters'
import { compareFuzzyRankedTargets } from '@workspace/contracts'

export type EntriesLoadState = LoadState<FsEntry[]>

export type DirectoryFsEntry = FsEntry &
  (
    | {
        type: 'directory'
      }
    | {
        targetType: 'directory'
        type: 'symlink'
      }
  )

export type FilePickerMode = 'folder' | 'file'

export const ROOT_PATH = ''

const modifiedDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function pickerCopy(mode: FilePickerMode) {
  if (mode === 'file') {
    return {
      title: 'Choose file',
      chooseLabel: 'Choose file',
      searchLabel: 'Search files',
      searchPlaceholder: 'Search files',
      emptyDescription: 'This folder has no visible files or folders.',
      emptyPreviewTitle: 'Select a file',
      noSelectionLabel: 'No file selected',
    }
  }

  return {
    title: 'Choose folder',
    chooseLabel: 'Choose folder',
    searchLabel: 'Search files and folders',
    searchPlaceholder: 'Search files and folders',
    emptyDescription: 'This folder has no visible files or folders.',
    emptyPreviewTitle: 'Select a folder',
    noSelectionLabel: 'No folder selected',
  }
}

export function listLabel(mode: FilePickerMode) {
  if (mode === 'file') return 'Files and folders'

  return 'Folders and files'
}

export function entryByOffset(entries: FsEntry[], selectedEntry: FsEntry | null, offset: number) {
  if (entries.length === 0) return null

  const currentIndex = entries.findIndex((entry) => entry.path === selectedEntry?.path)
  const nextIndex = nextSelectionIndex(currentIndex, offset, entries.length)
  return entries[nextIndex] ?? null
}

export function toPickedEntry(
  entry: FsEntry | null,
  mode: FilePickerMode,
  accept?: readonly string[],
): PickedFsEntry | null {
  if (!entry) return null
  if (!isPickableEntry(entry, mode, accept)) return null

  return entry
}

export function currentPickableEntry(
  entry: DirectoryFsEntry | null,
  mode: FilePickerMode,
): PickedFsEntry | null {
  if (mode !== 'folder') return null

  return entry
}

export function isPickableEntry(
  entry: FsEntry,
  mode: FilePickerMode,
  accept?: readonly string[],
): entry is PickedFsEntry {
  if (mode === 'folder') return isDirectoryEntry(entry)
  if (!isFileEntry(entry)) return false

  return fileMatchesAccept(entry.name, accept)
}

// Picker paths are root-relative and collapse repeated separators before navigating up.
export function pickerParentPath(path: string) {
  return parentPath(path.split('/').filter(Boolean).join('/'))
}

export function pathCrumbs(path: string) {
  const parts = path.split('/').filter(Boolean)
  const crumbs = [{ label: 'Root', path: ROOT_PATH }]
  let current = ROOT_PATH

  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    crumbs.push({ label: part, path: current })
  }

  return crumbs
}

export function initialPathForOpen(selectedValue: PickedFsEntry | null, homePath: string) {
  if (!selectedValue) return homePath

  return pickerParentPath(selectedValue.path)
}

export function joinPaths(parent: string, child: string) {
  if (!parent) return child

  return `${parent}/${child}`
}

function compareEntries(a: FsEntry, b: FsEntry) {
  const aType = effectiveEntryType(a)
  const bType = effectiveEntryType(b)
  if (aType === 'directory' && bType !== 'directory') return -1
  if (aType !== 'directory' && bType === 'directory') return 1

  return a.name.localeCompare(b.name)
}

export function compareSearchEntries(query: string) {
  return (a: FsEntry, b: FsEntry) =>
    compareFuzzyRankedTargets(entryRankTarget(a), entryRankTarget(b), query) || compareEntries(a, b)
}

export function kindLabel(entry: FsEntry) {
  if (entry.type === 'symlink' && entry.targetType === 'directory') {
    return 'Alias folder'
  }
  if (entry.type === 'symlink' && entry.targetType === 'file') {
    return 'Alias file'
  }
  if (isDirectoryEntry(entry)) return 'Folder'
  if (isFileEntry(entry)) return 'File'
  if (entry.type === 'symlink') return 'Alias'

  return 'Other'
}

export function formatSizeLabel(entry: FsEntry) {
  if (isDirectoryEntry(entry)) return ''

  return formatSize(entry.size)
}

export function formatModified(mtimeMs: number) {
  if (mtimeMs <= 0) return 'Unknown'

  return modifiedDateFormatter.format(new Date(mtimeMs))
}

export function loadStateEntries(state: EntriesLoadState) {
  if (state.status === 'ready') return state.data
  if (state.status === 'loading') return state.data ?? []

  return []
}

export function loadingLoadState(previous: EntriesLoadState): EntriesLoadState {
  const entries = loadStateEntries(previous)
  if (entries.length === 0) return { status: 'loading' }

  return { status: 'loading', data: entries }
}

function nextSelectionIndex(currentIndex: number, offset: number, length: number) {
  if (currentIndex < 0 && offset > 0) return Math.min(offset - 1, length - 1)
  if (currentIndex < 0) return Math.max(length + offset, 0)

  return Math.min(Math.max(currentIndex + offset, 0), length - 1)
}

function entryRankTarget(entry: FsEntry) {
  return {
    label: entry.name,
    path: entry.path,
  }
}
