import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, onTestFinished, vi } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsSnapshot, SettingsWriteTarget } from '@workspace/contracts'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { createEditorBufferSession } from '@singapor/core'

import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'
import { createEditorTabRecord, settingsTab } from '@/lib/documents/utils/tabs'
import { FocusService } from '@/lib/focus/state/service'
import { statPath } from '@/lib/file-server'
import type { Client } from '@/lib/client'
import { log } from '@/lib/client-logging'

import { createObservedInProcessClient } from '../client'
import { createTestApplicationRuntime } from '../factories/application-runtime'
import { installTestClient } from '../factories/client-binding'
import { createTestCommandRuntime } from '../factories/command-runtime'
import { TestEditorStateProvider } from '../factories/editor-state-provider'
import { SettingsLifecycle } from '../factories/settings-lifecycle'
import { registerTestWorkspaceAddress } from '../factories/workspace-address'
import { seedSettingsBuffer, settingsLayerFile } from '../factories/settings'
import { expect, test } from '../fixtures'
import { renderWithProviders } from '../render'
import type { TestServer } from '../server'

const USER_TEXT = '{ "editor.fontSize": 23 }\n'
const WORKSPACE_TEXT = '{ "editor.lineHeight": 29 }\n'
const EXTERNAL_TEXT = '{ "editor.fontSize": 27 }\n'

afterEach(() => {
  selectSettingsScope('user')
  selectSettingsView('form')
})

test('active Save follows JSON scope, form ignores its retained JSON view, and Save All saves both scopes', async ({
  server,
}) => {
  const lifecycle = await mountLifecycle(server)
  seedBothScopes(lifecycle)
  const commands = createTestCommandRuntime({
    application: lifecycle.application,
    focus: new FocusService(),
    queryClient: lifecycle.queryClient,
  })
  selectSettingsView('json')
  selectSettingsScope('user')
  await act(async () => {
    const ticket = commands.bus.dispatch('workspace.saveFile', invocation())
    expect((await ticket.completion).status).toBe('handled')
  })
  expectSettings(lifecycle, 'user', USER_TEXT, false)
  expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, true)
  expect(settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'user').text).toBe(
    USER_TEXT,
  )
  expect(
    settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'workspace').text,
  ).toBe(lifecycle.initialWorkspaceText)

  selectSettingsScope('workspace')
  lifecycle.editor.documentStore
    .getState()
    .ensureEditorViewForDocument(
      settingsTabId(lifecycle),
      documentKey(settingsJsonDocument('workspace')),
    )
  selectSettingsView('form')
  const writesBeforeFormSave = lifecycle.rawWrites.length
  await act(async () => {
    const ticket = commands.bus.dispatch('workspace.saveFile', invocation())
    expect((await ticket.completion).status).toBe('disabled')
  })
  expect(lifecycle.rawWrites).toHaveLength(writesBeforeFormSave)
  expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, true)

  lifecycle.editor.documentStore
    .getState()
    .setLiveEditorDocumentDirty(documentKey(settingsJsonDocument('user')), true)
  await act(async () => {
    const ticket = commands.bus.dispatch('workspace.saveAllFiles', invocation())
    expect(await ticket.completion).toEqual({ status: 'handled' })
  })
  expectSettings(lifecycle, 'user', USER_TEXT, false)
  expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, false)
  expect(
    settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'workspace').text,
  ).toBe(WORKSPACE_TEXT)
  expect(lifecycle.rawWrites.map((write) => write.target)).toEqual(['user', 'user', 'workspace'])
})

for (const choice of ['Save', 'Discard', 'Cancel'] as const) {
  test(`closing from form with two dirty scopes applies ${choice} to both members`, async ({
    server,
  }) => {
    const lifecycle = await mountLifecycle(server)
    seedBothScopes(lifecycle)
    fireEvent.click(screen.getByRole('button', { name: 'Close all settings' }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: choice, exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    if (choice === 'Cancel') {
      expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('1')
      expectSettings(lifecycle, 'user', USER_TEXT, true)
      expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, true)
      expect(lifecycle.rawWrites).toEqual([])
      return
    }
    expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('0')
    if (choice === 'Discard') {
      expect(
        lifecycle.editor.documentStore
          .getState()
          .getLiveEditorDocument(documentKey(settingsJsonDocument('user'))),
      ).toBeNull()
      expect(
        lifecycle.editor.documentStore
          .getState()
          .getLiveEditorDocument(documentKey(settingsJsonDocument('workspace'))),
      ).toBeNull()
      expect(lifecycle.rawWrites).toEqual([])
      const saved = await fetchSettings(undefined, lifecycle.client)
      expect(settingsLayerFile(saved, 'user').text).toBe(lifecycle.initialUserText)
      expect(settingsLayerFile(saved, 'workspace').text).toBe(lifecycle.initialWorkspaceText)
      return
    }
    expectSettings(lifecycle, 'user', USER_TEXT, false)
    expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, false)
    expect(lifecycle.rawWrites.map((write) => write.target)).toEqual(['user', 'workspace'])
    const saved = await fetchSettings(undefined, lifecycle.client)
    expect(settingsLayerFile(saved, 'user').text).toBe(USER_TEXT)
    expect(settingsLayerFile(saved, 'workspace').text).toBe(WORKSPACE_TEXT)
  })
}

test('duplicate settings tabs share both members and only their final close saves each once', async ({
  server,
}) => {
  const lifecycle = await mountLifecycle(server)
  seedBothScopes(lifecycle)
  const firstTabId = settingsTabId(lifecycle)
  act(() => {
    const state = lifecycle.editor.workspaceStore.getState()
    const duplicate = createEditorTabRecord(settingsTab())
    state.setWorkbenchPanels({
      ...state.workbenchPanels,
      editorTabs: [...state.workbenchPanels.editorTabs, duplicate],
    })
  })
  fireEvent.click(screen.getByRole('button', { name: `Close ${firstTabId}`, exact: true }))
  await waitFor(() => expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('1'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expectSettings(lifecycle, 'user', USER_TEXT, true)
  expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, true)
  expect(lifecycle.rawWrites).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: 'Close all settings' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('0'))
  expect(lifecycle.rawWrites.map((write) => write.target)).toEqual(['user', 'workspace'])
})

for (const conflict of ['already conflicted', 'newly stale'] as const) {
  test(`${conflict} user scope rejects save-close while workspace saves, then resolves and closes`, async ({
    server,
  }) => {
    const lifecycle = await mountLifecycle(server)
    seedBothScopes(lifecycle)
    const external = await writeExternal(lifecycle.initial, lifecycle.client)
    if (conflict === 'already conflicted') {
      lifecycle.editor.documentStore
        .getState()
        .markSettingsDocumentConflict(
          documentKey(settingsJsonDocument('user')),
          EXTERNAL_TEXT,
          settingsLayerFile(external, 'user').revision,
        )
    }
    const saves = vi.spyOn(lifecycle.editor.saveService, 'save')
    const operationLogs = vi.spyOn(log, 'info')
    onTestFinished(() => saves.mockRestore())
    onTestFinished(() => operationLogs.mockRestore())
    fireEvent.click(screen.getByRole('button', { name: 'Close all settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save', exact: true }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This tab could not be saved.'),
    )
    expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('1')
    expect(await saves.mock.results[0]?.value).toBe(false)
    expect(await saves.mock.results[1]?.value).toBe(true)
    expect(operationLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'settings.buffer-save',
        acknowledged: false,
        dirty: true,
        documentKey: documentKey(settingsJsonDocument('user')),
        outcome: conflict === 'already conflicted' ? 'conflict' : 'stale',
        priorSyncState: conflict === 'already conflicted' ? 'conflict' : 'idle',
        syncState: 'conflict',
        target: 'user',
      }),
    )
    expect(currentDocument(lifecycle, 'user').sync).toMatchObject({
      kind: 'settings',
      state: 'conflict',
    })
    expectSettings(lifecycle, 'user', USER_TEXT, true)
    expectSettings(lifecycle, 'workspace', WORKSPACE_TEXT, false)
    expect(settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'user').text).toBe(
      EXTERNAL_TEXT,
    )
    expect(
      settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'workspace').text,
    ).toBe(WORKSPACE_TEXT)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const sync = new SettingsSyncService(lifecycle.editor.documentStore, lifecycle.queryClient)
    await act(async () => sync.overwrite(currentDocument(lifecycle, 'user')))
    expectSettings(lifecycle, 'user', USER_TEXT, false)
    expect(settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'user').text).toBe(
      USER_TEXT,
    )
    act(() => {
      createEditorBufferSession(currentDocument(lifecycle, 'user').buffer).applyText(' ')
    })
    expectSettings(lifecycle, 'user', `${USER_TEXT} `, true)
    fireEvent.click(screen.getByRole('button', { name: 'Close all settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('0'))
    expect(await saves.mock.results[2]?.value).toBe(true)
    expectSettings(lifecycle, 'user', `${USER_TEXT} `, false)
    expect(settingsLayerFile(await fetchSettings(undefined, lifecycle.client), 'user').text).toBe(
      `${USER_TEXT} `,
    )
  })
}

async function mountLifecycle(server: TestServer) {
  const rawWrites: { readonly target: unknown }[] = []
  const requests: Request[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    requests.push(request)
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/settings/raw') return
    rawWrites.push(await request.clone().json())
  })
  const restore = installTestClient(client)
  onTestFinished(restore)
  const initial = await fetchSettings(undefined, client)
  const application = createTestApplicationRuntime()
  const { editor, queryClient } = application.getSnapshot()
  await mkdir(join(server.root, 'project'))
  const folder = await statPath('project', new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, 'project')
  editor.workspaceStore.getState().switchWorkspace({ ...folder, workspaceAddress })
  queryClient.setQueryData(settingsKeys.document(), initial)
  renderWithProviders(
    <TestEditorStateProvider>
      <SettingsLifecycle />
    </TestEditorStateProvider>,
    { application, queryClient },
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }))
  await waitFor(() => expect(screen.getByLabelText('Settings tab count')).toHaveTextContent('1'))
  onTestFinished(() => {
    const fileRequests = requests.filter((request) =>
      new URL(request.url).pathname.startsWith('/fs/'),
    )
    for (const request of fileRequests)
      expect(decodeURIComponent(request.url)).not.toMatch(/settings-json:|settings:/)
  })
  return {
    client,
    application,
    editor,
    initial,
    queryClient,
    rawWrites,
    initialUserText: settingsLayerFile(initial, 'user').text,
    initialWorkspaceText: settingsLayerFile(initial, 'workspace').text,
  }
}

type Lifecycle = Awaited<ReturnType<typeof mountLifecycle>>

function seedBothScopes(lifecycle: Lifecycle) {
  act(() => {
    selectSettingsView('json')
    selectSettingsScope('user')
    seedSettingsBuffer(lifecycle.editor.documentStore, lifecycle.initial, 'user', USER_TEXT)
    selectSettingsScope('workspace')
    seedSettingsBuffer(
      lifecycle.editor.documentStore,
      lifecycle.initial,
      'workspace',
      WORKSPACE_TEXT,
    )
    selectSettingsView('form')
  })
}

function currentDocument(lifecycle: Lifecycle, target: SettingsWriteTarget) {
  const document = lifecycle.editor.documentStore
    .getState()
    .getLiveEditorDocument(documentKey(settingsJsonDocument(target)))
  expect(document).not.toBeNull()
  return document!
}

function expectSettings(
  lifecycle: Lifecycle,
  target: SettingsWriteTarget,
  text: string,
  dirty: boolean,
) {
  expect(currentDocument(lifecycle, target).buffer.materializeFullText()).toBe(text)
  expect(
    lifecycle.editor.documentStore
      .getState()
      .dirtyDocumentKeys.has(documentKey(settingsJsonDocument(target))),
  ).toBe(dirty)
}

function settingsTabId(lifecycle: Lifecycle) {
  const tab = lifecycle.editor.workspaceStore.getState().workbenchPanels.editorTabs[0]
  expect(tab).toBeDefined()
  return tab!.id
}

async function writeExternal(initial: SettingsSnapshot, client: Client) {
  const result = await saveSettingsText(
    {
      baseRevision: settingsLayerFile(initial, 'user').revision,
      target: 'user',
      text: EXTERNAL_TEXT,
      writeId: 'settings-lifecycle-external',
    },
    client,
  )
  return result.snapshot
}

function invocation() {
  return { source: { caller: 'settings-tab-lifecycle', kind: 'programmatic' as const } }
}
