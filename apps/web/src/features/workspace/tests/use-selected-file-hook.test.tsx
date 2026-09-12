import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
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

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}
