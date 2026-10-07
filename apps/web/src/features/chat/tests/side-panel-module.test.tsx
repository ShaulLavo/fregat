import { onlineManager } from '@tanstack/query-core'
import { useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { sidePanelModuleQueryOptions } from '@/features/chat/utils/side-panel-module'
import { chatPanelQueryKeys } from '@/features/chat/utils/query-keys'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { createResourceQueryClient } from '@/lib/resources/state/query-client'

test('the chat module settles once before success and survives a pending revisit', async () => {
  const client = createResourceQueryClient()
  const options = sidePanelModuleQueryOptions(client)
  expect(client.getQueryCache().getAll()).toHaveLength(0)
  expect(client.getMutationCache().getAll()).toHaveLength(0)
  let settledBeforeSuccess = false
  const unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    settledBeforeSuccess = client.getQueryData(chatPanelQueryKeys.module) !== undefined
  })
  const first = renderHook(() => useQuery(options, client))
  expect(first.result.current.isPending).toBe(true)
  first.unmount()
  const reopened = renderHook(() => useQuery(options, client))
  await act(async () => {
    await Promise.all([client.query(options), client.query(options)])
  })
  await waitFor(() => expect(reopened.result.current.isSuccess).toBe(true))
  expect(typeof reopened.result.current.data?.ChatSidePanel).toBe('function')
  expect(settledBeforeSuccess).toBe(true)
  const mutations = client
    .getMutationCache()
    .findAll({ mutationKey: chatMutationKeys.sidePanelModule })
  expect(mutations).toHaveLength(1)
  expect(mutations[0]?.state.status).toBe('success')
  const module = reopened.result.current.data
  reopened.unmount()
  const revisit = renderHook(() => useQuery(options, client))
  expect(revisit.result.current.isSuccess).toBe(true)
  expect(revisit.result.current.data).toBe(module)
  expect(
    client.getMutationCache().findAll({ mutationKey: chatMutationKeys.sidePanelModule }),
  ).toHaveLength(1)
  revisit.unmount()
  unsubscribe()
  client.clear()
})

test('the chat code resource is acquired through its local mutation offline', async () => {
  const client = createResourceQueryClient()
  onlineManager.setOnline(false)
  try {
    const loaded = await client.query(sidePanelModuleQueryOptions(client))
    expect(typeof loaded.ChatSidePanel).toBe('function')
    expect(client.getQueryState(chatPanelQueryKeys.module)?.fetchStatus).toBe('idle')
  } finally {
    onlineManager.setOnline(true)
    client.clear()
  }
})
