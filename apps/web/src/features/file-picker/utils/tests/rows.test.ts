import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import { expect, test } from '../../../../../test/fixtures'

import { fileListRows, LEADING_RECENT_LIMIT } from '@/features/file-picker/utils/rows'

const folder = (path: string): FsEntry => ({
  birthtimeMs: 0,
  mtimeMs: 0,
  name: path.split('/').at(-1) ?? path,
  path: filesystemPath(path),
  size: 0,
  type: 'directory',
  version: 'test',
})

test('leads a folder with its recent folders, each showing where it lives', () => {
  const rows = fileListRows([folder('/home/me/alpha'), folder('/home/me/beta')], false, {
    entries: [folder('/work/platform'), folder('/home/me/alpha')],
    folder: 'me',
  })

  expect(rows.map((row) => (row.kind === 'section' ? `# ${row.label}` : row.key))).toEqual([
    '# Recent',
    'recent:/work/platform',
    'recent:/home/me/alpha',
    '# In me',
    '/home/me/alpha',
    '/home/me/beta',
  ])
  const entries = rows.filter((row) => row.kind === 'entry')
  expect(entries.map((row) => [row.position, row.recent, row.showPath])).toEqual([
    [1, true, true],
    [2, true, true],
    [3, false, false],
    [4, false, false],
  ])
})

test('caps the recent folders above a folder', () => {
  const recents = Array.from({ length: LEADING_RECENT_LIMIT + 3 }, (_, index) =>
    folder(`/recent/${index}`),
  )
  const rows = fileListRows([folder('/home/me/alpha')], false, { entries: recents, folder: 'me' })

  expect(rows.filter((row) => row.kind === 'entry' && row.recent)).toHaveLength(
    LEADING_RECENT_LIMIT,
  )
})

test('names an empty folder below its recent folders', () => {
  const rows = fileListRows([], false, { entries: [folder('/work/platform')], folder: 'empty' })

  expect(rows.at(-1)).toEqual({ kind: 'section', key: 'section:folder', label: 'Nothing in empty' })
})

test('lists only the folder without recent folders or while searching', () => {
  const entries = [folder('/home/me/alpha')]
  const recents = { entries: [folder('/work/platform')], folder: 'me' }

  expect(fileListRows(entries, false, { entries: [], folder: 'me' }).map((row) => row.key)).toEqual(
    ['/home/me/alpha'],
  )
  expect(fileListRows(entries, true, recents).map((row) => row.key)).toEqual(['/home/me/alpha'])
  expect(fileListRows(entries, false).map((row) => row.key)).toEqual(['/home/me/alpha'])
})
