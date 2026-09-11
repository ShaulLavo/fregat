import { applyAddressView } from '@/features/address/state/apply-view'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { workspaceSearchQuery } from '@/features/search/utils/buffer-query'
import { expect, test } from '../../../../test/fixtures'
import {
  pressBack,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'

test('blank filter controls survive boot and navigation while hidden glob drafts stay local', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/s`],
  })
  await waitForNavigation(navigation)
  const store = application.getSnapshot().editor.searchBufferStore
  expect(
    await navigation.setSearchOptions(
      { filtersVisible: true },
      harness.workspace,
      workspace.rootPath,
    ),
  ).toEqual({ status: 'applied' })
  expect(store.getState().active?.filtersVisible).toBe(true)
  expect(navigation.currentAddress().search).toBeNull()
  await applyAddressView({
    application,
    address: parseAddressIntent(`${workspace.base}/s?s.q=needle`),
    reason: 'boot',
    isCurrent: () => true,
  })
  expect(store.getState().active?.filtersVisible).toBe(true)
  await navigation.openFile({ owner: harness.workspace, path: 'repo/a.ts' })
  expect(store.getState().active?.filtersVisible).toBe(true)
  await navigation.setSearchOptions(
    { includeGlobText: '*.ts', excludeGlobText: 'c.ts' },
    harness.workspace,
    workspace.rootPath,
  )
  expect(navigation.currentAddress().search).toMatchObject({ in: '*.ts', x: 'c.ts' })
  await navigation.setSearchOptions(
    { filtersVisible: false },
    harness.workspace,
    workspace.rootPath,
  )
  expect(navigation.currentAddress().search).toEqual({ q: 'needle' })
  expect(store.getState().active).toMatchObject({
    filtersVisible: false,
    includeGlobText: '*.ts',
    excludeGlobText: 'c.ts',
  })
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  await navigation.openFile({ owner: harness.workspace, path: 'repo/c.ts' })
  await pressBack(navigation)
  const hidden = store.getState().active
  if (!hidden) return expect.unreachable('search buffer disappeared')
  expect(hidden).toMatchObject({
    filtersVisible: false,
    includeGlobText: '*.ts',
    excludeGlobText: 'c.ts',
  })
  expect(workspaceSearchQuery(workspace.rootPath, hidden.query, hidden)).toMatchObject({
    includeGlobs: [],
    excludeGlobs: [],
  })
  expect(navigation.copyAddress().href).not.toMatch(/s\.(in|x)=/)
  await navigation.setSearchOptions({ filtersVisible: true }, harness.workspace, workspace.rootPath)
  expect(navigation.currentAddress().search).toMatchObject({ in: '*.ts', x: 'c.ts' })
  expect(store.getState().active?.filtersVisible).toBe(true)
})

test('boot query overrides keep cached disabled glob drafts disabled', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache(workspace)
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/s`],
  })
  await waitForNavigation(navigation)
  await navigation.setSearchOptions(
    { filtersVisible: false, includeGlobText: '*.ts', excludeGlobText: 'c.ts' },
    harness.workspace,
    workspace.rootPath,
  )
  await applyAddressView({
    application,
    address: parseAddressIntent(`${workspace.base}/s?s.q=next`),
    reason: 'boot',
    isCurrent: () => true,
  })
  expect(application.getSnapshot().editor.searchBufferStore.getState().active).toMatchObject({
    query: 'next',
    filtersVisible: false,
    includeGlobText: '*.ts',
    excludeGlobText: 'c.ts',
  })
  expect(navigation.currentAddress().search).toEqual({ q: 'next' })
})
