import {
  testTabContents,
  testTabContent,
  testNullableTabContent,
} from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { testWorkspaceToken } from '../../../../test/factories/workspace-address'
import { MAX_APPLIED_TABS } from '@workspace/client-core/address/grammar'
import { readSettingsCategory } from '@/features/settings/state/category-store'
import { expect, test } from '../../../../test/fixtures'
import {
  editorTabContents,
  waitForNavigation,
  pressBack,
  recordHistoryWrites,
  renderAddressHarness,
  seedWorkspaceCache,
} from '../../../../test/address'

const ROOT = '/repo'
const BASE = `/~${testWorkspaceToken(ROOT)}/workbench`

test('boot preserves cached order and appends missing addressed tabs', async () => {
  const remembered = ['a.ts', 'b.ts', 'c.ts'].map((name) => `${ROOT}/${name}`)
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: remembered })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${BASE}/f/b.ts?tabs=f/c.ts~@~f/new.ts`],
  })
  expect((await waitForNavigation(navigation)).status).toBe('applied')
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents([...remembered, `${ROOT}/new.ts`]),
  )
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent(`${ROOT}/b.ts`),
  )
})

test('boot rejects oversized collections while preserving the selected destination', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const tokens = Array.from({ length: MAX_APPLIED_TABS + 1 }, (_, index) => `f/many-${index}.ts`)
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${BASE}/f/a.ts?tabs=${tokens.join('~')}`],
  })
  await waitForNavigation(navigation)
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents([`${ROOT}/a.ts`]))
})

test('going back preserves Forward without another push', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`, `${ROOT}/b.ts`] })
  const { harness, navigation } = await renderAddressHarness({ initialEntries: [`${BASE}/f/a.ts`] })
  await waitForNavigation(navigation)
  const first = navigation.router.history.location.href
  const writes = recordHistoryWrites(navigation)
  expect(
    await navigation.openFile({ owner: harness.workspace, path: filesystemPath(`${ROOT}/b.ts`) }),
  ).toEqual({
    status: 'applied',
  })
  const second = navigation.router.history.location.href
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent(`${ROOT}/a.ts`),
  )
  expect(navigation.router.history.location.href).toBe(first)
  expect(writes.pushes).toHaveLength(1)
  navigation.forward()
  await waitForNavigation(navigation)
  expect(navigation.router.history.location.href).toBe(second)
  writes.restore()
})

test('walking back out of settings retains its tab and clears its active category', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${BASE}/f/a.ts?tabs=@`],
  })
  await waitForNavigation(navigation)
  await navigation.openContent({ owner: harness.workspace, content: testTabContent('settings:') })
  await navigation.setSettingsCategory('Providers')
  expect(readSettingsCategory()).toBe('Providers')
  await pressBack(navigation)
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents([`${ROOT}/a.ts`, 'settings:']),
  )
  expect(readSettingsCategory()).toBeNull()
})

test('a category alone does not open settings', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${BASE}/f/a.ts?settings=Providers`],
  })
  await waitForNavigation(navigation)
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents([`${ROOT}/a.ts`]))
})

test('restoring background settings keeps the addressed file selected', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${BASE}/f/a.ts?tabs=@~settings&settings=Providers`],
  })
  await waitForNavigation(navigation)
  expect(editorTabContents(harness.workspace)).toContainEqual(testTabContent('settings:'))
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent(`${ROOT}/a.ts`),
  )
})

test('folderless settings keeps its tab and category', async () => {
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: ['/~-/workbench/settings?tabs=@&settings=Providers'],
  })
  await waitForNavigation(navigation)
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['settings:']))
  expect(readSettingsCategory()).toBe('Providers')
  expect(navigation.router.history.location.pathname).toBe('/~-/workbench/settings')
})

test('a short link expands once and preserves its explicit panel', async () => {
  seedWorkspaceCache({ rootPath: ROOT, tabPaths: [`${ROOT}/a.ts`] })
  const { navigation } = await renderAddressHarness({ initialEntries: [`${BASE}/f/a.ts?side=git`] })
  await waitForNavigation(navigation)
  const settled = navigation.router.history.location.href
  expect(settled).toContain('side=git')
  const writes = recordHistoryWrites(navigation)
  await navigation.router.load()
  expect(navigation.router.history.location.href).toBe(settled)
  expect(writes.pushes).toEqual([])
  expect(writes.replaces).toEqual([])
  writes.restore()
})
