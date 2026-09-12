import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FsEntry } from '@/lib/file-system-types'
import { expect, test } from '../../../../../test/fixtures'

import { fileListAvailabilityLabel } from '@/features/file-picker/utils/availability'

test('describes unpickable rows by their available interaction', () => {
  expect(fileListAvailabilityLabel(entry('folder', 'directory'), 'file', false)).toBe(
    'Open to browse; cannot be chosen.',
  )
  expect(fileListAvailabilityLabel(entry('notes.txt', 'file'), 'folder', false)).toBe(
    'Preview only; cannot be chosen.',
  )
  expect(fileListAvailabilityLabel(entry('notes.txt', 'file'), 'file', true)).toBeNull()
})

function entry(name: string, type: FsEntry['type']): FsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name,
    path: filesystemPath(name),
    size: 0,
    type,
    version: 'test',
  }
}
