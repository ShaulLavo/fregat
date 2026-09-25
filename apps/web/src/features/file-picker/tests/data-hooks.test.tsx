import { createTestQueryClient } from '../../../../test/render'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { expect, test } from '../../../../test/fixtures'
import type { EntriesLoadState } from '@/features/file-picker/utils/model'
import { useDirectoryLoad } from '@/features/file-picker/hooks/use-directory-load'
import { useRecentEntries } from '@/features/file-picker/hooks/use-recent-entries'
import type { ServerInfo } from '@/lib/file-system-types'
import { filePickerKeys } from '@/lib/query-keys'

const SERVER_INFO: ServerInfo = {
  defaultPath: '',
  homePath: '',
  maxTextFileBytes: 0,
  metadataDbPath: '',
  nativeWatcherCount: 0,
  openFileWatcherCount: 0,
  shallowWatcherCount: 0,
  systemRoot: '',
  watchEnabled: false,
  workspaceIndex: {
    entryCount: 0,
    fileCount: 0,
    pendingCreatedPathCount: 0,
    readiness: 'ready',
    scanRoot: null,
    scanWarningCount: 0,
    skippedEntryCount: 0,
    staleEntryCount: 0,
  },
  workspaceRoot: '',
}

test('keeps placeholders within one directory and never carries them across navigation', async ({
  client,
}) => {
  await client.fs['create-folder'].post({ path: 'first', recursive: true })
  await client.fs['create-file'].post({ path: 'first/first.ts' })
  await client.fs['create-folder'].post({ path: 'second', recursive: true })
  await client.fs['create-file'].post({ path: 'second/second.ts' })

  const queryClient = createTestQueryClient()
  const { result, rerender } = renderHook(
    ({ currentPath, effectiveQuery }: { currentPath: string; effectiveQuery: string }) =>
      useDirectoryLoad({
        currentPath,
        effectiveQuery,
        mode: 'file',
        open: true,
        serverInfo: SERVER_INFO,
        showHidden: false,
      }),
    {
      initialProps: { currentPath: 'first', effectiveQuery: '' },
      wrapper: queryClientWrapper(queryClient),
    },
  )

  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual(['first/first.ts']))

  rerender({ currentPath: 'second', effectiveQuery: '' })

  expect(result.current.currentEntry).toBeNull()
  expect(result.current.loadState).toEqual({ status: 'loading' })

  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual(['second/second.ts']))

  rerender({ currentPath: 'second', effectiveQuery: 'no-matches-for-this-query' })

  expect(result.current.currentEntry?.path).toBe('second')
  expect(result.current.loadState).toEqual({
    status: 'loading',
    data: [expect.objectContaining({ path: 'second/second.ts' })],
  })
  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual([]))
  queryClient.clear()
})

test('refreshes the current directory without growing the query cache', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'project', recursive: true })
  await client.fs['create-file'].post({ path: 'project/one.ts' })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useDirectoryLoad({
        currentPath: 'project',
        effectiveQuery: '',
        mode: 'file',
        open: true,
        serverInfo: SERVER_INFO,
        showHidden: false,
      }),
    { wrapper: queryClientWrapper(queryClient) },
  )

  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual(['project/one.ts']))
  await client.fs['create-file'].post({ path: 'project/two.ts' })

  await act(async () => {
    await result.current.refresh()
  })

  await waitFor(() =>
    expect(entryPaths(result.current.loadState)).toEqual(['project/one.ts', 'project/two.ts']),
  )
  expect(
    queryClient.getQueryCache().findAll({ queryKey: filePickerKeys.directories() }),
  ).toHaveLength(1)
  queryClient.clear()
})

test('refreshes recents without growing the query cache', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'recent-folder', recursive: true })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useRecentEntries({
        mode: 'folder',
        open: true,
        serverInfo: SERVER_INFO,
        showHidden: false,
      }),
    { wrapper: queryClientWrapper(queryClient) },
  )

  await waitFor(() => expect(result.current.loadState.status).toBe('ready'))
  await client.fs.recents.post({ path: 'recent-folder' })

  await act(async () => {
    await result.current.refresh()
  })

  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual(['recent-folder']))
  expect(queryClient.getQueryCache().findAll({ queryKey: filePickerKeys.recents() })).toHaveLength(
    1,
  )
  queryClient.clear()
})

test('keys and filters recents by picker mode and hidden visibility', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'folder', recursive: true })
  await client.fs['create-folder'].post({ path: '.hidden-folder', recursive: true })
  await client.fs['create-file'].post({ path: 'file.ts' })
  for (const path of ['folder', '.hidden-folder', 'file.ts']) {
    await client.fs.recents.post({ path })
  }

  const queryClient = createTestQueryClient()
  const { result, rerender } = renderHook(
    ({ mode, showHidden }: { mode: 'file' | 'folder'; showHidden: boolean }) =>
      useRecentEntries({ mode, open: true, serverInfo: SERVER_INFO, showHidden }),
    {
      initialProps: { mode: 'folder' as 'file' | 'folder', showHidden: false },
      wrapper: queryClientWrapper(queryClient),
    },
  )

  await waitFor(() => expect(entryPaths(result.current.loadState)).toEqual(['folder']))

  rerender({ mode: 'folder', showHidden: true })
  await waitFor(() =>
    expect(entryPaths(result.current.loadState).sort()).toEqual(['.hidden-folder', 'folder']),
  )

  rerender({ mode: 'file', showHidden: true })
  await waitFor(() =>
    expect(entryPaths(result.current.loadState).sort()).toEqual([
      '.hidden-folder',
      'file.ts',
      'folder',
    ]),
  )
  expect(queryClient.getQueryCache().findAll({ queryKey: filePickerKeys.recents() })).toHaveLength(
    3,
  )
  queryClient.clear()
})

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function entryPaths(state: EntriesLoadState) {
  if (state.status !== 'ready') return []

  return state.data.map((entry) => entry.path)
}
