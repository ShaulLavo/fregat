import { getClient } from '@/lib/client'
import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { fetchSettings, saveSettingsText } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

import { createTestQueryClient } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'

const ID = documentKey(settingsJsonDocument('user'))

/** A sentinel, not a credential: all that matters is that it is non-empty. */
const TYPED_BY_HAND = 'value-typed-into-the-raw-editor'

function documentWith(value: string) {
  return `${JSON.stringify(
    {
      'providers.instances': [
        {
          driverKind: 'codex',
          environment: [{ name: 'CODEX_TOKEN', value }],
          providerInstanceId: 'codex-work',
        },
      ],
    },
    null,
    2,
  )}\n`
}

/**
 * The one save that does not round-trip: the server lifts a provider credential
 * out of the document into the secret store and rewrites that subtree, so what
 * lands on disk is not what was posted.
 *
 * This is driven through the real service and the real server rather than
 * through the store, because the defect was in which text the service handed to
 * `markSettingsDocumentSaved` — pinning the store alone cannot see it.
 */
test('a save the server rewrites leaves the buffer clean and holding the file', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const posted = documentWith(TYPED_BY_HAND)

  const before = await fetchSettings(undefined, getClient())
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: posted,
    revision: before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? '',
  })

  await new SettingsSyncService(store, queryClient).save(
    store.getState().getLiveEditorDocument(ID)!,
  )

  const document = store.getState().getLiveEditorDocument(ID)
  // The credential is gone from the buffer, because it is gone from the file.
  expect(document?.buffer.materializeFullText()).not.toContain(TYPED_BY_HAND)
  // And the tab is clean: marking against the *written* text instead of the
  // posted text failed this check in exactly this case, leaving the tab dirty
  // forever with a secret on screen that the file no longer held.
  expect(document?.buffer.isDirty()).toBe(false)
  expect(store.getState().dirtyDocumentKeys.has(ID)).toBe(false)
  // The revision advanced, so the next save is not refused as stale.
  expect(document?.sync).toMatchObject({ kind: 'settings' })
  expect(document?.target).toEqual(settingsJsonDocument('user'))
  const sync = document?.sync
  expect(sync?.kind === 'settings' ? sync.revision : '').not.toBe('')
})

// The ordinary case still has to behave: no rewrite, buffer clean, text kept.
test('a save the server does not rewrite keeps the posted text', async ({ client }) => {
  expect(client).toBeDefined()
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const posted = '{ "editor.fontSize": 19 }\n'

  const before = await fetchSettings(undefined, getClient())
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: posted,
    revision: before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? '',
  })

  await new SettingsSyncService(store, queryClient).save(
    store.getState().getLiveEditorDocument(ID)!,
  )

  const document = store.getState().getLiveEditorDocument(ID)
  expect(document?.buffer.materializeFullText()).toBe(posted)
  expect(document?.buffer.isDirty()).toBe(false)
  expect((await fetchSettings(undefined, getClient())).values['editor.fontSize']).toBe(19)
})

test('failed conflict refresh preserves dirty text and a scheduled retry confirms revision', async ({
  controlledClient,
}) => {
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const localText = '{ "editor.fontSize": 18 }\n'
  const initial = await fetchSettings(undefined, getClient())
  const initialRevision = rawRevision(initial)
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: localText,
    revision: initialRevision,
  })
  store.getState().setLiveEditorDocumentDirty(ID, true)
  const external = await saveSettingsText(
    {
      baseRevision: initialRevision,
      target: 'user',
      text: '{ "editor.lineHeight": 30 }\n',
      writeId: 'sync-conflict-recovery-external',
    },
    getClient(),
  )
  controlledClient.controller.rejectNextSettingsRead({
    code: 'settings.READ_FAILED',
    message: 'Injected conflict refresh failure',
    status: 503,
  })

  await new SettingsSyncService(store, queryClient).save(
    store.getState().getLiveEditorDocument(ID)!,
  )

  expect(store.getState().getLiveEditorDocument(ID)?.buffer.materializeFullText()).toBe(localText)
  expect(store.getState().dirtyDocumentKeys.has(ID)).toBe(true)
  await waitForRevision(store, rawRevision(external.snapshot))
  expect(store.getState().getLiveEditorDocument(ID)?.sync).toMatchObject({
    state: 'conflict',
  })
  expect(store.getState().getLiveEditorDocument(ID)?.buffer.materializeFullText()).toBe(localText)
})

test('uncertain raw transport retry reuses one write id', async ({ controlledClient }) => {
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const posted = '{ "editor.fontSize": 20 }\n'
  const before = await fetchSettings(undefined, getClient())
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: posted,
    revision: rawRevision(before),
  })
  controlledClient.controller.rejectNextSettingsRawWrite({
    code: 'settings.WRITE_CONTENDED',
    message: 'Injected uncertain response',
    status: 503,
  })

  await new SettingsSyncService(store, queryClient).save(
    store.getState().getLiveEditorDocument(ID)!,
  )

  const requests = await controlledClient.controller.settingsRawWriteRequests()
  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatchObject({ writeId: expect.any(String) })
  expect(requests[1]).toMatchObject({ writeId: expect.any(String) })
  expect((requests[0] as { writeId: string }).writeId).toBe(
    (requests[1] as { writeId: string }).writeId,
  )
  expect((await fetchSettings(undefined, getClient())).values['editor.fontSize']).toBe(20)
})

test('an overwrite completes when its cache reconciliation reaches the conflict first', async ({
  client,
}) => {
  expect(client).toBeDefined()
  const store = createEditorDocumentStore()
  const queryClient = createTestQueryClient()
  const posted = '{ "editor.fontSize": 22 }\n'
  const before = await fetchSettings(undefined, getClient())
  const beforeRevision = rawRevision(before)
  queryClient.setQueryData(settingsKeys.document(), before)
  store.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: posted,
    revision: beforeRevision,
  })
  store.getState().setLiveEditorDocumentDirty(ID, true)
  const beforeFile = before.layers.find((layer) => layer.id === 'user')?.file
  store
    .getState()
    .markSettingsDocumentConflict(ID, beforeFile?.text ?? '', beforeFile?.revision ?? '')

  let reconciledBeforeFinish = false
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    const snapshot = queryClient.getQueryData<Awaited<ReturnType<typeof fetchSettings>>>(
      settingsKeys.document(),
    )
    const file = snapshot?.layers.find((layer) => layer.id === 'user')?.file
    if (!file || file.revision === beforeRevision) return

    reconciledBeforeFinish = true
    store.getState().markSettingsDocumentConflict(ID, file.text, file.revision)
  })

  try {
    await new SettingsSyncService(store, queryClient).overwrite(
      store.getState().getLiveEditorDocument(ID)!,
    )
  } finally {
    unsubscribe()
  }

  expect(reconciledBeforeFinish).toBe(true)
  expect(store.getState().getLiveEditorDocument(ID)?.sync).toMatchObject({ state: 'idle' })
  expect(store.getState().getLiveEditorDocument(ID)?.buffer.isDirty()).toBe(false)
  expect((await fetchSettings(undefined, getClient())).values['editor.fontSize']).toBe(22)
})

function rawRevision(snapshot: Awaited<ReturnType<typeof fetchSettings>>) {
  return snapshot.layers.find((layer) => layer.id === 'user')?.file?.revision ?? ''
}

async function waitForRevision(
  store: ReturnType<typeof createEditorDocumentStore>,
  revision: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sync = store.getState().getLiveEditorDocument(ID)?.sync
    if (sync?.kind === 'settings' && sync.revision === revision) return

    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 10))
  }

  expect(store.getState().getLiveEditorDocument(ID)?.sync).toMatchObject({ revision })
}
