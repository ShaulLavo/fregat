import {
  testContentMatches,
  testTabContents,
  testTabContent,
  testNullableTabContent,
  testDocumentRef,
} from '../../../../test/factories/document-targets'
import { filesystemPath, tabId as testTabId } from '@/lib/documents/utils/identity'
import { mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../test/fixtures'
import {
  initializeNavigationGitWorkspace,
  navigationWorkspace,
} from '../../../../test/factories/navigation-workspace'
import {
  editorTabContents,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { DOMAIN_SESSION } from '../../../../test/factories/session-domain'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { TEST_PROJECT_ID } from '../../../../test/factories/chat'
import { createObservedInProcessClient } from '../../../../test/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import { gitKeys } from '@/lib/query-keys'
test('a delayed Git diff cannot replace a newer file destination', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  await initializeNavigationGitWorkspace(server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/b.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/b.ts`],
  })
  await waitForNavigation(navigation)
  const row = {
    file: { path: 'repo/a.ts', status: 'modified', index: 'unmodified', worktree: 'modified' },
    section: 'worktree',
    status: 'modified',
  } as const
  expect(await navigation.openDiff({ owner: harness.workspace, row })).toEqual({
    status: 'applied',
  })
  expect(harness.workspace.getState().selectedTabContent).toMatchObject({
    kind: 'document',
    document: { kind: 'git-diff', source: { kind: 'snapshot', path: 'repo/a.ts' } },
  })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  const reached = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/git/diff') return
    reached.resolve()
    await released.promise
  })
  const owner = application.getSnapshot()
  owner.queryClient.removeQueries({ queryKey: gitKeys.diff(row.file.path, false) })
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
  try {
    const pending = navigation.openDiff({ owner: harness.workspace, row })
    await reached.promise
    expect(
      await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/c.ts') }),
    ).toEqual({
      status: 'applied',
    })
    expect(await pending).toEqual({ status: 'superseded' })
    released.resolve()
    await expect
      .poll(() => owner.queryClient.isFetching({ queryKey: gitKeys.diff(row.file.path, false) }))
      .toBe(0)
    expect(harness.workspace.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/c.ts'),
    )
  } finally {
    released.resolve()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
  }
})

test('completed rename and discard survive a newer file destination', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const commands = navigation.editorCommands(harness.workspace)
  await rename(path.join(server.root, 'repo/a.ts'), path.join(server.root, 'repo/renamed.ts'))
  const renamed = commands.renameLiveEditorDocument(
    filesystemPath('repo/a.ts'),
    filesystemPath('repo/renamed.ts'),
  )
  expect(
    await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') }),
  ).toEqual({
    status: 'applied',
  })
  expect(await renamed.settled).toEqual({ status: 'superseded' })
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/renamed.ts', 'repo/b.ts']),
  )
  await unlink(path.join(server.root, 'repo/b.ts'))
  const discarded = commands.discardLiveEditorDocument(testDocumentRef('repo/b.ts'))
  expect(
    await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/c.ts') }),
  ).toEqual({
    status: 'applied',
  })
  expect(await discarded.settled).toEqual({ status: 'superseded' })
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/renamed.ts', 'repo/c.ts']),
  )
})

test('stale search, diff and project commands cannot supersede a pending file destination', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const environmentId = confirmedEnvironmentId(application.getSnapshot().origin)
  const next = navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  expect((await navigation.setSearchQuery('old query', harness.workspace, 'old-root')).status).toBe(
    'superseded',
  )
  expect(
    (
      await navigation.setDiffScope(
        { kind: 'working-tree' },
        { environmentId, sessionId: DOMAIN_SESSION },
      )
    ).status,
  ).toBe('superseded')
  expect(
    await navigation.removeProject({
      environmentId,
      projectId: TEST_PROJECT_ID,
      rootPath: 'old-root',
    }),
  ).toEqual({ status: 'superseded' })
  expect(await next).toEqual({ status: 'applied' })
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/b.ts'),
  )
})

test('closing the addressed editor selects its conflict successor without reopening the closed file on a panel edit', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const conflict = 'conflict-diff:close-successor'
  await navigation.openContent({ owner: harness.workspace, content: testTabContent(conflict) })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/a.ts') })
  const tab = harness.workspace
    .getState()
    .workbenchPanels.editorTabs.find((item) => testContentMatches(item.content, 'repo/a.ts'))
  if (!tab) return expect.unreachable('addressed tab is missing')
  expect(
    (await navigation.editorCommands(harness.workspace).closeTab(testTabId(tab.id))).status,
  ).toBe('applied')
  expect(harness.workspace.getState().selectedTabContent).toEqual(testNullableTabContent(conflict))
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents([conflict]))
  await navigation.setSidePanel('git')
  expect(harness.workspace.getState().selectedTabContent).toEqual(testNullableTabContent(conflict))
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents([conflict]))
})

test('switching workspaces restores the retained ordered tabs and search options', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await mkdir(path.join(server.root, 'second'))
  await registerTestWorkspaceAddress(client, 'second')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const environmentId = confirmedEnvironmentId(application.getSnapshot().origin)
  await navigation.setSearchQuery('remembered', harness.workspace, 'repo')
  await navigation.setSearchOptions(
    { matchMode: 'regex', caseSensitive: true },
    harness.workspace,
    'repo',
  )
  expect(await navigation.openWorkspace({ environmentId, path: 'second' })).toEqual({
    status: 'applied',
  })
  expect((await navigation.openWorkspace({ environmentId, path: 'repo' })).status).toBe('applied')
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/a.ts', 'repo/b.ts']))
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/a.ts'),
  )
  expect(application.getSnapshot().editor.searchBufferStore.getState().active).toMatchObject({
    query: 'remembered',
    matchMode: 'regex',
    caseSensitive: true,
  })
})
