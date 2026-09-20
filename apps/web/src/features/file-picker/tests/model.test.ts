import { filesystemPath } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'

import { entryByOffset } from '@/features/file-picker/utils/model'
import type { FsEntry } from '@/lib/file-system-types'

const entries = Array.from({ length: 20 }, (_, index) => entry(index))

test('moves by a full page when the list has no active option', () => {
  expect(entryByOffset(entries, null, 8)?.path).toBe('entry-7')
  expect(entryByOffset(entries, null, -8)?.path).toBe('entry-12')
})

function entry(index: number): FsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: `entry-${index}`,
    path: filesystemPath(`entry-${index}`),
    size: 0,
    type: 'file',
    version: 'test',
  }
}
