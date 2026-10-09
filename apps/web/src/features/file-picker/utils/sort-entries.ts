import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'

export type FileListSortKey = 'name' | 'modified'
export type FileListSortDirection = 'ascending' | 'descending'

export type FileListSort = {
  direction: FileListSortDirection
  key: FileListSortKey
}

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function sortFilePickerEntries(entries: readonly FsEntry[], sort: FileListSort) {
  return entries.toSorted((first, second) => compareEntries(first, second, sort))
}

function compareEntries(first: FsEntry, second: FsEntry, sort: FileListSort) {
  if (sort.key === 'name') {
    const directoryOrder = compareDirectoryOrder(first, second)
    if (directoryOrder !== 0) return directoryOrder
  }

  const primaryOrder = comparePrimaryValue(first, second, sort.key)
  if (primaryOrder !== 0) return applyDirection(primaryOrder, sort.direction)

  const nameOrder = textCollator.compare(first.name, second.name)
  if (nameOrder !== 0) return nameOrder

  return first.path.localeCompare(second.path)
}

function comparePrimaryValue(first: FsEntry, second: FsEntry, key: FileListSortKey) {
  if (key === 'name') return textCollator.compare(first.name, second.name)
  return first.mtimeMs - second.mtimeMs
}

function compareDirectoryOrder(first: FsEntry, second: FsEntry) {
  const firstRank = isDirectoryEntry(first) ? 0 : 1
  const secondRank = isDirectoryEntry(second) ? 0 : 1

  return firstRank - secondRank
}

function applyDirection(order: number, direction: FileListSortDirection) {
  if (direction === 'ascending') return order

  return -order
}
