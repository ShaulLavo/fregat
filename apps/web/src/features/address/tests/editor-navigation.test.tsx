import { editorTabRecordsForWorkbenchPanels } from '@/features/workbench/utils/panels'
import {
  testTabContent,
  testDocumentRef,
  testNullableTabContent,
  testContentMatches,
  testTabContents,
} from '../../../../test/factories/document-targets'
import { filesystemPath, tabId as testTabId } from '@/lib/documents/utils/identity'
import { rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../test/fixtures'
import {
  initializeNavigationGitWorkspace,
  navigationWorkspace,
} from '../../../../test/factories/navigation-workspace'
import { createObservedInProcessClient } from '../../../../test/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'
import {
  editorTabContents,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'

test('committed multi-file rename reconciles every path', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await rename(path.join(server.root, 'repo/a.ts'), path.join(server.root, 'repo/renamed-a.ts'))
  await rename(path.join(server.root, 'repo/b.ts'), path.join(server.root, 'repo/renamed-b.ts'))
  const commands = navigation.editorCommands(harness.workspace)
  const results = ['a', 'b'].map((name) =>
    commands.renameLiveEditorDocument(
      filesystemPath(`repo/${name}.ts`),
      filesystemPath(`repo/renamed-${name}.ts`),
    ),
  )
  await Promise.all(results.map((result) => result.settled))
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/renamed-a.ts', 'repo/renamed-b.ts']),
  )
  expect(navigation.router.history.location.href).toContain('/f/renamed-a.ts')
  expect(navigation.router.history.location.href).not.toContain('f%2Fb.ts')
})

test('committed multi-file deletion reconciles every path', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await Promise.all(['a', 'b'].map((name) => unlink(path.join(server.root, `repo/${name}.ts`))))
  const commands = navigation.editorCommands(harness.workspace)
  const results = ['a', 'b'].map((name) =>
    commands.discardLiveEditorDocument(testDocumentRef(`repo/${name}.ts`)),
  )
  await Promise.all(results.map((result) => result.settled))
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/c.ts']))
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/c.ts'),
  )
  expect(navigation.router.history.location.href).toContain('/f/c.ts')
})

test('resource changes reconcile a pending file without canceling its completion', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await rename(path.join(server.root, 'repo/a.ts'), path.join(server.root, 'repo/renamed.ts'))
  await unlink(path.join(server.root, 'repo/b.ts'))
  const commands = navigation.editorCommands(harness.workspace)
  const results: Array<ReturnType<typeof commands.renameLiveEditorDocument>> = []
  const unsubscribe = navigation.router.history.subscribe(({ action }) => {
    if (action.type !== 'PUSH') return
    results.push(
      commands.renameLiveEditorDocument(
        filesystemPath('repo/a.ts'),
        filesystemPath('repo/renamed.ts'),
      ),
    )
    results.push(commands.discardLiveEditorDocument(testDocumentRef('repo/b.ts')))
  })
  try {
    expect(await commands.openFileSurface(filesystemPath('repo/c.ts'))).toEqual({
      status: 'applied',
    })
    expect(results).toHaveLength(2)
    expect(await Promise.all(results.map((result) => result.settled))).toEqual([
      { status: 'applied' },
      { status: 'applied' },
    ])
    expect(editorTabContents(harness.workspace)).toEqual(
      testTabContents(['repo/renamed.ts', 'repo/c.ts']),
    )
    expect(harness.workspace.getState().selectedTabContent).toEqual(
      testNullableTabContent('repo/c.ts'),
    )
    expect(navigation.router.history.location.href).toContain('/f/c.ts')
  } finally {
    unsubscribe()
  }
})

test('resource changes reconcile an async preparation without canceling its destination', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await initializeNavigationGitWorkspace(server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const reached = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/git/diff') return
    reached.resolve()
    await released.promise
  })
  const owner = application.getSnapshot()
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, observed)
  try {
    const pending = navigation.openDiff({
      owner: harness.workspace,
      row: {
        file: { path: 'repo/a.ts', status: 'modified', index: 'unmodified', worktree: 'modified' },
        section: 'worktree',
        status: 'modified',
      },
    })
    await reached.promise
    await rename(path.join(server.root, 'repo/b.ts'), path.join(server.root, 'repo/renamed.ts'))
    const renamed = navigation
      .editorCommands(harness.workspace)
      .renameLiveEditorDocument(filesystemPath('repo/b.ts'), filesystemPath('repo/renamed.ts'))
    released.resolve()
    expect(await pending).toEqual({ status: 'applied' })
    expect(await renamed.settled).toEqual({ status: 'applied' })
    expect(editorTabContents(harness.workspace)).toContainEqual(testTabContent('repo/renamed.ts'))
    expect(editorTabContents(harness.workspace)).not.toContainEqual(testTabContent('repo/b.ts'))
    expect(harness.workspace.getState().selectedTabContent).toMatchObject({
      kind: 'document',
      document: { kind: 'git-diff', source: { kind: 'snapshot', path: 'repo/a.ts' } },
    })
  } finally {
    released.resolve()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, client)
  }
})

test('repeated reopen consumes the closed-editor stack', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts', 'repo/c.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/c.ts`],
  })
  await waitForNavigation(navigation)
  const commands = navigation.editorCommands(harness.workspace)
  const b = editorTabRecordsForWorkbenchPanels(harness.workspace.getState().workbenchPanels).find(
    (tab) => testContentMatches(tab.content, 'repo/b.ts'),
  )
  const c = editorTabRecordsForWorkbenchPanels(harness.workspace.getState().workbenchPanels).find(
    (tab) => testContentMatches(tab.content, 'repo/c.ts'),
  )
  if (!b || !c) return expect.unreachable('Seeded editor tabs are missing')
  await commands.closeTab(testTabId(b.id))
  await commands.closeTab(testTabId(c.id))
  expect(harness.workspace.getState().recentlyClosedTabs).toEqual(
    testTabContents(['repo/c.ts', 'repo/b.ts']),
  )
  expect(await commands.reopenClosedEditor()).toEqual({ status: 'applied' })
  expect(await commands.reopenClosedEditor()).toEqual({ status: 'applied' })
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/a.ts', 'repo/c.ts', 'repo/b.ts']),
  )
})

test('outside-root definitions retain their target range', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  await writeFile(path.join(server.root, 'external.ts'), 'one\ntwo\nthree\nfour\nfive\n')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const target = {
    path: 'external.ts',
    uri: 'file://external.ts',
    range: { start: { line: 4, character: 2 }, end: { line: 4, character: 3 } },
  }
  expect(await navigation.editorCommands(harness.workspace).openDefinition(target)).toEqual({
    status: 'applied',
  })
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('external.ts'),
  )
  expect(application.getSnapshot().editor.uiStore.getState().definitionTarget?.target).toEqual(
    target,
  )
})

test('opening a chat file reveals the previously hidden editor tool', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  expect(await navigation.setMode('chat', harness.workspace)).toEqual({ status: 'applied' })
  expect(
    await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/a.ts') }),
  ).toEqual({
    status: 'applied',
  })
  expect(harness.workspace.getState().chatModePanels.activeToolTab).toBe('editor')
  await navigation.setChatModePanels(
    { ...harness.workspace.getState().chatModePanels, toolPaneOpen: false },
    harness.workspace,
  )
  expect(harness.workspace.getState().chatModePanels.toolPaneOpen).toBe(false)
  expect(
    await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') }),
  ).toEqual({
    status: 'applied',
  })
  expect(harness.workspace.getState().chatModePanels.toolPaneOpen).toBe(true)
})
