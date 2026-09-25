import { getClient } from '@/lib/client'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SettingsSnapshot } from '@workspace/contracts'

import { Toaster } from '@workspace/ui/components/sonner'
import {
  createEditorDocumentStore,
  EditorDocumentStateContext,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { RawConflictBanner } from '@/features/settings/components/raw-conflict-banner'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'

const DOCUMENT_ID = documentKey(settingsJsonDocument('user'))
const LOCAL_TEXT = '{ "editor.fontSize": 18 }\n'

test('raw conflict keeps local text through Compare, intervening writes, Overwrite, and Reload', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const queryClient = createTestQueryClient()
  const documentStore = createEditorDocumentStore()
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

  renderWithProviders(<RawConflictHarness documentStore={documentStore} />, { queryClient })
  const user = userEvent.setup()
  expect(screen.getByText('settings.json changed elsewhere')).toBeDefined()
  expect(screen.queryByText('Could not save settings')).toBeNull()

  const beforeCompare = await fetchSettings(undefined, getClient())
  await user.click(screen.getByRole('button', { name: 'Compare' }))
  expect(screen.getByText('Local edits')).toBeDefined()
  expect(screen.getByText('Confirmed file')).toBeDefined()
  expect(screen.getByText(LOCAL_TEXT.trim(), { selector: 'pre' })).toBeDefined()
  expect((await fetchSettings(undefined, getClient())).serverVersion).toEqual(
    beforeCompare.serverVersion,
  )
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  await user.click(screen.getByRole('button', { name: 'Reload' }))
  expect(screen.getByRole('dialog', { name: 'Discard local settings edits?' })).toBeDefined()
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)

  await user.click(screen.getByRole('button', { name: 'Overwrite' }))
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
  await user.click(screen.getByRole('button', { name: 'Overwrite' }))
  await waitFor(() => {
    expect(settingsSync(documentStore)).toMatchObject({
      revision: rawRevision(thirdExternal),
      state: 'conflict',
    })
  })
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  expect(documentStore.getState().dirtyDocumentKeys.has(DOCUMENT_ID)).toBe(true)
  expect(screen.queryByText('Could not save settings')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Overwrite' }))
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

  await user.click(screen.getByRole('button', { name: 'Reload' }))
  expect(currentText(documentStore)).toBe(LOCAL_TEXT)
  await user.click(screen.getByRole('button', { name: 'Discard and reload' }))
  expect(settingsSync(documentStore)).toMatchObject({
    revision: rawRevision(finalExternal),
    state: 'idle',
  })
  expect(currentText(documentStore)).toBe('{ "editor.fontSize": 24 }\n')
  expect(documentStore.getState().dirtyDocumentKeys.has(DOCUMENT_ID)).toBe(false)
  expect(screen.queryByText('Could not save settings')).toBeNull()

  queryClient.clear()
})

function RawConflictHarness({ documentStore }: { readonly documentStore: EditorDocumentStoreApi }) {
  return (
    <EditorDocumentStateContext.Provider value={documentStore}>
      <RawConflictBanner documentKey={DOCUMENT_ID} />
      <Toaster />
    </EditorDocumentStateContext.Provider>
  )
}

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
