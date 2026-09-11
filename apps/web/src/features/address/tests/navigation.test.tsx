import { readFilePreview } from '@workspace/client-core/files/read'
import { readAddressCache, selectInitialAddress } from '@/features/address/state/storage'
import { readLogsFilters } from '@/features/logs/state/filter-store'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { conflictDiffDocumentId } from '@/features/editor/utils/conflict-diff-document'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { navigateAddress } from '@/features/address/utils/route-options'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { expect, test } from '../../../../test/fixtures'
import {
  editorTabPaths,
  pressBack,
  renderAddressHarness,
  renderPendingNavigation,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { deferredWorkspaceClient } from '../../../../test/factories/deferred-workspace-client'
import { scopeAddressEnvironment } from '../../../../test/factories/address-environment'
import { healthDescriptorSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { waitFor } from '@testing-library/react'
import type { NavigationResult } from '@/state/navigation-coordinator'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { renderApplication } from '../../../../test/render'

test('completed rapid file destinations each retain their own history entry', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  expect(await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })).toEqual({
    status: 'applied',
  })
  expect(await navigation.openFile({ owner: harness.workspace, path: 'repo/c.ts' })).toEqual({
    status: 'applied',
  })
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/b.ts')
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/a.ts')
  navigation.forward()
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/b.ts')
})

test('paused text edits replace one destination and Back clears omitted filters', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, application, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  for (const query of ['h', 'he', 'hel', 'hell', 'hello']) {
    expect((await navigation.setSearchQuery(query)).status).toBe('applied')
    expect(
      (await navigation.setLogsFilters({ ...defaultLogsFilterState(), search: query })).status,
    ).toBe('applied')
  }
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe('hello')
  expect(readLogsFilters().search).toBe('hello')
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/a.ts')
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe('')
  expect(readLogsFilters().search).toBe('')
})

test('successive oversized queries apply even when their wire href is identical', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, application, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/s`],
  })
  await waitForNavigation(navigation)
  const first = 'a'.repeat(8000)
  const second = 'b'.repeat(8000)
  expect(await navigation.setSearchQuery(first)).toEqual({ status: 'applied' })
  const href = navigation.router.history.location.href
  expect(await navigation.setSearchQuery(second)).toEqual({ status: 'applied' })
  expect(navigation.router.history.location.href).toBe(href)
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe(second)
  expect(navigation.copyAddress().omissions).toContain('search')
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  await pressBack(navigation)
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe('')
})

test('traversal restores exact order followed by dirty and unaddressable extras', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  const conflict = conflictDiffDocumentId('retained-conflict')
  seedWorkspaceCache({
    ...workspace,
    tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts', 'repo/dirty.ts', conflict],
  })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [
      `${workspace.base}/f/b.ts?tabs=f/c.ts~@~f/a.ts`,
      `${workspace.base}/f/a.ts?tabs=@~f/b.ts~f/c.ts~f/dirty.ts`,
    ],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: conflict })
  await navigation.openFile({ owner: harness.workspace, path: 'repo/a.ts' })
  expect(editorTabPaths(harness.workspace)).toContain(conflict)
  const file = await readFilePreview({
    client,
    path: 'repo/dirty.ts',
    signal: new AbortController().signal,
  })
  harness.documents.getState().ensureLiveEditorDocument(file)
  harness.documents.getState().setLiveEditorDocumentDirty(file.path, true)
  await pressBack(navigation)
  expect(editorTabPaths(harness.workspace)).toEqual([
    'repo/c.ts',
    'repo/b.ts',
    'repo/a.ts',
    'repo/dirty.ts',
    conflict,
  ])
  expect(harness.documents.getState().dirtyFilePaths.has('repo/dirty.ts')).toBe(true)
})

test('absent and malformed collections preserve tabs while explicit empty closes clean tabs', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [
      `${workspace.base}?tabs=-`,
      `${workspace.base}/f/a.ts?tabs=@~@`,
      `${workspace.base}/f/b.ts`,
    ],
  })
  await waitForNavigation(navigation)
  await pressBack(navigation)
  expect(editorTabPaths(harness.workspace)).toEqual(['repo/a.ts', 'repo/b.ts'])
  await pressBack(navigation)
  expect(editorTabPaths(harness.workspace)).toEqual([])
})

test('transient conflict selection survives panel edits and a current addressed file resumes route selection', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  const conflict = conflictDiffDocumentId('local-conflict')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', conflict] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const href = navigation.router.history.location.href
  expect(await navigation.openFile({ owner: harness.workspace, path: conflict })).toEqual({
    status: 'applied',
  })
  expect(navigation.router.history.location.href).toBe(href)
  await navigation.setSidePanel('git')
  expect(harness.workspace.getState().selectedFilePath).toBe(conflict)
  expect(await navigation.openFile({ owner: harness.workspace, path: 'repo/a.ts' })).toEqual({
    status: 'applied',
  })
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/a.ts')
  expect(editorTabPaths(harness.workspace)).toContain(conflict)
})

test('returning to defaults resets tool, rail and panels without adding Back entries', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  await navigation.setToolPanel('logs')
  await navigation.setRail('archived')
  await navigation.setSidePanel('search')
  await navigation.setBottomPanel('problems')
  await pressBack(navigation)
  expect(harness.workspace.getState().workbenchPanels).toMatchObject({
    activeSidebarTab: 'files',
    activeBottomTab: 'terminal',
  })
  expect(harness.workspace.getState().chatModePanels.activeToolTab).toBe('git')
  expect(useSessionRailStore.getState().view).toBe('active')
})

test('Back persists the reached address and immediate copying captures current edits', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts?decode=diffusion`],
  })
  await waitForNavigation(navigation)
  const first = navigation.router.history.location.href
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  await navigation.setSearchQuery('just typed')
  const copied = navigation.copyAddress('https://example.test')
  expect(copied.href).toContain('/workbench/f/b.ts')
  expect(copied.href).toContain('s.q=just+typed')
  expect(copied.href).not.toContain('decode=')
  await pressBack(navigation)
  expect(readAddressCache()).toBe(
    first.replace('&decode=diffusion', '').replace('?decode=diffusion', ''),
  )
  expect(selectInitialAddress('/')).toBe(readAddressCache())
})

test('unknown destinations settle unavailable and preserve the last successful address', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const saved = readAddressCache()
  navigation.router.history.push(`${workspace.base}/does-not-exist`)
  expect((await waitForNavigation(navigation)).status).toBe('unavailable')
  expect(readAddressCache()).toBe(saved)
})

test('an already-current destination resolves without a route event', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts?tabs=@`],
  })
  await waitForNavigation(navigation)
  const count = navigation.router.history.length
  expect(await navigation.openFile({ owner: harness.workspace, path: 'repo/a.ts' })).toEqual({
    status: 'applied',
  })
  expect(navigation.router.history.length).toBe(count)
  await navigateAddress(
    navigation.router,
    { ...parseAddress(navigation.router.history.location.href), side: 'git' },
    { replace: true },
  )
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().workbenchPanels.activeSidebarTab).toBe('git')
})

test.for(['supersede', 'dispose'] as const)(
  '%s completes pending commands before their abandoned HTTP preparation returns',
  async (action, { client, server }) => {
    const workspace = await navigationWorkspace(client, server)
    const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
    const delayed = deferredWorkspaceClient(server)
    const restore = scopeAddressEnvironment(
      action === 'supersede' ? 'http://localhost:38087' : 'http://localhost:38088',
      descriptor.environmentId,
      delayed.client,
    )
    seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
    const rendered = await renderAddressHarness({ initialEntries: [`${workspace.base}/f/a.ts`] })
    try {
      await waitForNavigation(rendered.navigation)
      let completed: NavigationResult | undefined
      const pending = rendered.navigation.openWorkspace({
        environmentId: descriptor.environmentId,
        path: 'repo',
      })
      void pending.then((result) => {
        completed = result
      })
      await delayed.started
      if (action === 'dispose') rendered.navigation.dispose()
      if (action === 'supersede')
        await rendered.navigation.openFile({ owner: rendered.harness.workspace, path: 'repo/b.ts' })
      await waitFor(() => expect(completed).toEqual({ status: 'superseded' }))
      delayed.release()
      await pending
      if (action === 'supersede')
        expect(rendered.harness.workspace.getState().selectedFilePath).toBe('repo/b.ts')
    } finally {
      delayed.release()
      rendered.unmount()
      restore()
    }
  },
)

test('attaching after Router resolved another destination applies the current location', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const navigation = createTestNavigation({ initialEntries: [`${workspace.base}/f/a.ts`] })
  const pending = renderPendingNavigation(navigation)
  await navigation.router.load()
  await navigateAddress(navigation.router, parseAddress(`${workspace.base}/f/b.ts`), {
    replace: false,
  })
  pending.unmount()
  const rendered = await renderAddressHarness({ navigation })
  await waitForNavigation(navigation)
  expect(rendered.harness.workspace.getState().selectedFilePath).toBe('repo/b.ts')
  expect(navigation.router.history.location.pathname).toBe(`${workspace.base}/f/b.ts`)
})

test('reattachment consumes the reached location instead of replaying startup', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation, application } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: 'repo/b.ts' })
  const detach = navigation.attach(application)
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().selectedFilePath).toBe('repo/b.ts')
  detach()
})

test('Back between equal hrefs discards an oversized command payload', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const href = `${workspace.base}/s?tabs=f/a.ts~@`
  const { application, navigation } = await renderAddressHarness({ initialEntries: [href, href] })
  await waitForNavigation(navigation)
  await navigation.setSearchQuery('x'.repeat(8000))
  expect(navigation.router.history.location.href).toBe(href)
  await pressBack(navigation)
  expect(application.getSnapshot().editor.searchBufferStore.getState().active?.query).toBe('')
})

test('effect cleanup before initial application preserves additive boot on reattachment', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts'] })
  const application = createTestApplicationRuntime()
  const navigation = createTestNavigation({ initialEntries: [`${workspace.base}/f/a.ts?tabs=@`] })
  navigation.attach(application)()
  const rendered = renderApplication(null, application, { navigation })
  try {
    await waitForNavigation(navigation)
    expect(editorTabPaths(application.getSnapshot().editor.workspaceStore)).toEqual([
      'repo/a.ts',
      'repo/b.ts',
      'repo/c.ts',
    ])
  } finally {
    rendered.unmount()
  }
})

test('cleanup from an older attachment cannot detach the same runtime attached again', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const application = createTestApplicationRuntime()
  const navigation = createTestNavigation({ initialEntries: [`${workspace.base}/f/a.ts?tabs=@`] })
  const rendered = renderPendingNavigation(navigation)
  const detachFirst = navigation.attach(application)
  const detachSecond = navigation.attach(application)
  detachFirst()
  try {
    expect(
      await navigation.openFile({
        owner: application.getSnapshot().editor.workspaceStore,
        path: 'repo/b.ts',
      }),
    ).toEqual({ status: 'applied' })
  } finally {
    detachSecond()
    navigation.dispose()
    rendered.unmount()
  }
})

test('disposed navigation rejects an unaddressable editor command without mutating its owner', async () => {
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: ['/~-/workbench/settings?tabs=@'],
  })
  await waitForNavigation(navigation)
  const href = navigation.router.history.location.href
  navigation.dispose()
  expect(await navigation.openFile({ owner: harness.workspace, path: '/outside-file.ts' })).toEqual(
    { status: 'superseded' },
  )
  expect(harness.workspace.getState().selectedFilePath).toBe(settingsDocumentId())
  expect(editorTabPaths(harness.workspace)).toEqual([settingsDocumentId()])
  expect(navigation.router.history.location.href).toBe(href)
})
