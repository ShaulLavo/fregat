import { render } from '@testing-library/react'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import { EntryIcon } from '@/features/file-picker/components/entry-icon'
import { expect, test } from '../../../../test/fixtures'

const stamps = { size: 0, mtimeMs: 0, birthtimeMs: 0, version: 'test' }

function glyph(entry: FsEntry, open?: boolean) {
  const { container } = render(<EntryIcon entry={entry} open={open} />)
  return container.querySelector('svg')?.getAttribute('data-file-icon')
}

test('entries wear the glyphs the file tree gives them', () => {
  const folder: FsEntry = { ...stamps, name: 'src', path: filesystemPath('src'), type: 'directory' }
  const link: FsEntry = {
    ...stamps,
    name: 'linked',
    path: filesystemPath('linked'),
    type: 'symlink',
    targetType: 'directory',
  }
  const notes: FsEntry = {
    ...stamps,
    name: 'notes.md',
    path: filesystemPath('notes.md'),
    type: 'file',
  }

  expect(glyph(folder)).toBe('folder-duo')
  expect(glyph(folder, true)).toBe('folder-open-duo')
  expect(glyph(link)).toBe('file-symlink-duo')
  expect(glyph(notes)).toBe('markdown')
})
