import { QueryClient } from '@tanstack/query-core'
import { DEFAULT_SETTING_VALUES, type SettingsSnapshot } from '@workspace/contracts'
import { afterEach, expect, test, vi } from 'vitest'
import { createSettingsSnapshotAdmission, type SettingsAdmissionHost } from '../snapshot-admission'
import { settingsKeys } from '../query-keys'
import {
  resetSettingsIntentStore,
  settingsIntentStatus,
  submitSettingsIntent,
} from '../intent-store'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  resetSettingsIntentStore()
})

function snapshot(epoch: string, sequence = 0): SettingsSnapshot {
  return {
    diagnostics: [],
    layers: [{ id: 'user', present: false, raw: {} }],
    serverVersion: { epoch, sequence },
    values: { ...DEFAULT_SETTING_VALUES },
  }
}

function fixture(
  fetch: SettingsAdmissionHost['fetch'],
  batch: SettingsAdmissionHost['batch'] = (action) => action(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateProviders = vi.fn()
  const admission = createSettingsSnapshotAdmission({ fetch, batch, invalidateProviders })
  client.setQueryData(settingsKeys.document(), snapshot('initial'))
  cleanups.push(() => {
    admission.resetSettingsSnapshotAdmission(client)
    client.clear()
  })
  return { client, admission, invalidateProviders }
}

const event = (value: SettingsSnapshot) => ({ changedSettingIds: [], snapshot: value })

test('concurrent unexpected epochs share recovery and successive changes read fresh evidence', async () => {
  const gate = Promise.withResolvers<SettingsSnapshot>()
  const fetch = vi
    .fn<SettingsAdmissionHost['fetch']>()
    .mockImplementationOnce(() => gate.promise)
    .mockResolvedValueOnce(snapshot('third'))
  const { client, admission } = fixture(fetch)
  const first = admission.admitSettingsEvent(client, event(snapshot('second', 1)))
  const second = admission.admitSettingsEvent(client, event(snapshot('second', 2)))
  expect(fetch).toHaveBeenCalledTimes(1)
  gate.resolve(snapshot('second'))
  await Promise.all([first, second])
  expect(client.getQueryData<SettingsSnapshot>(settingsKeys.document())?.serverVersion).toEqual({
    epoch: 'second',
    sequence: 2,
  })
  await admission.admitSettingsEvent(client, event(snapshot('third', 1)))
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(client.getQueryData<SettingsSnapshot>(settingsKeys.document())?.serverVersion.epoch).toBe(
    'third',
  )
})

test('same-epoch delivery waits through recovery publication before acknowledging intent', async () => {
  const gate = Promise.withResolvers<SettingsSnapshot>()
  let duringPublication: Promise<unknown> | undefined
  let publishHook = () => {}
  const { client, admission } = fixture(
    () => gate.promise,
    (publish) => {
      publish()
      publishHook()
    },
  )
  const intent = submitSettingsIntent(client, 'user', [
    { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
  ]).entry
  const recovery = admission.admitSettingsEvent(client, event(snapshot('second', 1)))
  let settled = false
  const sameEpoch = admission
    .admitSettingsEvent(client, {
      ...event(snapshot('initial', 1)),
      originMutationId: intent.intentId,
    })
    .then((result) => {
      settled = true
      return result
    })
  await Promise.resolve()
  expect(settled).toBe(false)
  expect(settingsIntentStatus(intent.intentId)).toBe('pending')
  publishHook = () => {
    publishHook = () => {}
    duringPublication = admission.admitSettingsEvent(client, {
      ...event(snapshot('second')),
      originMutationId: intent.intentId,
    })
    expect(settingsIntentStatus(intent.intentId)).toBe('pending')
  }
  gate.resolve(snapshot('second'))
  await recovery
  expect((await sameEpoch).acknowledgedIntent).toBeNull()
  await duringPublication
  expect(settingsIntentStatus(intent.intentId)).toBe('acknowledged')
})

test('reset rejects stale recovery and cannot acknowledge its old update in the new lifetime', async () => {
  const gate = Promise.withResolvers<SettingsSnapshot>()
  const { client, admission } = fixture(() => gate.promise)
  const intent = submitSettingsIntent(client, 'user', [
    { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
  ]).entry
  const stale = admission.admitSettingsEvent(client, {
    ...event(snapshot('second', 1)),
    originMutationId: intent.intentId,
  })
  admission.resetSettingsSnapshotAdmission(client)
  client.setQueryData(settingsKeys.document(), snapshot('second', 10))
  gate.resolve(snapshot('second'))
  const result = await stale
  expect(result).toMatchObject({
    admitted: false,
    acknowledgedIntent: null,
    recoveryPending: false,
  })
  expect(settingsIntentStatus(intent.intentId)).toBe('pending')
  expect(client.getQueryData<SettingsSnapshot>(settingsKeys.document())?.serverVersion).toEqual({
    epoch: 'second',
    sequence: 10,
  })
  expect(client.getQueryCache().findAll({ queryKey: ['settings', 'recovery'] })).toHaveLength(0)
})

test('failed recovery retries and settles deferred acknowledgement with confirmed evidence', async () => {
  const recovered = snapshot('second', 1)
  const fetch = vi
    .fn<SettingsAdmissionHost['fetch']>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(recovered)
  const { client, admission } = fixture(fetch)
  const intent = submitSettingsIntent(client, 'user', [
    { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
  ]).entry
  const update = { ...event(recovered), originMutationId: intent.intentId }
  const failed = await admission.admitSettingsEvent(client, update)
  expect(failed.recoveryPending).toBe(true)
  expect(settingsIntentStatus(intent.intentId)).toBe('pending')
  await admission.admitSettingsEvent(client, update)
  await expect(failed.confirmation).resolves.toMatchObject({ recoveryPending: false })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(settingsIntentStatus(intent.intentId)).toBe('acknowledged')
})
