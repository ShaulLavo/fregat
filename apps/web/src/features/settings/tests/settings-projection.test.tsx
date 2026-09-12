import { getClient } from '@/lib/client'
import {
  REDACTED_SETTINGS_VALUE,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  type SettingsSnapshot,
} from '@workspace/contracts'
import * as v from 'valibot'
import { vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { settingsSnapshot } from '../../../../test/factories/settings'
import { createTestQueryClient } from '../../../../test/render'
import { providerQueryKeys } from '@/features/chat/utils/provider-query'
import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import {
  acknowledgeSettingsIntent,
  discardFailedSettingsIntent,
  failSettingsIntent,
  resetSettingsIntentStore,
  retrySettingsIntent,
  settingsIntentStatus,
  submitSettingsIntent,
} from '@workspace/client-core/settings/intent-store'
import {
  admitSettingsEvent,
  admitSettingsMutationResult,
  beginSettingsSnapshotRead,
  observeInitialSettingsSnapshot,
  refreshConfirmedSettings,
  resetSettingsSnapshotAdmission,
} from '@/features/settings/state/snapshot-admission'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('replays pending intents in one strict process-wide order', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const first = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const second = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
  ]).entry
  const third = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'system' },
  ]).entry

  const projected = projectSettings(settingsSnapshot(), useSettingsIntentStore.getState().active)

  expect(projected.values['workbench.colorTheme']).toBe('system')
  expect(projected.pendingMutationIds).toEqual([
    first.request.mutationId,
    second.request.mutationId,
    third.request.mutationId,
  ])
  expect([first.clientSequence, second.clientSequence, third.clientSequence]).toEqual([1, 2, 3])
  resetSettingsIntentStore()
})

test('never exposes confirmed file text or revisions through projected layers', () => {
  resetSettingsIntentStore()
  const projected = projectSettings(settingsSnapshot(), [])

  expect(projected.layers.length).toBeGreaterThan(0)
  expect(projected.layers.every((layer) => !Object.hasOwn(layer, 'file'))).toBe(true)
})

test('rebases pending semantic intent over a newer confirmed snapshot', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const pending = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
  ]).entry
  const confirmed = settingsSnapshot({
    sequence: 2,
    userRaw: { 'workbench.colorTheme': 'dark' },
    values: { 'workbench.colorTheme': 'dark' },
  })

  const projected = projectSettings(confirmed, useSettingsIntentStore.getState().active)

  expect(projected.values['workbench.colorTheme']).toBe('light')
  expect(projected.pendingMutationIds).toEqual([pending.request.mutationId])
  expect(confirmed.values['workbench.colorTheme']).toBe('dark')
  resetSettingsIntentStore()
})

test('acknowledgement removes only its matching optimistic projection', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const first = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const second = submitSettingsIntent(queryClient, 'user', [
    { key: 'editor.fontSize', kind: 'set', value: 18 },
  ]).entry

  acknowledgeSettingsIntent(first.request.mutationId)
  const projected = projectSettings(settingsSnapshot(), useSettingsIntentStore.getState().active)

  expect(projected.acknowledgedMutationIds).toEqual([first.request.mutationId])
  expect(projected.pendingMutationIds).toEqual([second.request.mutationId])
  expect(projected.values['workbench.colorTheme']).toBe('system')
  expect(projected.values['editor.fontSize']).toBe(18)
  resetSettingsIntentStore()
})

test('provider projection preserves confirmed masks without writing them into raw config', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const providerInstanceId = v.parse(providerInstanceIdSchema, 'codex-work')
  const driverKind = v.parse(providerDriverKindSchema, 'codex')
  const rawProvider = {
    driverKind,
    enabled: true,
    environment: [{ name: 'CODEX_TOKEN', value: '' }],
    providerInstanceId,
  }
  const confirmedProvider = {
    binaryPath: '',
    config: {},
    displayLabel: 'codex-work',
    driverKind,
    enabled: true,
    environment: [{ name: 'CODEX_TOKEN', value: REDACTED_SETTINGS_VALUE }],
    providerInstanceId,
  }
  submitSettingsIntent(queryClient, 'user', [
    {
      enabled: false,
      kind: 'provider.setEnabled',
      providerInstanceId,
    },
  ])

  const projected = projectSettings(
    settingsSnapshot({
      userRaw: { 'providers.instances': [rawProvider] },
      values: { 'providers.instances': [confirmedProvider] },
    }),
    useSettingsIntentStore.getState().active,
  )

  expect(projected.values['providers.instances'][0]).toMatchObject({
    enabled: false,
    environment: [{ name: 'CODEX_TOKEN', value: REDACTED_SETTINGS_VALUE }],
  })
  expect(projected.layers[0]?.raw).toEqual({
    'providers.instances': [{ ...rawProvider, enabled: false }],
  })
  resetSettingsIntentStore()
})

test('failure removes only its intent and later same-resource intent supersedes stale Retry', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const failedTheme = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const failedFont = submitSettingsIntent(queryClient, 'user', [
    { key: 'editor.fontSize', kind: 'set', value: 18 },
  ]).entry

  failSettingsIntent(failedTheme.request.mutationId, { code: 'settings.WRITE_CONTENDED' })
  failSettingsIntent(failedFont.request.mutationId, { code: 'transport.closed' })
  const winner = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
  ]).entry

  const failed = useSettingsIntentStore.getState().failed
  expect(
    failed.find((entry) => entry.request.mutationId === failedTheme.request.mutationId),
  ).toMatchObject({
    superseded: true,
  })
  expect(
    failed.find((entry) => entry.request.mutationId === failedFont.request.mutationId),
  ).toMatchObject({
    superseded: false,
  })
  expect(retrySettingsIntent(failedTheme.request.mutationId)).toBeNull()

  const retriedFont = retrySettingsIntent(failedFont.request.mutationId)
  expect(retriedFont?.request.mutationId).toBe(failedFont.request.mutationId)
  expect(retriedFont?.clientSequence).toBe(4)
  const projected = projectSettings(settingsSnapshot(), useSettingsIntentStore.getState().active)
  expect(projected.values['workbench.colorTheme']).toBe('light')
  expect(projected.values['editor.fontSize']).toBe(18)
  expect(projected.pendingMutationIds).toEqual([
    winner.request.mutationId,
    failedFont.request.mutationId,
  ])

  failSettingsIntent(failedFont.request.mutationId, { code: 'transport.closed' })
  expect(discardFailedSettingsIntent(failedFont.request.mutationId)).toBe(true)
  expect(
    useSettingsIntentStore
      .getState()
      .failed.some((entry) => entry.request.mutationId === failedFont.request.mutationId),
  ).toBe(false)
  resetSettingsIntentStore()
})

test('replays each intent only into its target layer across confirmed roots', () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const confirmed = settingsSnapshot({
    userRaw: { 'workbench.colorTheme': 'dark' },
    values: { 'workbench.colorTheme': 'light' },
    workspaceRaw: { 'workbench.colorTheme': 'light' },
  })
  submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'system' },
  ])

  const userOnly = projectSettings(confirmed, useSettingsIntentStore.getState().active)
  expect(userOnly.values['workbench.colorTheme']).toBe('light')
  expect(userOnly.layers.find((layer) => layer.id === 'user')?.raw).toEqual({
    'workbench.colorTheme': 'system',
  })
  expect(userOnly.layers.find((layer) => layer.id === 'workspace')?.raw).toEqual({
    'workbench.colorTheme': 'light',
  })

  submitSettingsIntent(queryClient, 'workspace', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ])
  const both = projectSettings(confirmed, useSettingsIntentStore.getState().active)
  expect(both.values['workbench.colorTheme']).toBe('dark')
  expect(confirmed.layers[0]?.raw).toEqual({ 'workbench.colorTheme': 'dark' })
  expect(confirmed.layers[1]?.raw).toEqual({ 'workbench.colorTheme': 'light' })
  resetSettingsIntentStore()
})

test('SSE acknowledgement filters its intent before newer SSE and late HTTP delivery', async () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const initial = settingsSnapshot({ epoch: 'ordered-epoch', sequence: 0 })
  queryClient.setQueryData(settingsKeys.document(), initial)
  const intent = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const acknowledged = settingsSnapshot({
    epoch: 'ordered-epoch',
    sequence: 1,
    userRaw: { 'workbench.colorTheme': 'dark' },
    values: { 'workbench.colorTheme': 'dark' },
  })

  await admitSettingsEvent(queryClient, {
    changedSettingIds: ['workbench.colorTheme'],
    originMutationId: intent.request.mutationId,
    snapshot: acknowledged,
  })
  expect(projectSettings(acknowledged, useSettingsIntentStore.getState().active)).toMatchObject({
    acknowledgedMutationIds: [intent.request.mutationId],
    pendingMutationIds: [],
  })

  const external = settingsSnapshot({
    epoch: 'ordered-epoch',
    sequence: 2,
    userRaw: { 'workbench.colorTheme': 'light' },
    values: { 'workbench.colorTheme': 'light' },
  })
  await admitSettingsEvent(queryClient, {
    changedSettingIds: ['workbench.colorTheme'],
    snapshot: external,
  })
  const late = await admitSettingsMutationResult(queryClient, {
    appliedVersion: acknowledged.serverVersion,
    changedSettingIds: ['workbench.colorTheme'],
    duplicate: false,
    mutationId: intent.request.mutationId,
    snapshot: acknowledged,
  })

  expect(late.admitted).toBe(false)
  expect(queryClient.getQueryData(settingsKeys.document())).toEqual(external)
  expect(
    projectSettings(external, useSettingsIntentStore.getState().active).values[
      'workbench.colorTheme'
    ],
  ).toBe('light')
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('equal-version HTTP and SSE are no-ops and older same-epoch delivery is refused', async () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const current = settingsSnapshot({
    epoch: 'monotonic-epoch',
    sequence: 5,
    userRaw: { 'workbench.colorTheme': 'dark' },
    values: { 'workbench.colorTheme': 'dark' },
  })
  queryClient.setQueryData(settingsKeys.document(), current)
  const equal = settingsSnapshot({
    epoch: 'monotonic-epoch',
    sequence: 5,
    userRaw: { 'workbench.colorTheme': 'light' },
    values: { 'workbench.colorTheme': 'light' },
  })

  const equalSse = await admitSettingsEvent(queryClient, {
    changedSettingIds: ['workbench.colorTheme'],
    snapshot: equal,
  })
  expect(equalSse.admitted).toBe(false)
  expect(equalSse.acknowledgedIntent).toBeNull()
  expect(queryClient.getQueryData(settingsKeys.document())).toBe(current)

  const equalHttp = await admitSettingsMutationResult(queryClient, {
    appliedVersion: equal.serverVersion,
    changedSettingIds: ['workbench.colorTheme'],
    duplicate: false,
    mutationId: 'equal-http-delivery',
    snapshot: equal,
  })
  expect(equalHttp.admitted).toBe(false)
  expect(equalHttp.acknowledgedIntent).toBeNull()
  expect(queryClient.getQueryData(settingsKeys.document())).toBe(current)

  const older = settingsSnapshot({
    epoch: 'monotonic-epoch',
    sequence: 4,
    userRaw: { 'workbench.colorTheme': 'system' },
    values: { 'workbench.colorTheme': 'system' },
  })
  const olderHttp = await admitSettingsMutationResult(queryClient, {
    appliedVersion: older.serverVersion,
    changedSettingIds: ['workbench.colorTheme'],
    duplicate: false,
    mutationId: 'older-http-delivery',
    snapshot: older,
  })
  expect(olderHttp.admitted).toBe(false)
  expect(olderHttp.acknowledgedIntent).toBeNull()
  expect(queryClient.getQueryData(settingsKeys.document())).toBe(current)

  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('provider invalidation waits for relevant acknowledgement and is not repeated by late delivery', async () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const initial = settingsSnapshot({ epoch: 'provider-admission-epoch', sequence: 0 })
  queryClient.setQueryData(settingsKeys.document(), initial)
  resetProviderQuery(queryClient)
  const providerInstanceId = v.parse(providerInstanceIdSchema, 'codex-work')
  const intent = submitSettingsIntent(queryClient, 'user', [
    {
      enabled: false,
      kind: 'provider.setEnabled',
      providerInstanceId,
    },
  ]).entry

  expect(providerQueryIsInvalidated(queryClient)).toBe(false)
  await admitSettingsEvent(queryClient, {
    changedSettingIds: ['editor.fontSize'],
    snapshot: settingsSnapshot({ epoch: 'provider-admission-epoch', sequence: 1 }),
  })
  expect(providerQueryIsInvalidated(queryClient)).toBe(false)

  const acknowledged = settingsSnapshot({
    epoch: 'provider-admission-epoch',
    sequence: 2,
  })
  const sse = await admitSettingsEvent(queryClient, {
    changedSettingIds: ['providers.instances'],
    originMutationId: intent.request.mutationId,
    snapshot: acknowledged,
  })
  expect(sse.acknowledgedIntent?.request.mutationId).toBe(intent.request.mutationId)
  expect(providerQueryIsInvalidated(queryClient)).toBe(true)

  resetProviderQuery(queryClient)
  const equalHttp = await admitSettingsMutationResult(queryClient, {
    appliedVersion: acknowledged.serverVersion,
    changedSettingIds: ['providers.instances'],
    duplicate: false,
    mutationId: intent.request.mutationId,
    snapshot: acknowledged,
  })
  expect(equalHttp.admitted).toBe(false)
  expect(equalHttp.acknowledgedIntent?.request.mutationId).toBe(intent.request.mutationId)
  expect(providerQueryIsInvalidated(queryClient)).toBe(false)

  resetProviderQuery(queryClient)
  const older = settingsSnapshot({ epoch: 'provider-admission-epoch', sequence: 1 })
  const olderHttp = await admitSettingsMutationResult(queryClient, {
    appliedVersion: older.serverVersion,
    changedSettingIds: ['providers.instances'],
    duplicate: false,
    mutationId: intent.request.mutationId,
    snapshot: older,
  })
  expect(olderHttp.admitted).toBe(false)
  expect(olderHttp.acknowledgedIntent?.request.mutationId).toBe(intent.request.mutationId)
  expect(providerQueryIsInvalidated(queryClient)).toBe(false)

  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('unexpected-epoch provider recovery invalidates once after intent acknowledgement', async ({
  client,
}) => {
  expect(client).toBeDefined()
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ epoch: 'stale-provider-client-epoch', sequence: 7 }),
  )
  resetProviderQuery(queryClient)
  const providerInstanceId = v.parse(providerInstanceIdSchema, 'recovered-provider')
  const driverKind = v.parse(providerDriverKindSchema, 'codex')
  const intent = submitSettingsIntent(queryClient, 'user', [
    {
      createIfMissing: { driverKind },
      enabled: true,
      kind: 'provider.setEnabled',
      providerInstanceId,
    },
  ]).entry
  const result = await saveSettings(intent.request, getClient())
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const invalidationStatuses: Array<ReturnType<typeof settingsIntentStatus>> = []
  let providerWasInvalidated = false
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== providerQueryKeys.all[0]) return

    const invalidated = event.query.state.isInvalidated
    if (!providerWasInvalidated && invalidated) {
      invalidationStatuses.push(settingsIntentStatus(intent.request.mutationId))
    }
    providerWasInvalidated = invalidated
  })

  const admission = await admitSettingsMutationResult(queryClient, result)
  const providerInvalidations = invalidateQueries.mock.calls.filter(
    ([filters]) => filters?.queryKey?.[0] === providerQueryKeys.all[0],
  )

  expect(admission.acknowledgedIntent?.request.mutationId).toBe(intent.request.mutationId)
  expect(admission.snapshot?.serverVersion).toEqual(result.snapshot.serverVersion)
  expect(providerInvalidations).toHaveLength(1)
  expect(invalidationStatuses).toEqual(['acknowledged'])
  expect(providerQueryIsInvalidated(queryClient)).toBe(true)

  unsubscribe()
  invalidateQueries.mockRestore()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('a late earlier-started GET cannot retire the epoch established by a later read', async () => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const earlierRead = beginSettingsSnapshotRead(queryClient)
  const laterRead = beginSettingsSnapshotRead(queryClient)
  const epochB = settingsSnapshot({
    epoch: 'confirmed-later-read-epoch',
    sequence: 1,
    userRaw: { 'workbench.colorTheme': 'dark' },
    values: { 'workbench.colorTheme': 'dark' },
  })
  const acceptedB = observeInitialSettingsSnapshot(queryClient, epochB, laterRead)
  queryClient.setQueryData(settingsKeys.document(), acceptedB)

  const lateEpochA = settingsSnapshot({
    epoch: 'stale-earlier-read-epoch',
    sequence: 99,
    userRaw: { 'workbench.colorTheme': 'light' },
    values: { 'workbench.colorTheme': 'light' },
  })
  const acceptedLateA = observeInitialSettingsSnapshot(queryClient, lateEpochA, earlierRead)
  queryClient.setQueryData(settingsKeys.document(), acceptedLateA)
  expect(acceptedLateA).toBe(epochB)
  expect(queryClient.getQueryData(settingsKeys.document())).toBe(epochB)

  const nextB = settingsSnapshot({
    epoch: 'confirmed-later-read-epoch',
    sequence: 2,
    userRaw: { 'workbench.colorTheme': 'system' },
    values: { 'workbench.colorTheme': 'system' },
  })
  const event = await admitSettingsEvent(queryClient, {
    changedSettingIds: ['workbench.colorTheme'],
    snapshot: nextB,
  })
  expect(event.admitted).toBe(true)
  expect(queryClient.getQueryData(settingsKeys.document())).toEqual(nextB)

  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

test('unexpected epoch refetches confirmed state and keeps pending intent projected', async ({
  client,
}) => {
  expect(client).toBeDefined()
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const retired = settingsSnapshot({
    epoch: 'retired-test-epoch',
    sequence: 8,
    userRaw: { 'editor.fontSize': 15 },
    values: { 'editor.fontSize': 15 },
  })
  queryClient.setQueryData(settingsKeys.document(), retired)
  const pending = submitSettingsIntent(queryClient, 'user', [
    { key: 'editor.fontSize', kind: 'set', value: 18 },
  ]).entry
  const surprising = settingsSnapshot({
    epoch: 'untrusted-event-epoch',
    sequence: 99,
    userRaw: { 'editor.fontSize': 72 },
    values: { 'editor.fontSize': 72 },
  })

  const admission = await admitSettingsEvent(queryClient, {
    changedSettingIds: ['editor.fontSize'],
    snapshot: surprising,
  })
  const fetched = await fetchSettings(undefined, getClient())
  const confirmed = queryClient.getQueryData<SettingsSnapshot>(settingsKeys.document()) ?? fetched

  expect(admission.admitted).toBe(false)
  expect(confirmed.serverVersion.epoch).toBe(fetched.serverVersion.epoch)
  expect(confirmed.serverVersion.epoch).not.toBe(surprising.serverVersion.epoch)
  expect(
    projectSettings(confirmed, useSettingsIntentStore.getState().active).values['editor.fontSize'],
  ).toBe(18)

  const retiredDelivery = await admitSettingsEvent(queryClient, {
    changedSettingIds: ['editor.fontSize'],
    originMutationId: pending.request.mutationId,
    snapshot: retired,
  })
  expect(retiredDelivery.acknowledgedIntent).toBeNull()
  expect(useSettingsIntentStore.getState().active[0]?.status).toBe('pending')

  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})

function resetProviderQuery(queryClient: ReturnType<typeof createTestQueryClient>) {
  queryClient.setQueryData(providerQueryKeys.list(), { providers: [] })
}

function providerQueryIsInvalidated(queryClient: ReturnType<typeof createTestQueryClient>) {
  return queryClient.getQueryState(providerQueryKeys.list())?.isInvalidated ?? false
}

test('failed epoch recovery keeps intent pending until active confirmed evidence settles it', async ({
  controlledClient,
}) => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ epoch: 'superseded-client-epoch', sequence: 4 }),
  )
  const intent = submitSettingsIntent(queryClient, 'user', [
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
  ]).entry
  const result = await saveSettings(intent.request, getClient())
  controlledClient.controller.rejectNextSettingsRead({
    code: 'settings.READ_FAILED',
    message: 'Injected recovery failure',
    status: 503,
  })

  const deferred = await admitSettingsMutationResult(queryClient, result)
  expect(deferred.recoveryPending).toBe(true)
  expect(deferred.confirmation).toBeDefined()
  expect(useSettingsIntentStore.getState().active[0]?.status).toBe('pending')
  if (!deferred.confirmation) return

  await refreshConfirmedSettings(queryClient)
  const settled = await deferred.confirmation
  expect(settled.snapshot?.serverVersion.epoch).toBe(result.snapshot.serverVersion.epoch)
  expect(settled.acknowledgedIntent?.request.mutationId).toBe(intent.request.mutationId)
  expect(useSettingsIntentStore.getState().active[0]?.status).toBe('acknowledged')

  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
})
