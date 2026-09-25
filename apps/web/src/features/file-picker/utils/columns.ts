import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { pickerParentPath, type FilePickerMode } from '@/features/file-picker/utils/model'

/** The column narrower than this does not fit beside the places and the preview. */
const COLUMNS_MIN_WIDTH = 520

export type PickerViewSetting = 'auto' | 'columns' | 'list' | 'icons'
export type PickerView = 'columns' | 'list' | 'icons'

/** Auto means columns when choosing a folder, where the whole path matters, and a list for files. */
export function pickerView(setting: PickerViewSetting, mode: FilePickerMode): PickerView {
  if (setting !== 'auto') return setting
  return mode === 'folder' ? 'columns' : 'list'
}

/**
 * Search results are a flat set with no path to show, and a narrow dialog has no room for
 * columns; both fall back to the list.
 */
export function shownPickerView(
  view: PickerView,
  searching: boolean,
  width: number | null,
): PickerView {
  if (view === 'list' || searching) return 'list'
  if (view === 'icons') return 'icons'
  return width !== null && width < COLUMNS_MIN_WIDTH ? 'list' : 'columns'
}

/** The selection in each column, starting with the current folder's. */
export type ColumnTrail = readonly FsEntry[]

/** A selection only seeds the trail when it sits in the current folder. */
export function initialTrail(currentPath: string, selected: FsEntry | null): ColumnTrail {
  if (!selected || pickerParentPath(selected.path) !== currentPath) return []
  return [selected]
}

/**
 * Every column's folder: the current one, then each selected folder in turn. A trail left over
 * from another folder (a deferred render after navigating) stops where it no longer descends.
 */
export function columnFolders(currentPath: string, trail: ColumnTrail): readonly string[] {
  const folders = [currentPath]
  for (const entry of trail) {
    if (!isDirectoryEntry(entry) || pickerParentPath(entry.path) !== folders.at(-1)) break
    folders.push(entry.path)
  }
  return folders
}

/** Selecting in a column replaces that column's selection and closes every column after it. */
export function selectInColumn(trail: ColumnTrail, column: number, entry: FsEntry): ColumnTrail {
  return [...trail.slice(0, column), entry]
}
