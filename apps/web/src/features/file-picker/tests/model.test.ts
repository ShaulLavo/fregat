import { filesystemPath } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'

import {
  attachLabel,
  chosenSummaryLabel,
  entryByOffset,
  toggleChosen,
} from '@/features/file-picker/utils/model'
import type { FsEntry } from '@/lib/file-system-types'

const entries = Array.from({ length: 20 }, (_, index) => entry(index))

test('moves by a full page when the list has no active option', () => {
  expect(entryByOffset(entries, null, 8)?.path).toBe('entry-7')
  expect(entryByOffset(entries, null, -8)?.path).toBe('entry-12')
})

test('chooses files in order, takes one out on a second toggle, and stops at the limit', () => {
  const [first, second, third] = entries as [FsEntry, FsEntry, FsEntry]
  const two = toggleChosen(toggleChosen([], first, 2), second, 2)
  expect(two.map((item) => item.name)).toEqual(['entry-0', 'entry-1'])
  expect(toggleChosen(two, third, 2)).toBe(two)
  expect(toggleChosen(two, first, 2).map((item) => item.name)).toEqual(['entry-1'])
})

test('never chooses a folder', () => {
  const folder: FsEntry = { ...entry(0), name: 'src', type: 'directory' }
  const chosen: readonly FsEntry[] = []
  expect(toggleChosen(chosen, folder, 8)).toBe(chosen)
})

test('names the commit and the chosen files in plain words', () => {
  expect(attachLabel(0)).toBe('Attach')
  expect(attachLabel(1)).toBe('Attach 1 file')
  expect(attachLabel(3)).toBe('Attach 3 files')
  expect(chosenSummaryLabel([], 8)).toBe('Choose up to 8 files')
  expect(chosenSummaryLabel(entries.slice(0, 2), 8)).toBe('entry-0, entry-1')
  expect(chosenSummaryLabel(entries.slice(0, 2), 2)).toBe(
    'entry-0, entry-1 (the most this message holds)',
  )
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
