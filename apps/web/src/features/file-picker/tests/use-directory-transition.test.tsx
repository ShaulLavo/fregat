import { createTestQueryClient } from '../../../../test/render'
import { type QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { useState, type ReactNode } from 'react'

import { expect, test } from '../../../../test/fixtures'
import type { DirectoryLoadData } from '@/features/file-picker/utils/data-helpers'
import { useDirectoryTransition } from '@/features/file-picker/hooks/use-directory-transition'
import { filePickerKeys } from '@/lib/query-keys'

test('prefetch and load reuse the exact base-directory cache entry', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'target', recursive: true })
  await client.fs['create-file'].post({ path: 'target/readme.md' })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useDirectoryTransition({
        currentPath: 'current',
        enabled: true,
        mode: 'file',
        showHidden: false,
      }),
    { wrapper: queryClientWrapper(queryClient) },
  )
  const queryKey = filePickerKeys.directory('target', '', 'file', false)
  const prefetch = result.current.preloadDirectory('target')

  expect(prefetch).toBeInstanceOf(Promise)
  await act(async () => {
    await prefetch
  })

  expect(queryClient.getQueryData<DirectoryLoadData>(queryKey)).toMatchObject({
    currentEntry: { path: 'target' },
    entries: [expect.objectContaining({ path: 'target/readme.md' })],
  })
  expect(
    queryClient.getQueryCache().findAll({ queryKey: filePickerKeys.directories() }),
  ).toHaveLength(1)
  const updatesAfterPrefetch = dataUpdateCount(queryClient, queryKey)

  let loaded = false
  await act(async () => {
    loaded = await result.current.loadDirectory('target')
  })

  expect(loaded).toBe(true)
  expect(dataUpdateCount(queryClient, queryKey)).toBe(updatesAfterPrefetch)
  queryClient.clear()
})

test('changes the path only after the destination has loaded successfully', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'current', recursive: true })
  await client.fs['create-folder'].post({ path: 'target', recursive: true })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(() => useGatedDirectoryPath('current'), {
    wrapper: queryClientWrapper(queryClient),
  })
  const navigation = result.current.navigate('target')

  expect(result.current.currentPath).toBe('current')

  let loaded = false
  await act(async () => {
    loaded = await navigation
  })

  expect(loaded).toBe(true)
  expect(result.current.currentPath).toBe('target')
  queryClient.clear()
})

test('leaves the path unchanged when the destination cannot load', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'current', recursive: true })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(() => useGatedDirectoryPath('current'), {
    wrapper: queryClientWrapper(queryClient),
  })
  const navigation = result.current.navigate('missing')

  expect(result.current.currentPath).toBe('current')

  let loaded = true
  await act(async () => {
    loaded = await navigation
  })

  expect(loaded).toBe(false)
  expect(result.current.currentPath).toBe('current')
  queryClient.clear()
})

test('allows only the latest overlapping load to succeed', async ({ client }) => {
  await client.fs['create-folder'].post({ path: 'first', recursive: true })
  await client.fs['create-folder'].post({ path: 'second', recursive: true })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useDirectoryTransition({
        currentPath: 'current',
        enabled: true,
        mode: 'folder',
        showHidden: false,
      }),
    { wrapper: queryClientWrapper(queryClient) },
  )
  const firstLoad = result.current.loadDirectory('first')
  const secondLoad = result.current.loadDirectory('second')
  let outcomes: boolean[] = []

  await act(async () => {
    outcomes = await Promise.all([firstLoad, secondLoad])
  })

  expect(outcomes).toEqual([false, true])
  queryClient.clear()
})

test('rejects an older intent that reaches loading after a newer navigation', async ({
  client,
}) => {
  await client.fs['create-folder'].post({ path: 'older', recursive: true })
  await client.fs['create-folder'].post({ path: 'newer', recursive: true })

  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useDirectoryTransition({
        currentPath: 'current',
        enabled: true,
        mode: 'folder',
        showHidden: false,
      }),
    { wrapper: queryClientWrapper(queryClient) },
  )
  const olderIntent = result.current.beginDirectoryIntent()
  const newerLoad = result.current.loadDirectory('newer')
  const delayedOlderLoad = result.current.loadDirectory('older', olderIntent)
  let outcomes: boolean[] = []

  await act(async () => {
    outcomes = await Promise.all([delayedOlderLoad, newerLoad])
  })

  expect(outcomes).toEqual([false, true])
  expect(
    queryClient.getQueryState(filePickerKeys.directory('older', '', 'folder', false)),
  ).toBeUndefined()
  queryClient.clear()
})

function useGatedDirectoryPath(initialPath: string) {
  const [currentPath, setCurrentPath] = useState(initialPath)
  const transition = useDirectoryTransition({
    currentPath,
    enabled: true,
    mode: 'folder',
    showHidden: false,
  })

  async function navigate(path: string) {
    const loaded = await transition.loadDirectory(path)
    if (!loaded) return false

    setCurrentPath(path)
    return true
  }

  return { currentPath, navigate }
}

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function dataUpdateCount(queryClient: QueryClient, queryKey: QueryKey) {
  return queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0
}
