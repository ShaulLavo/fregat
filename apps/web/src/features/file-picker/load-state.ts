import type { FsEntry } from '@/lib/file-system-types'
import type { UseQueryResult } from '@tanstack/react-query'

import { errorMessage } from '@/lib/error-message'
import { loadingLoadState, type EntriesLoadState } from '@/features/file-picker/model'

import type { DirectoryLoadData } from '@/features/file-picker/data-helpers'

export function directoryLoadState(
  query: UseQueryResult<DirectoryLoadData>,
  enabled: boolean,
): EntriesLoadState {
  if (!enabled) return { status: 'loading' }
  if (query.isError)
    return {
      status: 'error',
      message: errorMessage(query.error, 'The file server did not return a usable response.'),
    }
  if (query.isPlaceholderData && query.data) {
    return loadingLoadState({ status: 'ready', data: query.data.entries })
  }
  if (query.data) return { status: 'ready', data: query.data.entries }
  if (query.isPending) return { status: 'loading' }

  return { status: 'idle' }
}

export function entriesLoadState(
  query: UseQueryResult<FsEntry[]>,
  enabled: boolean,
): EntriesLoadState {
  if (!enabled) return { status: 'loading' }
  if (query.isError)
    return {
      status: 'error',
      message: errorMessage(query.error, 'The file server did not return a usable response.'),
    }
  if (query.data) return { status: 'ready', data: query.data }
  if (query.isPending) return { status: 'loading' }

  return { status: 'idle' }
}
