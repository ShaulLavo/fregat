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
  expect(deepestPickable([src, lib, app])).toBe(lib)
  expect(deepestPickable([])).toBeNull()
})

test('only a selection inside the current folder seeds the columns', () => {
  expect(initialTrail('repo', src)).toEqual([src])
  expect(initialTrail('repo', app)).toEqual([])
  expect(initialTrail('repo', null)).toEqual([])
})

test('auto picks columns; search and a narrow dialog use the list', () => {
  expect(pickerView('auto')).toBe('columns')
  expect(pickerView('list')).toBe('list')
  expect(shownPickerView('columns', true, 900)).toBe('list')
  expect(shownPickerView('columns', false, 260)).toBe('list')
  expect(shownPickerView('columns', false, 320)).toBe('columns')
  expect(shownPickerView('columns', false, 900)).toBe('columns')
  expect(shownPickerView('icons', false, 300)).toBe('icons')
  expect(shownPickerView('icons', true, 900)).toBe('list')
})
