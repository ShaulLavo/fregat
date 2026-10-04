import { onlineManager } from '@tanstack/query-core'
import { useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test } from '../../../../test/fixtures'
import { shortcutMetadataQueryOptions } from '@/features/settings/utils/shortcut-metadata-query'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { createResourceQueryClient } from '@/lib/resources/state/query-client'

test('metadata acquisition settles the browser resource before the import mutation succeeds', async () => {
  const client = createResourceQueryClient()
  const options = shortcutMetadataQueryOptions(client)
  let successWithMetadata = false
  const unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    successWithMetadata = client.getQueryData(settingsQueryKeys.shortcutMetadata) !== undefined
  })
  const view = renderHook(() => useQuery(options, client))
  expect(view.result.current.isPending).toBe(true)
  await act(async () => {
    await client.query(options)
  })
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
  expect(successWithMetadata).toBe(true)
  expect(view.result.current.data?.zed).toHaveLength(1885)
  expect(view.result.current.data?.unmappedPresetBindings('linux', 'ours').length).toBeGreaterThan(
    0,
  )
  const mutations = client
    .getMutationCache()
    .findAll({ mutationKey: settingsMutationKeys.shortcutMetadata })
  expect(mutations).toHaveLength(1)
  expect(mutations[0]?.state.status).toBe('success')
  view.unmount()
  const reopened = renderHook(() => useQuery(options, client))
  expect(reopened.result.current.isSuccess).toBe(true)
  expect(
    client.getMutationCache().findAll({ mutationKey: settingsMutationKeys.shortcutMetadata }),
  ).toHaveLength(1)
  reopened.unmount()
  unsubscribe()
  client.clear()
})

test('the cached local report import is available offline', async () => {
  const client = createResourceQueryClient()
  onlineManager.setOnline(false)
  try {
    const metadata = await client.query(shortcutMetadataQueryOptions(client))
    expect(metadata.ours).toHaveLength(1885)
    expect(client.getQueryState(settingsQueryKeys.shortcutMetadata)?.fetchStatus).toBe('idle')
  } finally {
    onlineManager.setOnline(true)
    client.clear()
  }
})
