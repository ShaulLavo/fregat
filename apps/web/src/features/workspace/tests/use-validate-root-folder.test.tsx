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
import { createCuttableEventsClient, createObservedInProcessClient } from '../../../../test/client'
import { waitForNavigation } from '../../../../test/address'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { readAddressCache } from '@/features/address/state/storage'
import type { Client } from '@/lib/client'
import { afterEach, beforeEach, onTestFinished, vi } from 'vitest'
import { initLogger } from 'evlog'

import { expect, test } from '../../../../test/fixtures'
import { useValidateRootFolder } from '@/features/workspace/hooks/use-validate-root-folder'
import { createFileContent, ensureFolderPath, fetchFile } from '@/lib/file-server'
import type { PickedFsEntry } from '@/lib/file-system-types'
import type { WorkspaceAddress } from '@workspace/contracts'
import { readWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { toClientError } from '@/lib/client-error-taxonomy'

const events: Record<string, unknown>[] = []
beforeEach(() => {
  events.length = 0
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.stubEnv('VITE_CLIENT_LOG_LEVEL', 'info')
  initLogger({
    enabled: true,
    silent: true,
    minLevel: 'info',
    drain: ({ event }) => {
      events.push(event)
    },
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  initLogger({ enabled: false })
})

test('clears a registered cached root folder that no longer exists on disk', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('missing-workspace'), client)
  const address = await registerTestWorkspaceAddress(client, 'missing-workspace')
  await rm(path.join(server.root, 'missing-workspace'), { recursive: true })
  const { store, navigation } = await renderValidation(client, 'missing-workspace', address)

  await waitFor(() => expect(store.getState().rootFolder).toBeNull())
  expect(navigation.getSnapshot().status).toBe('unavailable')
  expect(readAddressCache()).toContain('/~-/')
})

test('clears a registered cached root folder replaced by a file', async ({ client, server }) => {
  await ensureFolderPath(filesystemPath('repo'), client)
  const address = await registerTestWorkspaceAddress(client, 'repo')
  await rm(path.join(server.root, 'repo'), { recursive: true })
  await createFileContent(filesystemPath('repo'), 'hello', client)
  const { store } = await renderValidation(client, 'repo', address)

  await waitFor(() => expect(store.getState().rootFolder).toBeNull())
})

test('keeps a cached root folder that still exists', async ({ client }) => {
  void client
  await ensureFolderPath(filesystemPath('repo'), getClient())
  const address = await registerTestWorkspaceAddress(client, 'repo')
  const { store } = await renderValidation(client, 'repo', address)

  expect(store.getState().rootFolder?.path).toBe('repo')
  await waitFor(() =>
    expect(store.getState().rootFolder?.workspaceAddress).toMatchObject({ path: 'repo' }),
  )
})

test('canonicalizes an alias during registration before publishing its root', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('actual'), client)
  await symlink('actual', path.join(server.root, 'alias'))
  const address = await registerTestWorkspaceAddress(client, 'alias')
  expect(address.path).toBe('actual')
  const requests: Request[] = []
  const observed = createObservedInProcessClient(server, (request) => {
    const route = new URL(request.url).pathname
    if (route === '/fs/workspace-root' || route === `/fs/workspace-address/${address.id}`) {
      requests.push(request)
    }
  })
  const { store } = await renderValidation(observed, address.path, address)

  await waitFor(() => expect(requests.some((request) => request.method === 'GET')).toBe(true))
  expect(requests.every((request) => request.method === 'GET')).toBe(true)
  expect(store.getState().rootFolder?.path).toBe('actual')
  expect(store.getState().rootFolder?.workspaceAddress).toEqual(address)
  expect(store.getState().parkedWorkspaces.has('alias')).toBe(false)
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
  const address = await registerTestWorkspaceAddress(client, 'repo')
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== `/fs/workspace-address/${address.id}`) return
    started.resolve()
    await released.promise
  })
  const { application, store, navigation } = await renderValidation(observed, 'repo', address)
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
  await ensureFolderPath(filesystemPath('missing-workspace'), client)
  const address = await registerTestWorkspaceAddress(client, 'missing-workspace')
  await rm(path.join(server.root, 'missing-workspace'), { recursive: true })
  await ensureFolderPath(filesystemPath('second'), getClient())
  const second = await registerTestWorkspaceAddress(client, 'second')
  const validationStarted = Promise.withResolvers<void>()
  const validationRelease = Promise.withResolvers<void>()
  const switchStarted = Promise.withResolvers<void>()
  const switchRelease = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    const route = new URL(request.url).pathname
    if (route === '/fs/workspace-root') {
      const body = await request.clone().json()
      if (body.path !== 'second') return
      switchStarted.resolve()
      await switchRelease.promise
      return
    }
    if (route !== `/fs/workspace-address/${address.id}`) return
    validationStarted.resolve()
    await validationRelease.promise
  })
  const { application, store, navigation } = await renderValidation(
    observed,
    'missing-workspace',
    address,
  )
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

test('an addressed root validates through its read-only GET without registration', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('repo'), client)
  const address = await registerTestWorkspaceAddress(client, 'repo')
  const firstRequest = Promise.withResolvers<Request>()
  const observed = createObservedInProcessClient(server, (request) => {
    const route = new URL(request.url).pathname
    if (route === '/fs/workspace-root' || route.startsWith('/fs/workspace-address/')) {
      firstRequest.resolve(request)
    }
  })
  await renderValidation(observed, 'repo', address)
  const request = await firstRequest.promise
  expect(request.method).toBe('GET')
  expect(new URL(request.url).pathname).toBe(`/fs/workspace-address/${address.id}`)
  await waitFor(() =>
    expect(events.filter((event) => event.action === 'fs.read_workspace_address')).toMatchObject([
      { level: 'info', outcome: 'ok' },
    ]),
  )
})

test('confirmed page departure aborts the addressed-root validation request', async ({
  client,
  server,
}) => {
  await ensureFolderPath(filesystemPath('repo'), client)
  const address = await registerTestWorkspaceAddress(client, 'repo')
  const requests: Request[] = []
  const released = Promise.withResolvers<void>()
  const observed = createObservedInProcessClient(server, async (request) => {
    const route = new URL(request.url).pathname
    if (route !== '/fs/workspace-root' && route !== `/fs/workspace-address/${address.id}`) return
    requests.push(request)
    await released.promise
    request.signal.throwIfAborted()
  })
  const { store } = await renderValidation(observed, 'repo', address)
  try {
    // StrictMode disposes the first watch before mounting the retained owner.
    await waitFor(() => expect(requests.some((request) => !request.signal.aborted)).toBe(true))
    const request = requests.find((request) => !request.signal.aborted)!
    expect(request.signal.aborted).toBe(false)
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(() => expect(request.signal.aborted).toBe(true))
    expect(store.getState().rootFolder?.workspaceAddress?.id).toBe(address.id)
  } finally {
    released.resolve()
    window.dispatchEvent(new Event('pageshow'))
  }
})

test.for(['http503', 'network'] as const)(
  'an addressed-root %s failure stays actionable and retains the root',
  async (mode, { client, server }) => {
    await ensureFolderPath(filesystemPath('repo'), client)
    const address = await registerTestWorkspaceAddress(client, 'repo')
    const route = `/fs/workspace-address/${address.id}`
    const requests: Request[] = []
    const observed = createCuttableEventsClient(server, (request) => {
      if (new URL(request.url).pathname !== route) return
      requests.push(request)
      if (mode === 'network') throw new DOMException('Fixture network failed.', 'NetworkError')
      return Response.json({ message: 'Fixture service unavailable.' }, { status: 503 })
    }).client
    const { store } = await renderValidation(observed, 'repo', address)

    await waitFor(() =>
      expect(events.filter((event) => event.action === 'fs.read_workspace_address')).toMatchObject([
        { level: 'warn', outcome: 'error', error: { status: 503 } },
      ]),
    )
    expect(requests).toHaveLength(1)
    expect(requests[0]!.signal.aborted).toBe(false)
    expect(store.getState().rootFolder?.workspaceAddress).toEqual(address)
  },
)

test('a real workspace address GET 404 has the missing-root taxonomy', async ({ client }) => {
  const address = testWorkspaceAddress('unregistered-root')
  const signal = new AbortController().signal
  const error = await readWorkspaceAddress({ client, id: address.id, signal }).catch(
    (error: unknown) => error,
  )
  expect(error).toMatchObject({ status: 404 })
  expect(toClientError(error).category).toBe('not_found')
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
  }
}

async function renderValidation(client: Client, rootPath: string, address: WorkspaceAddress) {
  const { application, commands, editor } = await createAddressTestRuntime(client)
  const root = pickedDirectory(rootPath)
  commands.switchRootFolder({ ...root, workspaceAddress: address })
  const navigation = createTestNavigation({ application })
  const rendered = renderApplication(<RootValidation />, application, { navigation })
  onTestFinished(() => rendered.unmount())
  return { ...rendered, application, store: editor.workspaceStore }
}

function RootValidation() {
  useValidateRootFolder()
  return null
}
