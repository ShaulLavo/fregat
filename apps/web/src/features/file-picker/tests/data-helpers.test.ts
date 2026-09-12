import { filesystemPath } from '@/lib/documents/utils/identity'
import {
  createPickerFolder,
  fetchRecentEntries,
  folderNameError,
  pickerFolderPath,
  recordRecent,
  visiblePickerEntries,
} from '@/features/file-picker/data-helpers'
import type { FsEntry } from '@/lib/file-system-types'

import { expect, test } from '../../../../test/fixtures'

test('hides dot-prefixed entries at any level below the current path', () => {
  const entries = [
    fileEntry('project/.env'),
    fileEntry('project/src/index.ts'),
    fileEntry('project/src/.generated/types.ts'),
  ]

  expect(visiblePickerEntries(entries, 'project', false).map((entry) => entry.path)).toEqual([
    'project/src/index.ts',
  ])
  expect(visiblePickerEntries(entries, 'project', true)).toEqual(entries)
})

test('does not treat an explicitly opened hidden parent as a hidden child', () => {
  const entries = [fileEntry('.config/settings.json'), fileEntry('.config/.private')]

  expect(visiblePickerEntries(entries, '.config', false).map((entry) => entry.path)).toEqual([
    '.config/settings.json',
  ])
})

test.each([
  ['', 'Enter a folder name.'],
  ['   ', 'Enter a folder name.'],
  ['.', 'Choose a folder name other than “.” or “..”.'],
  ['..', 'Choose a folder name other than “.” or “..”.'],
  ['nested/name', 'Folder names cannot contain path separators.'],
  ['nested\\name', 'Folder names cannot contain path separators.'],
  ['bad\0name', 'Folder names cannot contain null characters.'],
  ['a'.repeat(256), 'Folder names cannot exceed 255 bytes.'],
])('validates unsafe folder name %j', (name, expected) => {
  expect(folderNameError(name)).toBe(expected)
})

test('trims a valid folder name when building its path', () => {
  expect(folderNameError('.config')).toBeNull()
  expect(pickerFolderPath('project', '  New Folder  ')).toBe('project/New Folder')
})

test('creates a non-recursive folder and reports duplicate names', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'project', recursive: true })

  await expect(
    createPickerFolder({ name: 'assets', parentPath: 'project' }),
  ).resolves.toMatchObject({
    name: 'assets',
    path: 'project/assets',
    type: 'directory',
    version: expect.any(String),
  })
  await expect(createPickerFolder({ name: 'assets', parentPath: 'project' })).rejects.toMatchObject(
    { code: 'ALREADY_EXISTS', status: 409 },
  )
})

test('records picked files as recents', async ({ client }) => {
  const response = await client.fs['create-file'].post({ content: '', path: 'recent.ts' })
  expect(response.error).toBeNull()

  await recordRecent(fileEntry('recent.ts'))

  const recents = await fetchRecentEntries('file', false, new AbortController().signal)
  expect(recents.map((recent) => recent.path)).toContain('recent.ts')
})

function fileEntry(path: string): FsEntry & { type: 'file' } {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 0,
    type: 'file',
    version: 'test',
  }
}
