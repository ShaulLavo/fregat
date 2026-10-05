import { RawConflictBanner } from '@/features/settings/components/raw-conflict-banner'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { SettingsJsonView } from '@/features/settings/components/json-view'
import { tabId } from '@/lib/documents/utils/identity'
import { act } from '@testing-library/react'
import { createAddressTestRuntime } from '../../../../test/factories/address-runtime'
import { registerTestWorkspaceAddress } from '../../../../test/factories/workspace-address'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { statPath } from '@/lib/file-server'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { getClient } from '@/lib/client'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SettingsSnapshot } from '@workspace/contracts'

import { Toaster } from '@workspace/ui/components/sonner'
import { type EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const DOCUMENT_ID = documentKey(settingsJsonDocument('user'))
const LOCAL_TEXT = '{ "editor.fontSize": 18 }\n'

test('raw conflict keeps local text through Compare, intervening writes, Keep my changes, and Use the latest version', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const runtime = await createAddressTestRuntime(client)
  const queryClient = runtime.application.getSnapshot().queryClient
  const documentStore = runtime.editor.documentStore
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  runtime.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const initial = await fetchSettings(undefined, getClient())
  seedLocalDocument(documentStore, LOCAL_TEXT, rawRevision(initial))
  const firstExternal = await writeExternal(
    'raw-conflict-external-one',
    '{ "editor.lineHeight": 31 }\n',
  )
  const service = new SettingsSyncService(documentStore, queryClient)

  expect(await service.save(currentDocument(documentStore))).toBe(false)

  expectConflict(documentStore, firstExternal)
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  expect(documentStore.getState().dirtyDocumentKeys.has(DOCUMENT_ID)).toBe(true)

  const id = tabId('settings-comparison')
  const document = currentDocument(documentStore)
  const view = documentStore.getState().ensureEditorViewForDocument(id, DOCUMENT_ID)
  renderWithProviders(
    <TestEditorStateProvider>
      <SettingsJsonView
        active
        diagnostics={initial.diagnostics}
        file={initial.layers.find((layer) => layer.id === 'user')?.file ?? null}
        liveDocument={{ ...document, editability: 'editable', view: view.view }}
        rootPath={root.path}
        scope='user'
        tabId={id}
      />
      <Toaster />
    </TestEditorStateProvider>,
    { application: runtime.application, queryClient },
  )
  const controller = runtime.editor.uiStore.getState().controllersByTabId.get(id)
  const native = controller?.getEditor()
  if (!native) throw new RangeError('Actual editable settings host required')
  const user = userEvent.setup()
  expect(screen.getByText('settings.json changed somewhere else')).toBeDefined()
  expect(screen.queryByText('Could not save settings')).toBeNull()

  const beforeCompare = await fetchSettings(undefined, getClient())
  await user.click(screen.getByRole('button', { name: 'Compare' }))
  await waitFor(() => expect(documentStore.getState().snapshotComparisons.size).toBe(1))
  const presented = Array.from(documentStore.getState().snapshotComparisons.values())[0]
  if (presented?.kind !== 'ready' || presented.input.kind !== 'settings')
    throw new RangeError('Admitted settings source required')
  expect(presented.input.local.buffer).toBe(document.buffer)
  expect(presented.input.local.snapshot.materializeFullText()).toBe(LOCAL_TEXT)
  expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined()
  expect(runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()).toBe(native)
  act(() => createEditorBufferSession(document.buffer, view.view).applyText(' '))
  const typed = Array.from(documentStore.getState().snapshotComparisons.values())[0]
  if (typed?.kind !== 'ready' || typed.input.kind !== 'settings')
    throw new RangeError('Committed settings read required')
  expect(typed.input.local.snapshot).toBe(document.buffer.getTextSnapshot())
  expect(typed.input.confirmed).toBe(presented.input.confirmed)
  act(() => native.dispatchCommand('undo'))
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  const confirmedFile = firstExternal.layers.find((layer) => layer.id === 'user')?.file
  if (!confirmedFile) throw new RangeError('Actual confirmed file required')
  act(() =>
    documentStore.getState().markSettingsDocumentConflict(DOCUMENT_ID, confirmedFile.text, null),
  )
  expect(screen.getByRole('button', { name: 'Keep my changes' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Use the latest version' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Hide compare' })).not.toBeDisabled()
  expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined()
  expect(runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()).toBe(native)
  act(() =>
    documentStore
      .getState()
      .markSettingsDocumentConflict(DOCUMENT_ID, confirmedFile.text, confirmedFile.revision),
  )
  await user.click(screen.getByRole('button', { name: 'Hide compare' }))
  expect(documentStore.getState().snapshotComparisons.size).toBe(0)
  expect((await fetchSettings(undefined, getClient())).serverVersion).toEqual(
    beforeCompare.serverVersion,
  )
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  await user.click(screen.getByRole('button', { name: 'Use the latest version' }))
  expect(screen.getByRole('dialog', { name: 'Drop your unsaved edits?' })).toBeDefined()
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  await user.click(screen.getByRole('button', { name: 'Keep my changes' }))
  await waitFor(() =>
    expect(settingsSync(documentStore)?.state, 'first overwrite settles').toBe('idle'),
  )
  expect(
    (await fetchSettings(undefined, getClient())).layers.find((layer) => layer.id === 'user')?.file
      ?.text,
  ).toBe(LOCAL_TEXT)

  documentStore.getState().setLiveEditorDocumentDirty(DOCUMENT_ID, true)
  const secondExternal = await writeExternal(
    'raw-conflict-external-two',
    '{ "editor.lineHeight": 32 }\n',
  )
  expect(await service.save(currentDocument(documentStore))).toBe(false)
  expectConflict(documentStore, secondExternal)
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  const thirdExternal = await writeExternal(
    'raw-conflict-external-three',
    '{ "editor.lineHeight": 33 }\n',
  )
  await user.click(screen.getByRole('button', { name: 'Keep my changes' }))
  await waitFor(() => {
    expect(settingsSync(documentStore)).toMatchObject({
      revision: rawRevision(thirdExternal),
      state: 'conflict',
    })
  })
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  expect(documentStore.getState().dirtyDocumentKeys.has(DOCUMENT_ID)).toBe(true)
  expect(screen.queryByText('Could not save settings')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Keep my changes' }))
  await waitFor(() =>
    expect(settingsSync(documentStore)?.state, 'second overwrite settles').toBe('idle'),
  )
  expect(
    (await fetchSettings(undefined, getClient())).layers.find((layer) => layer.id === 'user')?.file
      ?.text,
  ).toBe(LOCAL_TEXT)

  documentStore.getState().setLiveEditorDocumentDirty(DOCUMENT_ID, true)
  const finalExternal = await writeExternal(
    'raw-conflict-external-four',
    '{ "editor.fontSize": 24 }\n',
  )
  expect(await service.save(currentDocument(documentStore))).toBe(false)
  expectConflict(documentStore, finalExternal)
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  await user.click(screen.getByRole('button', { name: 'Use the latest version' }))
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  await user.click(screen.getByRole('button', { name: 'Drop my edits' }))
  expect(settingsSync(documentStore)).toMatchObject({
    revision: rawRevision(finalExternal),
    state: 'idle',
  })
  expect(currentText(documentStore)).toBe('{ "editor.fontSize": 24 }\n')
  expect(documentStore.getState().dirtyDocumentKeys.has(DOCUMENT_ID)).toBe(false)
  expect(screen.queryByText('Could not save settings')).toBeNull()

  queryClient.clear()
})

function seedLocalDocument(store: EditorDocumentStoreApi, text: string, revision: string) {
  store
    .getState()
    .ensureSettingsDocument(settingsJsonDocument('user'), { content: text, revision: revision })
  store.getState().setLiveEditorDocumentDirty(DOCUMENT_ID, true)
}

async function writeExternal(writeId: string, text: string) {
  const current = await fetchSettings(undefined, getClient())
  const result = await saveSettingsText(
    {
      baseRevision: rawRevision(current),
      target: 'user',
      text,
      writeId,
    },
    getClient(),
  )

  return result.snapshot
}

function currentDocument(store: EditorDocumentStoreApi) {
  const document = store.getState().getLiveEditorDocument(DOCUMENT_ID)
  expect(document).not.toBeNull()
  return document!
}

function currentText(store: EditorDocumentStoreApi) {
  return currentDocument(store).buffer.materializeFullText()
}

function settingsSync(store: EditorDocumentStoreApi) {
  const sync = currentDocument(store).sync
  if (sync.kind !== 'settings') return null

  return sync
}

function expectConflict(store: EditorDocumentStoreApi, confirmed: SettingsSnapshot) {
  expect(settingsSync(store)).toMatchObject({
    confirmedText: confirmed.layers.find((layer) => layer.id === 'user')?.file?.text,
    revision: rawRevision(confirmed),
    state: 'conflict',
  })
}

function rawRevision(snapshot: SettingsSnapshot) {
  return snapshot.layers.find((layer) => layer.id === 'user')?.file?.revision ?? ''
}

test('pending comparison keeps Hide available and two actual banner interests release independently', async ({
  client,
}) => {
  const runtime = await createAddressTestRuntime(client)
  const store = runtime.editor.documentStore
  const queries = runtime.application.getSnapshot().queryClient
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  runtime.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user settings file required')
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  act(() => store.getState().markSettingsDocumentConflict(DOCUMENT_ID, file.text, null))
  const first = renderWithProviders(
    <TestEditorStateProvider>
      <RawConflictBanner documentKey={DOCUMENT_ID} />
    </TestEditorStateProvider>,
    { application: runtime.application, queryClient: queries },
  )
  expect(first.getByRole('button', { name: 'Compare' })).toBeDisabled()
  expect(store.getState().snapshotComparisons.size).toBe(0)
  act(() => store.getState().markSettingsDocumentConflict(DOCUMENT_ID, file.text, file.revision))
  const user = userEvent.setup()
  await user.click(first.getByRole('button', { name: 'Compare' }))
  await waitFor(() => expect(store.getState().snapshotComparisons.size).toBe(1))
  const second = renderWithProviders(
    <TestEditorStateProvider>
      <RawConflictBanner documentKey={DOCUMENT_ID} />
    </TestEditorStateProvider>,
    { application: runtime.application, queryClient: queries },
  )
  const compare = second.getAllByRole('button', { name: 'Compare' }).at(-1)
  if (!compare) throw new RangeError('Actual second Compare required')
  await user.click(compare)
  await waitFor(() => expect(store.getState().snapshotComparisons.size).toBe(2))
  act(() => store.getState().markSettingsDocumentConflict(DOCUMENT_ID, file.text, null))
  const hide = first.getAllByRole('button', { name: 'Hide compare' })[0]
  if (!hide) throw new RangeError('Opened pending comparison must have Hide')
  expect(hide).not.toBeDisabled()
  await user.click(hide)
  expect(store.getState().snapshotComparisons.size).toBe(1)
  second.unmount()
  expect(store.getState().snapshotComparisons.size).toBe(0)
  first.unmount()
})

test('supplied settings root admits matching comparison and withdraws ready or held pending on mismatch', async ({
  client,
  server,
}) => {
  const runtime = await createAddressTestRuntime(client)
  const documents = runtime.editor.documentStore
  const queryClient = runtime.application.getSnapshot().queryClient
  const initial = await fetchSettings(undefined, client)
  const file = initial.layers.find((layer) => layer.id === 'user')?.file
  if (!file) throw new RangeError('Actual user settings file required')
  const root = await statPath(filesystemPath(''), new AbortController().signal, client)
  const workspaceAddress = await registerTestWorkspaceAddress(client, '')
  runtime.editor.workspaceStore
    .getState()
    .switchWorkspace({ ...root, workspaceAddress, name: 'Root', type: 'directory' })
  await mkdir(join(server.root, 'alternate'))
  const alternate = await statPath(
    filesystemPath('alternate'),
    new AbortController().signal,
    client,
  )
  await registerTestWorkspaceAddress(client, alternate.path)
  const document = documents.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: file.text,
    revision: file.revision,
  })
  documents.getState().markSettingsDocumentConflict(DOCUMENT_ID, file.text, file.revision)
  const id = tabId('settings-root-admission')
  const view = documents.getState().ensureEditorViewForDocument(id, DOCUMENT_ID)
  const current = documents.getState().getLiveEditorDocument(DOCUMENT_ID)
  if (!current) throw new RangeError('Actual current settings document required')
  const content = (suppliedRoot: typeof root.path) => (
    <TestEditorStateProvider>
      <SettingsJsonView
        active
        diagnostics={initial.diagnostics}
        file={file}
        liveDocument={{ ...current, editability: 'editable', view: view.view }}
        rootPath={suppliedRoot}
        scope='user'
        tabId={id}
      />
    </TestEditorStateProvider>
  )
  const mounted = renderWithProviders(content(root.path), {
    application: runtime.application,
    queryClient,
  })
  const native = runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()
  if (!native) throw new RangeError('Actual native editable settings host required')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Compare' }))
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined(),
  )
  const captured = Array.from(documents.getState().snapshotComparisons.values())[0]
  if (captured?.kind !== 'ready' || captured.input.kind !== 'settings')
    throw new RangeError('Actual captured settings comparison required')
  expect(captured.input.scope.rootPath).toBe(root.path)
  expect(documents.getState().snapshotComparisons.size).toBe(1)
  expect(native.getState().documentId).toBe(document.key)
  expect(alternate.path).not.toBe(root.path)

  mounted.rerender(content(alternate.path))
  expect(runtime.editor.workspaceStore.getState().rootFolder?.path).toBe(root.path)
  expect(runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()).toBe(native)
  expect(screen.queryByRole('region', { name: 'Settings comparison' })).toBeNull()
  expect(Array.from(documents.getState().snapshotComparisons.values())[0]).toBe(captured)
  expect(documents.getState().snapshotComparisons.size).toBe(1)

  mounted.rerender(content(root.path))
  expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined()
  act(() => documents.getState().markSettingsDocumentConflict(DOCUMENT_ID, file.text, null))
  const pending = Array.from(documents.getState().snapshotComparisons.values())[0]
  if (pending?.kind !== 'ready' || pending.input.kind !== 'settings')
    throw new RangeError('Actual pending settings comparison required')
  expect(pending.input.confirmed.kind).toBe('pending')
  expect(pending.input.scope.rootPath).toBe(root.path)
  expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined()
  expect(screen.getAllByRole('textbox', { name: 'Editor input' })).toHaveLength(2)

  mounted.rerender(content(alternate.path))
  expect(screen.queryByRole('region', { name: 'Settings comparison' })).toBeNull()
  expect(screen.getAllByRole('textbox', { name: 'Editor input' })).toHaveLength(1)
  expect(runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()).toBe(native)
  expect(Array.from(documents.getState().snapshotComparisons.values())[0]).toBe(pending)
  const editing = createEditorBufferSession(document.buffer, view.view)
  act(() => editing.applyText(' '))
  expect(document.buffer.materializeFullText()).not.toBe(file.text)
  act(() => native.dispatchCommand('undo'))
  expect(document.buffer.materializeFullText()).toBe(file.text)

  mounted.rerender(content(root.path))
  expect(screen.getByRole('region', { name: 'Settings comparison' })).toBeDefined()
  expect(screen.getAllByRole('textbox', { name: 'Editor input' })).toHaveLength(1)
  expect(screen.getByRole('status', { name: 'Loading comparison' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Keep my changes' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Use the latest version' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Hide compare' })).not.toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Hide compare' }))
  expect(screen.queryByRole('region', { name: 'Settings comparison' })).toBeNull()
  expect(documents.getState().snapshotComparisons.size).toBe(0)
  expect(runtime.editor.uiStore.getState().controllersByTabId.get(id)?.getEditor()).toBe(native)
  mounted.unmount()
})
