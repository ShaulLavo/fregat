import { parentPath } from '@/lib/path-formatters'
import type { FsEntry, PickedFsEntry } from '@/lib/file-system-types'
import {
  effectiveEntryType,
  isDirectoryEntry,
  isFileEntry,
  isPickedFsEntry,
} from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'

export { basename, displayPath } from '@/lib/path-formatters'
import { compareFuzzyRankedTargets } from '@workspace/contracts'

export type EntriesLoadState = LoadState<readonly FsEntry[]>

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

export const ROOT_PATH = ''

const modifiedDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export const PICKER_COPY = {
  title: 'Choose folder',
  chooseLabel: 'Open',
  searchLabel: 'Search folders',
  searchPlaceholder: 'Search folders',
  emptyDescription: 'This folder has no visible folders.',
  emptyPreviewTitle: 'Select a folder',
  noSelectionLabel: 'No folder selected',
  listLabel: 'Folders',
} as const

/** Choosing files to attach: folders still list, so the person can walk into them. */
export const FILES_PICKER_COPY = {
  title: 'Choose files',
  searchLabel: 'Search files and folders',
  searchPlaceholder: 'Search files and folders',
  emptyDescription: 'This folder has no visible files or folders.',
  listLabel: 'Files and folders',
} as const

/** The words a list needs: its accessible name and what an empty folder says. */
export type PickerListCopy = { readonly emptyDescription: string; readonly listLabel: string }

/** Names what the commit button does: attach the files chosen so far. */
export function attachLabel(count: number) {
  if (count === 0) return 'Attach'
  return `Attach ${count} ${count === 1 ? 'file' : 'files'}`
}

/** Names the chosen files, or says how many may be chosen when none are. */
export function chosenSummaryLabel(chosen: readonly FsEntry[], limit: number) {
  if (chosen.length === 0) return `Choose up to ${limit} ${limit === 1 ? 'file' : 'files'}`
  const names = chosen.map((entry) => entry.name).join(', ')
  if (chosen.length < limit) return names
  return `${names} (the most this message holds)`
}

/** Adds or removes a file, in choice order. A full set takes no more; folders never join. */
export function toggleChosen(
  chosen: readonly FsEntry[],
  entry: FsEntry,
  limit: number,
): readonly FsEntry[] {
  if (!isFileEntry(entry)) return chosen
  if (chosen.some((item) => item.path === entry.path))
    return chosen.filter((item) => item.path !== entry.path)
  if (chosen.length >= limit) return chosen

  return chosen.concat([entry])
}

/** The folder picker lists folders only; a search or listing may still return files. */
export function folderEntries(entries: readonly FsEntry[]) {
  return entries.filter(isDirectoryEntry)
}

export function entryByOffset(
  entries: readonly FsEntry[],
  selectedEntry: FsEntry | null,
  offset: number,
) {
  if (entries.length === 0) return null

  const currentIndex = entries.findIndex((entry) => entry.path === selectedEntry?.path)
  const nextIndex = nextSelectionIndex(currentIndex, offset, entries.length)
  return entries[nextIndex] ?? null
}

export function toPickedEntry(entry: FsEntry | null): PickedFsEntry | null {
  if (!entry || !isDirectoryEntry(entry) || !isPickedFsEntry(entry)) return null

  return entry
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
