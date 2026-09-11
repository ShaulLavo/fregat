import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { createError } from 'evlog'

import type { DirectoryLoadData } from '@/features/file-picker/data-helpers'
import { directoryLoadState, entriesLoadState } from '@/features/file-picker/load-state'
import type { FsEntry } from '@/lib/file-system-types'
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
