import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { fileSystemKeys } from '@/lib/query-keys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import { settingsTab } from '@/lib/documents/utils/tabs'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { useSelectedFile } from '@/features/workspace/hooks/use-selected-file'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'

test('never sends the settings document id to fs.read', async ({ client, server }) => {
  void client
  const handle = vi.spyOn(server.app, 'handle')
  const queryClient = createTestQueryClient()
  const hook = renderHook(() => useSelectedFile(tabFileResource(settingsTab())?.path ?? null), {
    wrapper: queryClientWrapper(queryClient),
  })

  try {
    await Promise.resolve()

    expect(hook.result.current.fileState).toEqual({ status: 'idle' })
    expect(
      handle.mock.calls.flatMap(([request]) => {
        const url = new URL(request.url)
        if (url.pathname !== '/fs/read') return []
        if (url.searchParams.get('path') !== 'settings:') return []
        return [url.href]
      }),
    ).toEqual([])
  } finally {
    hook.unmount()
    queryClient.clear()
    handle.mockRestore()
  }
})

test('exposes a failed text refetch while retaining the matching snapshot', async ({
  client,
  server,
}) => {
  void client
  const selected = filesystemPath('retained.txt')
  const disk = path.join(server.root, selected)
  await writeFile(disk, 'retained text\n')
  const queryClient = createTestQueryClient()
  const hook = renderHook(() => useSelectedFile(selected), {
    wrapper: queryClientWrapper(queryClient),
  })
  try {
    await waitFor(() => expect(hook.result.current.fileState.status).toBe('ready'))
    const retained = hook.result.current.fileState
    await chmod(disk, 0)
    await act(() =>
      queryClient.invalidateQueries({
        queryKey: fileSystemKeys.fileSnapshot(selected),
        exact: true,
      }),
    )
    await waitFor(() =>
      expect(queryClient.getQueryState(fileSystemKeys.fileSnapshot(selected))?.status).toBe(
        'error',
      ),
    )
    expect(hook.result.current.fileState).toEqual(retained)
    expect(hook.result.current).toMatchObject({ readError: expect.any(String) })
    await chmod(disk, 0o600)
    await act(() =>
      queryClient.invalidateQueries({
        queryKey: fileSystemKeys.fileSnapshot(selected),
        exact: true,
      }),
    )
    await waitFor(() => expect(hook.result.current).toMatchObject({ readError: null }))
    expect(hook.result.current.fileState).toEqual(retained)
  } finally {
    await chmod(disk, 0o600)
    hook.unmount()
    queryClient.clear()
  }
})

test('keeps initial text read failures in the error state', async ({ client, server }) => {
  void client
  const selected = filesystemPath('denied.txt')
  const disk = path.join(server.root, selected)
  await writeFile(disk, 'unreadable text')
  await chmod(disk, 0)
  const queryClient = createTestQueryClient()
  const hook = renderHook(() => useSelectedFile(selected), {
    wrapper: queryClientWrapper(queryClient),
  })
  try {
    await waitFor(() => expect(hook.result.current.fileState.status).toBe('error'))
    expect(hook.result.current).toMatchObject({ readError: null })
  } finally {
    await chmod(disk, 0o600)
    hook.unmount()
    queryClient.clear()
  }
})

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
