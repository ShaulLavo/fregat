import { onlineManager } from '@tanstack/query-core'
import { useQuery } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { terminalPanelQueryOptions } from '@/features/terminal/utils/panel-query'
import { createResourceQueryClient } from '@/lib/resources/state/query-client'

test('preload and rendering share the same module acquisition', async () => {
  const client = createResourceQueryClient()
  let fetches = 0
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'fetch') fetches += 1
  })
  const preload = client.query(settingsPageQueryOptions)
  const view = renderHook(() => useQuery(settingsPageQueryOptions, client))
  await act(async () => {
    await preload
  })
  expect(fetches).toBe(1)
  expect(client.getQueryData(settingsPageQueryOptions.queryKey)?.SettingsPage).toBeTypeOf(
    'function',
  )
  view.unmount()
  unsubscribe()
  client.clear()
})

test('prewarmed modules render their successful snapshot on the first read', async () => {
  const client = createResourceQueryClient()
  await client.query(settingsPageQueryOptions)
  const view = renderHook(() => useQuery(settingsPageQueryOptions, client))
  expect(view.result.current.isPending).toBe(false)
  expect(view.result.current.isSuccess).toBe(true)
  view.unmount()
  client.clear()
})

test('local module acquisition runs while the environment is offline', async () => {
  const client = createResourceQueryClient()
  onlineManager.setOnline(false)
  try {
    const module = await client.query(terminalPanelQueryOptions)
    expect(module.TerminalPanel).toBeTypeOf('function')
    expect(client.getQueryState(terminalPanelQueryOptions.queryKey)?.fetchStatus).toBe('idle')
  } finally {
    onlineManager.setOnline(true)
    client.clear()
  }
})
