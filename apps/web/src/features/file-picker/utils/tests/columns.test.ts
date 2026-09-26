import { expect, test } from '../../../../../test/fixtures'

import type { FsEntry } from '@/lib/file-system-types'
import {
  columnFolders,
  deepestPickable,
  initialTrail,
  pickerView,
  selectInColumn,
  shownPickerView,
} from '@/features/file-picker/utils/columns'

function entry(path: string, type: 'directory' | 'file'): FsEntry {
  return { name: path.split('/').at(-1)!, path, type } as FsEntry
}

const src = entry('repo/src', 'directory')
const lib = entry('repo/src/lib', 'directory')
const app = entry('repo/src/lib/app.ts', 'file')

test('each selected folder opens the next column, and a file ends the path', () => {
  expect(columnFolders('repo', [])).toEqual(['repo'])
  expect(columnFolders('repo', [src, lib, app])).toEqual(['repo', 'repo/src', 'repo/src/lib'])
  expect(columnFolders('repo/src', [src, lib])).toEqual(['repo/src'])
})

test('selecting in a column closes the columns after it', () => {
  expect(selectInColumn([src, lib, app], 1, entry('repo/src/other', 'directory'))).toEqual([
    src,
    entry('repo/src/other', 'directory'),
  ])
})

test('the deepest pickable entry skips a file past the folder the user drilled into', () => {
  expect(deepestPickable([src, lib, app], 'folder')).toBe(lib)
  expect(deepestPickable([src, lib, app], 'file')).toBe(app)
  expect(deepestPickable([src, lib, app], 'file', ['.md'])).toBeNull()
  expect(deepestPickable([], 'folder')).toBeNull()
})

test('only a selection inside the current folder seeds the columns', () => {
  expect(initialTrail('repo', src)).toEqual([src])
  expect(initialTrail('repo', app)).toEqual([])
  expect(initialTrail('repo', null)).toEqual([])
})

test('auto picks columns for folders and a list for files; search and a narrow dialog use the list', () => {
  expect(pickerView('auto', 'folder')).toBe('columns')
  expect(pickerView('auto', 'file')).toBe('list')
  expect(pickerView('list', 'folder')).toBe('list')
  expect(shownPickerView('columns', true, 900)).toBe('list')
  expect(shownPickerView('columns', false, 300)).toBe('list')
  expect(shownPickerView('columns', false, 900)).toBe('columns')
  expect(shownPickerView('icons', false, 300)).toBe('icons')
  expect(shownPickerView('icons', true, 900)).toBe('list')
})
