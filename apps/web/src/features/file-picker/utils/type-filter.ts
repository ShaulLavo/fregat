import { fileMatchesAccept } from '@/lib/file-icons'
import { isDirectoryEntry, type FsEntry } from '@/lib/file-system-types'
import type { FilePickerMode } from '@/features/file-picker/utils/model'

export function pickerAccept(accept: readonly string[] | undefined, selected: string) {
  return selected && accept?.includes(selected) ? [selected] : accept
}

export function typeFilterOptions(accept: readonly string[]) {
  const types = [...new Set(accept)]
  const group = { value: '', label: `Supported files (${types.join(', ')})` }
  return types.length > 1 ? [group, ...types.map((value) => ({ value, label: value }))] : [group]
}

export function filterPickerEntries(
  entries: FsEntry[],
  mode: FilePickerMode,
  accept?: readonly string[],
) {
  if (mode !== 'file' || !accept?.length) return entries
  return entries.filter((entry) => isDirectoryEntry(entry) || fileMatchesAccept(entry.name, accept))
}

export function filterPickerTrail(trail: readonly FsEntry[], accept?: readonly string[]) {
  const hidden = trail.findIndex(
    (entry) => !isDirectoryEntry(entry) && !fileMatchesAccept(entry.name, accept),
  )
  return hidden === -1 ? trail : trail.slice(0, hidden)
}
