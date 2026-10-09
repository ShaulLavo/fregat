import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { createError } from 'evlog'

import type { DirectoryLoadData } from '@/features/file-picker/utils/data-helpers'
import {
  directoryLoadState,
  entriesLoadState,
  leadingListState,
} from '@/features/file-picker/utils/load-state'
import type { FsEntry } from '@/lib/file-system-types'
import type { EntriesLoadState } from '@/features/file-picker/utils/model'
import { expect, test } from '../../../../test/fixtures'

test('directory and recent entries expose failed refreshes even when stale data remains', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const directory = new QueryObserver<DirectoryLoadData>(queryClient, {
    queryKey: ['directory'],
    initialData: { currentEntry: null, entries: [] },
    queryFn: async () => {
      throw createError('Read failed')
    },
  })
  const entries = new QueryObserver<FsEntry[]>(queryClient, {
    queryKey: ['entries'],
    initialData: [],
    queryFn: async () => {
      throw createError('Read failed')
    },
  })

  const [directoryQuery, entriesQuery] = await Promise.all([directory.refetch(), entries.refetch()])
  expect(directoryQuery.data).toBeDefined()
  expect(entriesQuery.data).toBeDefined()
  expect(directoryLoadState(directoryQuery, true)).toEqual({
    status: 'error',
    message: 'Read failed',
  })
  expect(entriesLoadState(entriesQuery, true)).toEqual({ status: 'error', message: 'Read failed' })
  queryClient.clear()
})

test('a list led by recent folders waits for both, and shows errors at once', () => {
  const ready: EntriesLoadState = { status: 'ready', data: [] }
  const loading: EntriesLoadState = { status: 'loading' }
  const failed: EntriesLoadState = {
    status: 'error',
    message: 'The file server did not return a usable response.',
  }

  expect(leadingListState(loading, ready, true)).toEqual({ pending: true, state: loading })
  expect(leadingListState(ready, loading, true)).toEqual({ pending: true, state: loading })
  expect(leadingListState(ready, ready, true)).toEqual({ pending: false, state: ready })
  // A server or folder failure is never hidden behind recents that cannot load.
  expect(leadingListState(failed, loading, true)).toEqual({ pending: false, state: failed })
  expect(leadingListState(ready, failed, true)).toEqual({ pending: false, state: ready })
  expect(leadingListState(loading, loading, false)).toEqual({ pending: false, state: loading })
  // A refresh keeps the rows it already has.
  const refreshing: EntriesLoadState = { status: 'loading', data: [] }
  expect(leadingListState(refreshing, ready, true)).toEqual({ pending: false, state: refreshing })
})
