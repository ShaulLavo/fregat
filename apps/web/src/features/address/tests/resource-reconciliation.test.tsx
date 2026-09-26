import {
  testTabContents,
  testDocumentRef,
  testNullableTabContent,
} from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../test/fixtures'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import {
  editorTabContents,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { createObservedInProcessClient } from '../../../../test/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { createFederationHarness } from '../../../../test/factories/federation'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { renderApplication } from '../../../../test/render'
import { fileSystemKeys } from '@/lib/query-keys'
import { deferredWorkspaceClient } from '../../../../test/factories/deferred-workspace-client'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { parseAddress, TABS_BUDGET_BYTES } from '@workspace/client-core/address/grammar'

test.for([
  { change: 'rename', tabs: 'omitted' },
  { change: 'delete', tabs: 'omitted' },
  { change: 'rename', tabs: 'over-budget' },
  { change: 'delete', tabs: 'over-budget' },
] as const)(
  'a committed $change preserves retained tabs during $tabs traversal',
  async ({ change, tabs }, { client, server }) => {
    const workspace = await navigationWorkspace(client, server)
    await mkdir(path.join(server.root, 'second'))
    const second = await registerTestWorkspaceAddress(client, 'second')
    const query = tabs === 'omitted' ? '' : `?tabs=f/${'x'.repeat(TABS_BUDGET_BYTES)}`
    const incoming = `${workspace.base}/f/a.ts${query}`
    expect(parseAddress(incoming).tabs).toBeNull()
    seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts'] })
    const { application, harness, navigation } = await renderAddressHarness({
      initialEntries: [incoming, `/~${workspaceToken(second)}/workbench`],
    })
    await waitForNavigation(navigation)
    const owner = application.getSnapshot()
    const reached = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const observed = createObservedInProcessClient(server, async (request) => {
      if (!new URL(request.url).pathname.startsWith('/fs/workspace-address/')) return
      reached.resolve()
      await released.promise
    })
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
    try {
      navigation.back()
      await reached.promise
      expect(harness.workspace.getState().rootFolder?.path).toBe('second')
      const commands = navigation.editorCommands(harness.workspace)
      if (change === 'rename')
        await rename(path.join(server.root, 'repo/b.ts'), path.join(server.root, 'repo/renamed.ts'))
      if (change === 'delete') await unlink(path.join(server.root, 'repo/b.ts'))
      const changed =
        change === 'rename'
          ? commands.renameLiveEditorDocument(
              filesystemPath('repo/b.ts'),
              filesystemPath('repo/renamed.ts'),
            )
          : commands.discardLiveEditorDocument(testDocumentRef('repo/b.ts'))
      released.resolve()
      expect(await changed.settled).toEqual({ status: 'applied' })
      expect(editorTabContents(harness.workspace)).toEqual(
        testTabContents(
          change === 'rename'
            ? ['repo/a.ts', 'repo/renamed.ts', 'repo/c.ts']
            : ['repo/a.ts', 'repo/c.ts'],
        ),
      )
      expect(harness.workspace.getState().selectedTabContent).toEqual(
        testNullableTabContent('repo/a.ts'),
      )
    } finally {
      released.resolve()
      registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
    }
  },
)

test.for(['rename', 'delete'] as const)(
  'a committed %s updates the parked workspace reached by a pending traversal',
  async (change, { client, server }) => {
    const workspace = await navigationWorkspace(client, server)
    await mkdir(path.join(server.root, 'second'))
    seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
    const { application, harness, navigation } = await renderAddressHarness({
      initialEntries: [`${workspace.base}/f/a.ts`],
    })
    await waitForNavigation(navigation)
    const owner = application.getSnapshot()
    await navigation.openWorkspace({
      environmentId: confirmedEnvironmentId(owner.origin),
      path: 'second',
    })
    const reached = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const observed = createObservedInProcessClient(server, async (request) => {
      if (!new URL(request.url).pathname.startsWith('/fs/workspace-address/')) return
      reached.resolve()
      await released.promise
    })
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
    try {
      navigation.back()
      await reached.promise
      expect(harness.workspace.getState().rootFolder?.path).toBe('second')
      const commands = navigation.editorCommands(harness.workspace)
      if (change === 'rename')
        await rename(path.join(server.root, 'repo/a.ts'), path.join(server.root, 'repo/renamed.ts'))
      if (change === 'delete') await unlink(path.join(server.root, 'repo/a.ts'))
      const changed =
        change === 'rename'
          ? commands.renameLiveEditorDocument(
              filesystemPath('repo/a.ts'),
              filesystemPath('repo/renamed.ts'),
            )
          : commands.discardLiveEditorDocument(testDocumentRef('repo/a.ts'))
      released.resolve()
      await waitForNavigation(navigation)
      expect(editorTabContents(harness.workspace)).toEqual(
        testTabContents(change === 'rename' ? ['repo/renamed.ts', 'repo/b.ts'] : ['repo/b.ts']),
      )
      expect(harness.workspace.getState().selectedTabContent).toEqual(
        testNullableTabContent(change === 'rename' ? 'repo/renamed.ts' : 'repo/b.ts'),
      )
      expect(navigation.router.history.location.href).toContain(
        change === 'rename' ? '/f/renamed.ts' : '/f/b.ts',
      )
      expect(await changed.settled).toEqual({ status: 'applied' })
    } finally {
      released.resolve()
      registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
    }
  },
)

test('a completed rename in a retained environment follows its pending return without changing the visible owner', async ({
  server,
}) => {
  const federation = await createFederationHarness(server)
  await navigationWorkspace(federation.clientA, federation.serverA)
  await navigationWorkspace(federation.clientB, federation.serverB)
  const navigation = createTestNavigation({ application: federation.application })
  const rendered = renderApplication(null, federation.application, { navigation })
  const delayed = deferredWorkspaceClient(federation.serverB)
  try {
    await waitForNavigation(navigation)
    expect(
      await navigation.openWorkspace({
        environmentId: federation.descriptorB.environmentId,
        path: 'repo',
      }),
    ).toEqual({ status: 'applied' })
    const remote = federation.application.getSnapshot()
    expect(remote.origin).toBe(federation.originB)
    await navigation.openFile({
      owner: remote.editor.workspaceStore,
      path: filesystemPath('repo/a.ts'),
    })
    expect(
      await navigation.openWorkspace({
        environmentId: federation.descriptorA.environmentId,
        path: 'repo',
      }),
    ).toEqual({ status: 'applied' })
    const local = federation.application.getSnapshot()
    expect(local.origin).toBe(federation.originA)
    await navigation.openFile({
      owner: local.editor.workspaceStore,
      path: filesystemPath('repo/a.ts'),
    })
    const localPaths = editorTabContents(local.editor.workspaceStore)
    registerEnvironmentQueryClient(remote.queryClient, remote.origin, delayed.client)
    // The first open cached the folder's address; drop it so this open waits on the server.
    remote.queryClient.removeQueries({ queryKey: fileSystemKeys.workspaceAddress('repo') })
    const pending = navigation.openWorkspace({
      environmentId: federation.descriptorB.environmentId,
      path: 'repo',
    })
    await delayed.started
    await rename(
      path.join(federation.serverB.root, 'repo/a.ts'),
      path.join(federation.serverB.root, 'repo/renamed.ts'),
    )
    const renamed = navigation
      .editorCommands(remote.editor.workspaceStore)
      .renameLiveEditorDocument(filesystemPath('repo/a.ts'), filesystemPath('repo/renamed.ts'))
    expect(federation.application.getSnapshot()).toBe(local)
    expect(editorTabContents(local.editor.workspaceStore)).toEqual(localPaths)
    expect(local.editor.workspaceStore.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/a.ts'),
    )
    expect(editorTabContents(remote.editor.workspaceStore)).toEqual(
      testTabContents(['repo/renamed.ts']),
    )
    delayed.release()
    expect(await pending).toEqual({ status: 'applied' })
    expect(await renamed.settled).toEqual({ status: 'applied' })
    expect(federation.application.getSnapshot()).toBe(remote)
    expect(remote.editor.workspaceStore.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/renamed.ts'),
    )
    expect(navigation.router.history.location.href).toContain('/f/renamed.ts')
  } finally {
    delayed.release()
    const remote = federation.application.getEnvironment(federation.descriptorB.environmentId)
    if (remote)
      registerEnvironmentQueryClient(remote.queryClient, remote.origin, federation.clientB)
    rendered.unmount()
    navigation.dispose()
  }
})
