import { activeEditorTab as selectedGroupTab, allEditorTabs } from '@/lib/documents/utils/groups'
import { getClient } from '@/lib/client'
import { testDocumentKey, testTabContent } from '../../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { waitFor } from '@testing-library/react'
import { rm, symlink } from 'node:fs/promises'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import path from 'node:path'
import { renderApplication } from '../../../../test/render'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { createTestNavigation } from '../../../../test/factories/navigation'
import {
  registerTestWorkspaceAddress,
  testWorkspaceAddress,
} from '../../../../test/factories/workspace-address'
import { createObservedInProcessClient } from '../../../../test/client'
import { waitForNavigation } from '../../../../test/address'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { readAddressCache } from '@/features/address/state/storage'
import type { Client } from '@/lib/client'
import { onTestFinished } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { useValidateRootFolder } from '@/features/workspace/hooks/use-validate-root-folder'
import { createFileContent, ensureFolderPath, fetchFile } from '@/lib/file-server'
import type { PickedFsEntry } from '@/lib/file-system-types'

test('clears a cached root folder that no longer exists on disk', async ({ client }) => {
  const { store, navigation } = await renderValidation(client, 'missing-workspace')

  await waitFor(() => expect(store.getState().rootFolder).toBeNull())
  expect(navigation.getSnapshot().status).toBe('unavailable')
  expect(readAddressCache()).toContain('/~-/')
})

test('clears a cached root folder that points at a file', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/notes.txt'), 'hello', getClient())
  const { store } = await renderValidation(client, 'repo/notes.txt')

  await waitFor(() => expect(store.getState().rootFolder).toBeNull())
})

test('keeps a cached root folder that still exists', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  const { store } = await renderValidation(client, 'repo')

  expect(store.getState().rootFolder?.path).toBe('repo')
  await waitFor(() =>
    expect(store.getState().rootFolder?.workspaceAddress).toMatchObject({ path: 'repo' }),
  )
})

test('restores a cached alias through the canonical workspace switch', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('actual'), getClient())
  await symlink('actual', path.join(server.root, 'alias'))
  const { store } = await renderValidation(client, 'alias')

  await waitFor(() => expect(store.getState().rootFolder?.path).toBe('actual'))
  expect(store.getState().rootFolder?.workspaceAddress?.path).toBe('actual')
  expect(store.getState().parkedWorkspaces.has('alias')).toBe(true)
})

test('late invalidation survives same-workspace navigation and preserves the dirty buffer', async ({
  client,
  server,
}) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  await createFileContent(filesystemPath('repo/a.ts'), 'saved\n', getClient())
  const file = await fetchFile(
    filesystemPath('repo/a.ts'),
    new AbortController().signal,
    getClient(),
  )
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/workspace-root') return
    started.resolve()
    await released.promise
  })
  const { application, store, navigation } = await renderValidation(observed, 'repo')
  try {
    await started.promise
    expect((await waitForNavigation(navigation)).status).toBe('applied')
    expect(await navigation.openFile({ owner: store, path: filesystemPath('repo/a.ts') })).toEqual({
      status: 'applied',
    })
    const editor = application.getSnapshot().editor
    const tabId = selectedGroupTab(store.getState().workbenchPanels.editorGroups)?.id ?? null
    if (!tabId) return expect.unreachable('the editor tab is missing')
    const view = editor.documentStore.getState().ensureEditorView(tabId, file)
    createEditorBufferSession(view.buffer, view.view).applyText('unsaved\n')
    expect(await navigation.setSidePanel('git')).toEqual({ status: 'applied' })
    await rm(path.join(server.root, 'repo'), { recursive: true })
    released.resolve()
    await waitFor(() => expect(store.getState().rootFolder).toBeNull())
    expect(navigation.getSnapshot().status).toBe('unavailable')
    expect(readAddressCache()).toContain('/~-/')
    const parked = store.getState().parkedWorkspaces.get('repo')
    if (!parked) return expect.unreachable('the removed workspace was not parked')
    expect(allEditorTabs(parked.workbenchPanels.editorGroups).map((tab) => tab.content)).toEqual([
      testTabContent('repo/a.ts'),
    ])
    expect(
      editor.documentStore.getState().getLiveEditorDocument(testDocumentKey('repo/a.ts'))?.buffer,
    ).toBe(view.buffer)
    expect(view.buffer.materializeFullText()).toBe('saved\nunsaved\n')
    expect(
      editor.documentStore.getState().dirtyDocumentKeys.has(testDocumentKey('repo/a.ts')),
    ).toBe(true)
  } finally {
    released.resolve()
  }
})

test('late invalidation clears only the old root while a newer workspace finishes opening', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('second'), getClient())
  const second = await registerTestWorkspaceAddress(client, 'second')
  const validationStarted = Promise.withResolvers<void>()
  const validationRelease = Promise.withResolvers<void>()
  const switchStarted = Promise.withResolvers<void>()
  const switchRelease = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/fs/workspace-root') return
    const body = await request.clone().json()
    if (body.path === 'second') {
      switchStarted.resolve()
      await switchRelease.promise
      return
    }
    validationStarted.resolve()
    await validationRelease.promise
  })
  const { application, store, navigation } = await renderValidation(observed, 'missing-workspace')
  try {
    await validationStarted.promise
    await waitForNavigation(navigation)
    const pending = navigation.openWorkspace({
      environmentId: confirmedEnvironmentId(application.getSnapshot().origin),
      path: second.path,
    })
    await switchStarted.promise
    validationRelease.resolve()
    await waitFor(() => expect(store.getState().rootFolder).toBeNull())
    expect(navigation.getSnapshot().status).toBe('pending')
    switchRelease.resolve()
    expect(await pending).toEqual({ status: 'applied' })
    expect(store.getState().rootFolder?.path).toBe('second')
    expect(readAddressCache()).toContain(second.id)
  } finally {
    validationRelease.resolve()
    switchRelease.resolve()
  }
})

function pickedDirectory(path: string): PickedFsEntry {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 0,
    type: 'directory',
    version: '',
    workspaceAddress: testWorkspaceAddress(path),
  }
}

async function renderValidation(client: Client, rootPath: string) {
  const { application, commands, editor } = await createAddressTestRuntime(client)
  commands.switchRootFolder(pickedDirectory(rootPath))
  const navigation = createTestNavigation({ application })
  const rendered = renderApplication(<RootValidation />, application, { navigation })
  onTestFinished(() => rendered.unmount())
  return { ...rendered, application, store: editor.workspaceStore }
}

function RootValidation() {
  useValidateRootFolder()
  return null
}
