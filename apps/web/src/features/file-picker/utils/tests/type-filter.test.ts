import { expect, test } from 'vitest'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import {
  filterPickerEntries,
  filterPickerTrail,
  pickerAccept,
  typeFilterOptions,
} from '../type-filter'

function entry(name: string, type: FsEntry['type'] = 'file'): FsEntry {
  return {
    name,
    type,
    path: filesystemPath(name),
    size: 0,
    mtimeMs: 0,
    birthtimeMs: 0,
    version: 'test',
  }
}

test('filters accepted types while retaining navigable folders', () => {
  const entries = [
    entry('src', 'directory'),
    entry('code.ts'),
    entry('notes.md'),
    entry('photo.png'),
  ]
  expect(filterPickerEntries(entries, 'file', ['.ts', '.md']).map((item) => item.name)).toEqual([
    'src',
    'code.ts',
    'notes.md',
  ])
  expect(
    filterPickerEntries(entries, 'file', pickerAccept(['.ts', '.md'], '.md')).map(
      (item) => item.name,
    ),
  ).toEqual(['src', 'notes.md'])
  expect(filterPickerEntries(entries, 'folder', ['.md'])).toEqual(entries)
})

test('a stale choice cannot broaden the caller constraint', () => {
  expect(pickerAccept(['.md'], '.png')).toEqual(['.md'])
  expect(pickerAccept(['image/*', '.md'], 'image/*')).toEqual(['image/*'])
  expect(typeFilterOptions(['.md', '.md', 'image/*'])).toEqual([
    { value: '', label: 'Supported files (.md, image/*)' },
    { value: '.md', label: '.md' },
    { value: 'image/*', label: 'image/*' },
  ])
})

test('narrowing a type prunes a selected leaf while retaining its folder trail', () => {
  const folder = entry('src', 'directory')
  const trail = [folder, entry('code.ts')]
  expect(filterPickerTrail(trail, ['.md'])).toEqual([folder])
  expect(filterPickerTrail(trail, ['.ts'])).toBe(trail)
})
