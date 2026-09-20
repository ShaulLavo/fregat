import { createTestQueryClient } from '../../../../test/render'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import { expect, test } from '../../../../test/fixtures'
import { useServerInfoForOpen } from '@/features/file-picker/hooks/use-server-info-for-open'
import { filePickerKeys } from '@/lib/query-keys'

test('refreshes the existing server-info query', async ({ client: _client }) => {
  const queryClient = createTestQueryClient()
  const { result } = renderHook(
    () =>
      useServerInfoForOpen(
        true,
        () => undefined,
        () => undefined,
      ),
    { wrapper: queryClientWrapper(queryClient) },
  )

  await waitFor(() => expect(result.current.serverInfo).not.toBeNull())
  const updatesBeforeRefresh = serverInfoUpdateCount(queryClient)

  await act(async () => {
    await result.current.refresh()
  })

  expect(serverInfoUpdateCount(queryClient)).toBe(updatesBeforeRefresh + 1)
  queryClient.clear()
})

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function serverInfoUpdateCount(queryClient: QueryClient) {
  return queryClient.getQueryState(filePickerKeys.serverInfo())?.dataUpdateCount ?? 0
}
