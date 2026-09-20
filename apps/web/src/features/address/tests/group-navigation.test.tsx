import { createEditorBufferSession } from '@singapore-editor/core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { readFilePreview } from '@workspace/client-core/files/read'
import { test, expect } from '../../../../test/fixtures'
import {
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { fileResultFromResponse } from '@/lib/file-system-types'
import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import {
  activeEditorGroup,
  activeEditorTab,
  allEditorGroups,
  allEditorTabs,
  closeTabInGroups,
} from '@/lib/documents/utils/groups'

test('opening a file and switching workspaces preserve each group tab order', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await mkdir(path.join(server.root, 'second'))
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/b.ts`],
  })
  await waitForNavigation(navigation)
  const commands = navigation.editorCommands(harness.workspace)
  const groups = () => harness.workspace.getState().workbenchPanels.editorGroups
  const order = () => allEditorGroups(groups()).map((group) => group.tabs.map((tab) => tab.id))
  const [a, b] = activeEditorGroup(groups()).tabs
  if (!a || !b) return expect.unreachable('initial tabs were not restored')
  await commands.placeTab({
    tabId: b.id,
    mode: 'copy',
    target: { kind: 'edge', groupId: groups().activeGroupId, edge: 'right' },
  })
  await commands.placeTab({
    tabId: a.id,
    mode: 'copy',
    target: { kind: 'group', groupId: groups().activeGroupId },
  })
  const initialOrder = order()
  expect(initialOrder[0]).toEqual([a.id, b.id])
  expect(activeEditorGroup(groups()).tabs.map((tab) => tab.content)).toEqual([b.content, a.content])

  const selected = activeEditorTab(groups())!.id
  expect(
    await navigation.openWorkspace({ environmentId: TEST_ENVIRONMENT_ID, path: 'second' }),
  ).toEqual({ status: 'applied' })
  expect(
    await navigation.openWorkspace({ environmentId: TEST_ENVIRONMENT_ID, path: 'repo' }),
  ).toEqual({ status: 'applied' })
  expect(order()).toEqual(initialOrder)
  expect(activeEditorTab(groups())?.id).toBe(selected)

  expect(await commands.openFileSurface(filesystemPath('repo/c.ts'))).toEqual({ status: 'applied' })
  const opened = activeEditorTab(groups())!
  const expectedOrder = [initialOrder[0], [...initialOrder[1]!, opened.id]]
  expect(order()).toEqual(expectedOrder)
})

// The URL identifies content; these commands must preserve the chosen view independently.
test('split copy and exact selection keep separate views behind the same URL', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const initialGroups = harness.workspace.getState().workbenchPanels.editorGroups
  const source = activeEditorTab(initialGroups)!
  const file = fileResultFromResponse(
    await readFilePreview({ client, path: 'repo/a.ts', signal: new AbortController().signal }),
  )
  const sourceView = harness.documents.getState().ensureEditorView(source.id, file)
  sourceView.view.setSelection(1, 3)
  harness.documents.getState().setEditorViewScrollPosition(source.id, { left: 8, top: 180 })
  createEditorBufferSession(sourceView.buffer).applyText('unsaved ')
  const commands = navigation.editorCommands(harness.workspace)
  const href = navigation.router.history.location.href
  expect(
    await commands.placeTab({
      tabId: source.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: initialGroups.activeGroupId, edge: 'right' },
    }),
  ).toEqual({ status: 'applied' })
  const split = harness.workspace.getState().workbenchPanels.editorGroups
  const copied = activeEditorTab(split)!
  expect(copied.id).not.toBe(source.id)
  expect(allEditorGroups(split)).toHaveLength(2)
  expect(navigation.router.history.location.href).toBe(href)
  const copiedView = harness.documents.getState().viewsByTabId[copied.id]!
  expect(copiedView.view).not.toBe(sourceView.view)
  expect(copiedView.documentKey).toBe(sourceView.key)
  expect(copiedView.view.getSelections()).toEqual(sourceView.view.getSelections())
  expect(copiedView.scrollPosition).toEqual({ left: 8, top: 180 })
  harness.documents.getState().setEditorViewScrollPosition(copied.id, { left: 0, top: 560 })
  expect(sourceView.view.getScrollPosition()).toEqual({ left: 8, top: 180 })
  expect(
    await commands.selectTab({ groupId: initialGroups.activeGroupId, tabId: source.id }),
  ).toEqual({ status: 'applied' })
  expect(activeEditorTab(harness.workspace.getState().workbenchPanels.editorGroups)?.id).toBe(
    source.id,
  )
  expect(
    allEditorTabs(harness.workspace.getState().workbenchPanels.editorGroups).map((tab) => tab.id),
  ).toEqual([source.id, copied.id])
  expect(navigation.router.history.location.href).toBe(href)
  expect(sourceView.buffer.isDirty()).toBe(true)
  expect(await commands.discardAndCloseTab(source.id)).toEqual({ status: 'applied' })
  expect(
    harness.documents.getState().getLiveEditorDocument(fileDocumentKey(filesystemPath('repo/a.ts')))
      ?.buffer,
  ).toBe(sourceView.buffer)
  expect(sourceView.buffer.isDirty()).toBe(true)
  expect(await commands.discardAndCloseTab(copied.id)).toEqual({ status: 'applied' })
  expect(
    harness.documents
      .getState()
      .getLiveEditorDocument(fileDocumentKey(filesystemPath('repo/a.ts'))),
  ).toBeNull()
})

test('placement rechecks source ownership after the router awaits', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/b.ts`],
  })
  await waitForNavigation(navigation)
  const initialGroups = harness.workspace.getState().workbenchPanels.editorGroups
  const source = activeEditorGroup(initialGroups).tabs[0]!
  let removed = false
  const unsubscribe = navigation.router.history.subscribe(() => {
    if (removed) return
    removed = true
    const state = harness.workspace.getState()
    state.setWorkbenchPanels({
      ...state.workbenchPanels,
      editorGroups: closeTabInGroups(state.workbenchPanels.editorGroups, source.id),
    })
  })
  try {
    const result = await navigation.editorCommands(harness.workspace).placeTab({
      tabId: source.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: initialGroups.activeGroupId, edge: 'bottom' },
    })
    expect(removed).toBe(true)
    expect(result).toEqual({ status: 'superseded' })
    expect(navigation.router.history.location.href).toContain('/f/b.ts')
    const final = harness.workspace.getState().workbenchPanels.editorGroups
    expect(allEditorGroups(final)).toHaveLength(1)
    expect(allEditorTabs(final)).toHaveLength(1)
    expect(activeEditorGroup(final).tabs[0]?.id).not.toBe(source.id)
  } finally {
    unsubscribe()
  }
})

test('a workspace switch during placement does not reopen the previous root', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts', 'repo/b.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/b.ts`],
  })
  await waitForNavigation(navigation)
  const groups = harness.workspace.getState().workbenchPanels.editorGroups
  const source = activeEditorGroup(groups).tabs[0]!
  let switched = false
  const unsubscribe = navigation.router.history.subscribe(() => {
    if (switched) return
    switched = true
    harness.workspace.getState().clearRootFolder()
  })
  try {
    const result = await navigation.editorCommands(harness.workspace).placeTab({
      tabId: source.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: groups.activeGroupId, edge: 'right' },
    })
    expect(switched).toBe(true)
    expect(result).toEqual({ status: 'superseded' })
    expect(harness.workspace.getState().rootFolder).toBeNull()
    expect(allEditorTabs(harness.workspace.getState().workbenchPanels.editorGroups)).toHaveLength(0)
    expect(
      allEditorTabs(
        harness.workspace.getState().parkedWorkspaces.get('repo')!.workbenchPanels.editorGroups,
      ),
    ).toHaveLength(2)
  } finally {
    unsubscribe()
  }
})

test('a rejected tab selection does not reopen a root closed during preparation', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  const groups = harness.workspace.getState().workbenchPanels.editorGroups
  const result = navigation.editorCommands(harness.workspace).selectTab({
    groupId: groups.activeGroupId,
    tabId: tabId('removed-tab'),
  })
  harness.workspace.getState().clearRootFolder()

  expect(await result).toEqual({ status: 'superseded' })
  expect(harness.workspace.getState().rootFolder).toBeNull()
  expect(allEditorTabs(harness.workspace.getState().workbenchPanels.editorGroups)).toHaveLength(0)
})
