import {
  testTabContents,
  testNullableTabContent,
} from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createMemoryHistory } from '@tanstack/react-router'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { createNavigation } from '@/state/navigation'
import { createApplicationRouter } from '@/state/router'
import { test, expect } from '../../../../test/fixtures'
import { createObservedInProcessClient } from '../../../../test/client'
import { createFederationHarness } from '../../../../test/factories/federation'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { renderApplication } from '../../../../test/render'
import {
  editorTabContents,
  renderAddressHarness,
  renderPendingNavigation,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'

test.for(['', '&side=files', '&bottom=terminal', '&tool=git', '&rail=active'])(
  'startup normalization preserves additive tabs %s',
  async (extra, { client, server }) => {
    const workspace = await navigationWorkspace(client, server)
    seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts'] })
    const navigation = createTestNavigation({
      initialEntries: [`${workspace.base}/f/a.ts?tabs=@${extra}`],
    })
    const pending = renderPendingNavigation(navigation)
    await navigation.router.load()
    pending.unmount()
    const rendered = await renderAddressHarness({ navigation })
    expect((await waitForNavigation(navigation)).status).toBe('applied')
    expect(editorTabContents(rendered.harness.workspace)).toEqual(
      testTabContents(['repo/a.ts', 'repo/b.ts', 'repo/c.ts']),
    )
  },
)

test('startup resolves a remote environment after the initial intent was parsed without bindings', async ({
  server,
}) => {
  const federation = await createFederationHarness(server)
  const workspace = await navigationWorkspace(federation.clientB, federation.serverB)
  const href = `/@${federation.descriptorB.environmentId}${workspace.base}/f/a.ts`
  const router = createApplicationRouter({
    history: createMemoryHistory({ initialEntries: [href] }),
  })
  const initial = parseAddressIntent(href)
  const navigation = createNavigation(router, initial)
  const pending = renderPendingNavigation(navigation)
  await router.load()
  pending.unmount()
  const rendered = renderApplication(null, federation.application, { navigation })
  try {
    expect((await waitForNavigation(navigation)).status).toBe('applied')
    expect(federation.application.getSnapshot().origin).toBe(federation.originB)
    expect(
      federation.application.getSnapshot().editor.workspaceStore.getState().selectedTabContent,
    ).toEqual(testNullableTabContent('repo/a.ts'))
  } finally {
    rendered.unmount()
    navigation.dispose()
  }
})

test('a visible file click keeps its workspace while a different workspace is pending', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await mkdir(path.join(server.root, 'second'))
  await writeFile(path.join(server.root, 'second/a.ts'), 'second workspace file')
  const second = await registerTestWorkspaceAddress(client, 'second')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/b.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/b.ts`],
  })
  await waitForNavigation(navigation)
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let delayed = false
  const observed = createObservedInProcessClient(server, async (request) => {
    if (delayed || request.method !== 'GET') return
    if (!new URL(request.url).pathname.endsWith(`/workspace-address/${second.id}`)) return
    delayed = true
    started.resolve()
    await released.promise
  })
  const owner = application.getSnapshot()
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
  try {
    const pending = navigation.openWorkspace({
      environmentId: confirmedEnvironmentId(owner.origin),
      path: 'second',
    })
    await started.promise
    expect(harness.workspace.getState().rootFolder?.path).toBe('repo')
    expect(harness.workspace.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/b.ts'),
    )
    expect(
      await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/a.ts') }),
    ).toEqual({
      status: 'applied',
    })
    expect(await pending).toEqual({ status: 'superseded' })
    expect(harness.workspace.getState().rootFolder?.path).toBe('repo')
    expect(harness.workspace.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/a.ts'),
    )
  } finally {
    released.resolve()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
  }
})
