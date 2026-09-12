import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import { expect, test } from '../../../../../test/fixtures'

import { sortFilePickerEntries } from '@/features/file-picker/utils/sort-entries'

test('sorts names naturally while keeping directories first in both directions', () => {
  const entries = [
    entry('file-10', 'file'),
    entry('folder-2', 'directory'),
    entry('file-2', 'file'),
  ]

  expect(
    sortFilePickerEntries(entries, { direction: 'ascending', key: 'name' }).map(
      (item) => item.name,
    ),
  ).toEqual(['folder-2', 'file-2', 'file-10'])
  expect(
    sortFilePickerEntries(entries, { direction: 'descending', key: 'name' }).map(
      (item) => item.name,
    ),
  ).toEqual(['folder-2', 'file-10', 'file-2'])
})

test('uses names and paths as deterministic tie-breaks for value sorts', () => {
  const entries = [
    entry('same', 'file', { path: filesystemPath('b/same'), size: 20 }),
    entry('zeta', 'file', { size: 10 }),
    entry('alpha', 'file', { size: 10 }),
    entry('same', 'file', { path: filesystemPath('a/same'), size: 20 }),
  ]

  expect(
    sortFilePickerEntries(entries, { direction: 'ascending', key: 'size' }).map(
      (item) => item.path,
    ),
  ).toEqual(['alpha', 'zeta', 'a/same', 'b/same'])
  expect(entries.map((item) => item.path)).toEqual(['b/same', 'zeta', 'alpha', 'a/same'])
})

function entry(name: string, type: FsEntry['type'], overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name,
    path: filesystemPath(name),
    size: 0,
    type,
    version: 'test',
    ...overrides,
  }
}
