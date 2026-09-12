import { waitFor } from '@testing-library/react'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { vi } from 'vitest'

import { readLogsFilters } from '@/features/logs/state/filter-store'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../test/fixtures'
import {
  pressBack,
  recordHistoryWrites,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { testTabContent } from '../../../../test/factories/document-targets'
import { takePendingPublication } from '@/state/navigation-publication'

for (const field of ['logs', 'search', 'globs'] as const) {
  test(`140 awaited ${field} edits apply immediately without exhausting browser history`, async ({
    client,
    server,
  }) => {
    const workspace = await navigationWorkspace(client, server)
    seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
    const { application, harness, navigation } = await renderAddressHarness({
      initialEntries: [`${workspace.base}/f/a.ts`],
    })
    await waitForNavigation(navigation)
    const writes = recordHistoryWrites(navigation)
    const search = application.getSnapshot().editor.searchBufferStore

    for (let length = 1; length <= 140; length++) {
      const query = 'x'.repeat(length)
      if (field === 'logs') {
        await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: query })
        expect(readLogsFilters().search).toBe(query)
        continue
      }
      if (field === 'search') {
        await navigation.setSearchQuery(query, harness.workspace, workspace.rootPath)
        expect(search.getState().active?.query).toBe(query)
        continue
      }
      await navigation.setSearchOptions(
        { filtersVisible: true, includeGlobText: query },
        harness.workspace,
        workspace.rootPath,
      )
      expect(search.getState().active?.includeGlobText).toBe(query)
    }

    expect(writes.pushes).toHaveLength(0)
    expect(writes.replaces.length).toBeLessThan(100)
    const copied = navigation.copyAddress('https://example.test').href
    expect(copied).toContain('x'.repeat(140))
    await waitFor(() => expect(navigation.router.history.location.href).toContain('x'.repeat(140)))
    writes.restore()
  })
}

test('pending filter copy and explicit destinations survive Back and Forward without a stale write', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  const beforeEdit = navigation.router.history.location.href
  await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: 'latest filter' })
  expect(navigation.router.history.location.href).toBe(beforeEdit)
  expect(navigation.copyAddress('https://example.test').href).toContain('log.find=latest+filter')

  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/c.ts') })
  expect(parseAddress(navigation.router.history.location.href).document).toBe('f/c.ts')
  await pressBack(navigation)
  expect(parseAddress(navigation.router.history.location.href).document).toBe('f/b.ts')
  navigation.forward()
  await waitForNavigation(navigation)
  const reached = navigation.router.history.location.href
  expect(parseAddress(reached).document).toBe('f/c.ts')
  await new Promise((resolve) => setTimeout(resolve, 750))
  expect(navigation.router.history.location.href).toBe(reached)
  expect(readLogsFilters().search).toBe('latest filter')
})

test('disposing navigation cancels a pending filter history write', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { navigation } = await renderAddressHarness({ initialEntries: [`${workspace.base}/s`] })
  await waitForNavigation(navigation)
  const beforeEdit = navigation.router.history.location.href
  await navigation.setSearchQuery('not published')
  navigation.dispose()
  await new Promise((resolve) => setTimeout(resolve, 750))
  expect(navigation.router.history.location.href).toBe(beforeEdit)
})

test('sustained typing publishes progress before the user stops typing', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { navigation } = await renderAddressHarness({ initialEntries: [`${workspace.base}/s`] })
  await waitForNavigation(navigation)
  const writes = recordHistoryWrites(navigation)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    for (let length = 1; length <= 40; length++) {
      await navigation.setSearchQuery('y'.repeat(length))
      await vi.advanceTimersByTimeAsync(50)
    }
    expect(writes.replaces.length).toBeGreaterThan(1)
    expect(writes.replaces.length).toBeLessThan(20)
    expect(parseAddress(navigation.router.history.location.href).search?.q?.length).toBeGreaterThan(
      30,
    )
    await vi.advanceTimersByTimeAsync(500)
    expect(parseAddress(navigation.router.history.location.href).search?.q).toBe('y'.repeat(40))
  } finally {
    navigation.dispose()
    vi.useRealTimers()
    writes.restore()
  }
})

test('native traversal cancels pending filter publication in both directions', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/c.ts') })
  await pressBack(navigation)
  await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: 'before forward' })
  navigation.router.history.forward()
  await waitForNavigation(navigation)
  await new Promise((resolve) => setTimeout(resolve, 750))
  expect(parseAddress(navigation.router.history.location.href).document).toBe('f/c.ts')
  expect(readLogsFilters().search).toBe('before forward')

  await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: 'before back' })
  navigation.router.history.back()
  await waitForNavigation(navigation)
  await new Promise((resolve) => setTimeout(resolve, 750))
  expect(parseAddress(navigation.router.history.location.href).document).toBe('f/b.ts')
  expect(readLogsFilters().search).toBe('before back')
  navigation.forward()
  await waitForNavigation(navigation)
  expect(parseAddress(navigation.router.history.location.href).document).toBe('f/c.ts')
})

test('selecting an unaddressable tab keeps the pending filter publication', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  const conflict = testTabContent('conflict-diff:pending-filter')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: 'before conflict' })
  await navigation.openContent({ owner: harness.workspace, content: conflict })
  await waitFor(() =>
    expect(navigation.router.history.location.href).toContain('log.find=before+conflict'),
  )
  expect(harness.workspace.getState().selectedTabContent).toEqual(conflict)
})

test('reattaching the same runtime preserves filters awaiting URL publication', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { application, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/s`],
  })
  await waitForNavigation(navigation)
  const detach = navigation.attach(application)
  await waitForNavigation(navigation)
  await navigation.setSearchQuery('latest before detach')
  detach()
  const detachAgain = navigation.attach(application)
  await waitForNavigation(navigation)
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe(
    'latest before detach',
  )
  expect(navigation.router.history.location.href).toContain('s.q=latest+before+detach')
  detachAgain()
})

test('a reload can recover the applied filter awaiting publication to its exact history entry', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { navigation } = await renderAddressHarness({ initialEntries: [`${workspace.base}/s`] })
  await waitForNavigation(navigation)
  const { href, state } = navigation.router.history.location
  await navigation.setSearchQuery('latest before reload')
  expect(navigation.router.history.location.href).toBe(href)
  expect(
    takePendingPublication({
      href,
      identity: `${state.__TSR_index}:${state.__TSR_key ?? ''}`,
      reload: true,
    }),
  ).toContain('s.q=latest+before+reload')
})
