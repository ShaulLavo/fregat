import { filesystemPath } from '@/lib/documents/utils/identity'
import { QueryClient } from '@tanstack/react-query'

import { expect, test } from '../../../../../test/fixtures'
import type { DirectoryLoadData } from '@/features/file-picker/data-helpers'
import type { DirectoryFsEntry } from '@/features/file-picker/model'
import { writeStreamedDirectoryEntries } from '@/features/file-picker/utils/directory-query'
import type { FsEntry } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'

test('keeps streamed search prefixes stale and preserves the folder preview', () => {
  const queryClient = new QueryClient()
  const baseQueryKey = filePickerKeys.directory('project', '', 'file', false)
  const searchQueryKey = filePickerKeys.directory('project', 'read', 'file', false)
  const currentEntry = directoryEntry('project')
  const match = fileEntry('project/readme.md')

  queryClient.setQueryData<DirectoryLoadData>(baseQueryKey, {
    currentEntry,
    entries: [],
  })
  writeStreamedDirectoryEntries({
    baseQueryKey,
    entries: [match],
    queryClient,
    queryKey: searchQueryKey,
  })

  expect(queryClient.getQueryData<DirectoryLoadData>(searchQueryKey)).toEqual({
    currentEntry,
    entries: [match],
  })
  expect(queryClient.getQueryState(searchQueryKey)?.dataUpdatedAt).toBe(0)
  queryClient.clear()
})

function directoryEntry(path: string): DirectoryFsEntry {
  return { ...entryFields(path), type: 'directory' }
}

function fileEntry(path: string): FsEntry {
  return { ...entryFields(path), type: 'file' }
}

function entryFields(path: string) {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 0,
    version: '1',
  }
}
