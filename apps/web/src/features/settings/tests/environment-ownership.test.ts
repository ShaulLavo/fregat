import { documentKey, settingsJsonDocument } from '@/lib/documents/utils/identity'
import { QueryClient } from '@tanstack/react-query'
import { afterEach } from 'vitest'

import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import {
  failSettingsIntent,
  resetSettingsIntentStore,
  settingsIntentStatus,
  submitSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import { readLiveSettingsProjection } from '@/features/settings/state/live-projection'
import { admitSettingsMutationResult } from '@/features/settings/state/snapshot-admission'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { activeServerOrigin, getClient, setActiveServerOrigin, setClient } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'

import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

afterEach(() => resetSettingsIntentStore())

test('pending settings, acknowledgements and supersession belong to one query client', async ({
  client,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const secondClient = createInProcessClient(secondServer)
  const first = createTestQueryClient()
  const second = new QueryClient()
  registerEnvironmentQueryClient(second, 'http://localhost:3412', secondClient)

  try {
    const [snapshotA, snapshotB] = await Promise.all([
      fetchSettings(undefined, client),
      fetchSettings(undefined, secondClient),
    ])
    first.setQueryData(settingsKeys.document(), snapshotA)
    second.setQueryData(settingsKeys.document(), snapshotB)
    const { entry } = submitSettingsIntent(first, 'user', [
      { kind: 'set', key: 'editor.fontSize', value: 19 },
    ])

    expect(readLiveSettingsProjection(first)?.values['editor.fontSize']).toBe(19)
    expect(readLiveSettingsProjection(second)?.values['editor.fontSize']).toBe(
      snapshotB.values['editor.fontSize'],
    )

    const resultB = await saveSettings(entry.request, secondClient)
    await admitSettingsMutationResult(second, resultB)
    expect(settingsIntentStatus(entry.request.mutationId)).toBe('pending')

    failSettingsIntent(entry.request.mutationId, 'request failed on A')
    submitSettingsIntent(second, 'user', [{ kind: 'set', key: 'editor.fontSize', value: 20 }])
    expect(useSettingsIntentStore.getState().failed[0]).toMatchObject({
      owner: first,
      superseded: false,
    })
  } finally {
    first.clear()
    second.clear()
    await secondServer.cleanup()
  }
})

test('an unfinished raw save retries on its original server after a switch', async ({
  controlledClient,
}) => {
  const secondServer = await makeTestServer({ filesystemWatch: false })
  const secondClient = createInProcessClient(secondServer)
  const queryClient = createTestQueryClient()
  const documentStore = createEditorDocumentStore()
  const documentId = documentKey(settingsJsonDocument('user'))
  const before = await fetchSettings(undefined, controlledClient.client)
  const secondBefore = await fetchSettings(undefined, secondClient)
  const origin = activeServerOrigin()
  const service = new SettingsSyncService(documentStore, queryClient)
  documentStore.getState().ensureSettingsDocument(settingsJsonDocument('user'), {
    content: '{ "editor.fontSize": 21 }\n',
    revision: before.layers.find((layer) => layer.id === 'user')?.file?.revision ?? '',
  })
  controlledClient.controller.rejectNextSettingsRawWrite({
    code: 'settings.WRITE_CONTENDED',
    message: 'Retry this request',
    status: 503,
  })
  const save = service.save(documentStore.getState().getLiveEditorDocument(documentId)!)
  setActiveServerOrigin('http://localhost:3412')
  const previousClient = getClient()
  setClient(secondClient)

  try {
    await save

    expect(await controlledClient.controller.settingsRawWriteRequests()).toHaveLength(2)
    expect(
      (await fetchSettings(undefined, controlledClient.client)).values['editor.fontSize'],
    ).toBe(21)
    expect((await fetchSettings(undefined, getClient())).values['editor.fontSize']).toBe(
      secondBefore.values['editor.fontSize'],
    )
    expect(documentStore.getState().getLiveEditorDocument(documentId)?.buffer.isDirty()).toBe(false)
  } finally {
    setClient(previousClient)
    setActiveServerOrigin(origin)
    queryClient.clear()
    await secondServer.cleanup()
  }
})
