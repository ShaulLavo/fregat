import {
  testTabContents,
  testNullableTabContent,
  testDocumentKey,
  testContentMatches,
} from '../../../../test/factories/document-targets'
import { fileResultFromResponse } from '@/lib/file-system-types'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createEditorBufferSession } from '@singapor/core'
import { readFilePreview } from '@workspace/client-core/files/read'

import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { expect, test } from '../../../../test/fixtures'
import {
  editorTabContents,
  pressBack,
  renderAddressHarness,
  seedWorkspaceCache,
  waitForNavigation,
} from '../../../../test/address'
import { navigationWorkspace } from '../../../../test/factories/navigation-workspace'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'

test('Back and Forward preserve reordered tabs and the current dirty buffer', async ({
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
  const file = await readFilePreview({
    client,
    path: 'repo/c.ts',
    signal: new AbortController().signal,
  })
  const document = harness.documents
    .getState()
    .ensureLiveEditorDocument(fileResultFromResponse(file))
  createEditorBufferSession(document.buffer).applyText('unsaved ')
  const unsaved = document.buffer.materializeFullText()
  const tab = harness.workspace.getState().workbenchPanels.editorTabs.at(-1)
  if (!tab) return expect.unreachable('the current editor tab is missing')
  await navigation.editorCommands(harness.workspace).reorderTab('', tab.id, 0)
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/c.ts', 'repo/a.ts', 'repo/b.ts']),
  )
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/b.ts'),
  )
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/c.ts', 'repo/a.ts', 'repo/b.ts']),
  )
  expect(
    harness.documents.getState().getLiveEditorDocument(testDocumentKey(file.path))?.buffer,
  ).toBe(document.buffer)
  expect(document.buffer.materializeFullText()).toBe(unsaved)
  expect(harness.documents.getState().dirtyDocumentKeys.has(testDocumentKey(file.path))).toBe(true)
  navigation.forward()
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/c.ts'),
  )
  expect(editorTabContents(harness.workspace)).toEqual(
    testTabContents(['repo/c.ts', 'repo/a.ts', 'repo/b.ts']),
  )
  expect(
    harness.documents.getState().getLiveEditorDocument(testDocumentKey(file.path))?.buffer,
  ).toBe(document.buffer)
  expect(document.buffer.canUndo()).toBe(true)
})

test('Back reopens only its destination after explicit tab closes', async ({ client, server }) => {
  const workspace = await navigationWorkspace(client, server)
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/c.ts') })
  const closedIds = harness.workspace
    .getState()
    .workbenchPanels.editorTabs.filter((tab) => !testContentMatches(tab.content, 'repo/c.ts'))
    .map((tab) => tab.id)
  expect(await navigation.editorCommands(harness.workspace).closeTabs(closedIds)).toEqual({
    status: 'applied',
  })
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/c.ts']))
  await pressBack(navigation)
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/b.ts'),
  )
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/c.ts', 'repo/b.ts']))
  navigation.forward()
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/c.ts'),
  )
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/c.ts', 'repo/b.ts']))
})

test('Back and Forward retain each workspace tab set across root changes', async ({
  client,
  server,
}) => {
  const workspace = await navigationWorkspace(client, server)
  await mkdir(path.join(server.root, 'second'))
  await writeFile(path.join(server.root, 'second/index.ts'), 'export const second = true\n')
  await registerTestWorkspaceAddress(client, 'second')
  seedWorkspaceCache({ ...workspace, tabPaths: ['repo/a.ts'] })
  const { application, harness, navigation } = await renderAddressHarness({
    initialEntries: [`${workspace.base}/f/a.ts`],
  })
  await waitForNavigation(navigation)
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('repo/b.ts') })
  const environmentId = confirmedEnvironmentId(application.getSnapshot().origin)
  await navigation.openWorkspace({ environmentId, path: 'second' })
  await navigation.openFile({ owner: harness.workspace, path: filesystemPath('second/index.ts') })
  await pressBack(navigation)
  expect(harness.workspace.getState().rootFolder?.path).toBe('second')
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['second/index.ts']))
  await pressBack(navigation)
  expect(harness.workspace.getState().rootFolder?.path).toBe('repo')
  expect(harness.workspace.getState().selectedTabContent).toEqual(
    testNullableTabContent('repo/b.ts'),
  )
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['repo/a.ts', 'repo/b.ts']))
  navigation.forward()
  await waitForNavigation(navigation)
  expect(harness.workspace.getState().rootFolder?.path).toBe('second')
  expect(editorTabContents(harness.workspace)).toEqual(testTabContents(['second/index.ts']))
})
