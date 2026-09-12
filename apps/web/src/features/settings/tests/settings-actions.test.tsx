import { getClient } from '@/lib/client'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SettingsMutationRequest } from '@workspace/contracts'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { AppProviders, createTestQueryClient } from '../../../../test/render'
import { ThemeAwareToaster } from '@/components/theme-aware-toaster'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import {
  discardFailedSettingsIntent,
  failSettingsIntent,
  resetSettingsIntentStore,
  retrySettingsIntent,
  submitSettingsIntent,
  type SettingsIntentHandle,
  type SettingsSubmission,
} from '@workspace/client-core/settings/intent-store'
import {
  admitSettingsEvent,
  resetSettingsSnapshotAdmission,
} from '@/features/settings/state/snapshot-admission'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { projectSettings } from '@workspace/client-core/settings/projection'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('publishes semantic intent before three scoped transports can settle', async ({
  controlledClient,
}) => {
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  const first = renderHook(() => useSettingsActions(), { wrapper: wrapper(queryClient) })
  const second = renderHook(() => useSettingsActions(), { wrapper: wrapper(queryClient) })
  let submissions: SettingsSubmission[] = []
  const firstTransport = controlledClient.controller.deferNextSettingsWrite()

  act(() => {
    submissions = [first.result.current.setSetting('workbench.colorTheme', 'dark')]
  })
  await controlledClient.controller.waitForSettingsWriteRequest(1)
  await waitFor(() => {
    expect(first.result.current.isSaving).toBe(true)
    expect(second.result.current.isSaving).toBe(true)
  })

  act(() => {
    submissions.push(
      second.result.current.setSetting('workbench.colorTheme', 'light'),
      first.result.current.setSetting('workbench.colorTheme', 'system'),
    )
  })

  const active = useSettingsIntentStore.getState().active
  expect(active.map((entry) => entry.clientSequence)).toEqual([1, 2, 3])
  expect(active.map((entry) => entry.request.operations[0])).toEqual([
    { key: 'workbench.colorTheme', kind: 'set', value: 'dark' },
    { key: 'workbench.colorTheme', kind: 'set', value: 'light' },
    { key: 'workbench.colorTheme', kind: 'set', value: 'system' },
  ])
  expect(projectSettings(confirmed, active).values['workbench.colorTheme']).toBe('system')

  const mutations = queryClient.getMutationCache().getAll()
  expect(mutations).toHaveLength(3)
  expect(mutations.map((mutation) => mutation.options.scope?.id)).toEqual([
    'settings-document',
    'settings-document',
    'settings-document',
  ])
  expect(mutations.map((mutation) => mutation.state.variables)).toEqual(active)
  expect(mutations.filter((mutation) => mutation.state.isPaused)).toHaveLength(2)
  expect(second.result.current.isSaving).toBe(true)

  firstTransport.reject({
    code: 'settings.WRITE_TEMPORARILY_UNAVAILABLE',
    message: 'Injected first-attempt failure',
    status: 503,
  })
  const handles = submissions.filter(isSubmitted)
  expect(handles).toHaveLength(3)
  expect(await Promise.all(handles.map((submission) => submission.settled))).toEqual([
    'acknowledged',
    'acknowledged',
    'acknowledged',
  ])
  await waitFor(() => expect(useSettingsIntentStore.getState().active).toEqual([]))
  expect((await fetchSettings(undefined, getClient())).values['workbench.colorTheme']).toBe(
    'system',
  )

  first.unmount()
  second.unmount()
  cleanup(queryClient)
})

test('automatic transport retries retain one projected intent and one mutation id', async ({
  controlledClient,
}) => {
  resetSettingsIntentStore()
  const controller = controlledClient.controller
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  controller.rejectNextSettingsWrite(temporaryWriteFailure('first'))
  const actions = renderHook(() => useSettingsActions(), { wrapper: wrapper(queryClient) })
  const captured: { current?: SettingsSubmission } = {}

  act(() => {
    captured.current = actions.result.current.setSetting('workbench.colorTheme', 'dark')
  })
  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await controller.waitForSettingsWriteRequest(1)
  controller.rejectNextSettingsWrite(temporaryWriteFailure('second'))
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('dark')
  expect(actions.result.current.isSaving).toBe(true)

  await controller.waitForSettingsWriteRequest(2)
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('dark')
  expect(actions.result.current.isSaving).toBe(true)

  await controller.waitForSettingsWriteRequest(3)
  await expect(submission.settled).resolves.toBe('acknowledged')
  await waitFor(() => expect(useSettingsIntentStore.getState().active).toEqual([]))
  expect((await fetchSettings(undefined, getClient())).values['workbench.colorTheme']).toBe('dark')

  const requests = (await controller.settingsWriteRequests()) as SettingsMutationRequest[]
  expect(requests).toHaveLength(3)
  expect(requests.map((request) => request.mutationId)).toEqual([
    submission.mutationId,
    submission.mutationId,
    submission.mutationId,
  ])

  actions.unmount()
  cleanup(queryClient)
})

test('exhausted retries remove only their intent and Retry reuses its mutation id', async ({
  controlledClient,
}) => {
  resetSettingsIntentStore()
  const controller = controlledClient.controller
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  controller.rejectNextSettingsWrite(temporaryWriteFailure('first'))
  const actions = renderHook(() => useSettingsActions(), {
    wrapper: wrapper(queryClient, true),
  })
  const captured: { current?: SettingsSubmission } = {}
  let unrelatedMutationId = ''

  act(() => {
    captured.current = actions.result.current.setSetting('workbench.colorTheme', 'dark')
    unrelatedMutationId = submitSettingsIntent(queryClient, 'user', [
      { key: 'editor.fontSize', kind: 'set', value: 18 },
    ]).entry.request.mutationId
  })
  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await controller.waitForSettingsWriteRequest(1)
  controller.rejectNextSettingsWrite(temporaryWriteFailure('second'))
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('dark')

  await controller.waitForSettingsWriteRequest(2)
  controller.rejectNextSettingsWrite(temporaryWriteFailure('third'))
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('dark')

  await controller.waitForSettingsWriteRequest(3)
  await expect(submission.settled).resolves.toBe('failed')
  expect(useSettingsIntentStore.getState().active.map(intentId)).toEqual([unrelatedMutationId])
  expect(useSettingsIntentStore.getState().failed.map(intentId)).toEqual([submission.mutationId])
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('system')
  expect(projectedValue(confirmed, 'editor.fontSize')).toBe(18)

  const user = userEvent.setup()
  const retry = await screen.findByRole('button', { name: 'Retry' })
  expect(screen.getByRole('button', { name: 'Discard' })).toBeVisible()
  await user.click(retry)

  await controller.waitForSettingsWriteRequest(4)
  await waitFor(async () => {
    expect((await fetchSettings(undefined, getClient())).values['workbench.colorTheme']).toBe(
      'dark',
    )
  })
  expect(useSettingsIntentStore.getState().active.map(intentId)).toEqual([unrelatedMutationId])
  const requests = (await controller.settingsWriteRequests()) as SettingsMutationRequest[]
  expect(requests.map((request) => request.mutationId)).toEqual([
    submission.mutationId,
    submission.mutationId,
    submission.mutationId,
    submission.mutationId,
  ])

  actions.unmount()
  cleanup(queryClient)
})

test('WRITE_CONTENDED does not retry and leaves unrelated projection active', async ({
  controlledClient,
}) => {
  resetSettingsIntentStore()
  const controller = controlledClient.controller
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  controller.rejectNextSettingsWrite({
    code: 'settings.WRITE_CONTENDED',
    message: 'Injected coordinator contention',
    status: 503,
  })
  const actions = renderHook(() => useSettingsActions(), {
    wrapper: wrapper(queryClient, true),
  })
  const captured: { current?: SettingsSubmission } = {}
  let unrelatedMutationId = ''

  act(() => {
    captured.current = actions.result.current.setSetting('workbench.colorTheme', 'dark')
    unrelatedMutationId = submitSettingsIntent(queryClient, 'user', [
      { key: 'editor.fontSize', kind: 'set', value: 18 },
    ]).entry.request.mutationId
  })
  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await controller.waitForSettingsWriteRequest(1)
  await expect(submission.settled).resolves.toBe('failed')
  await waitFor(() => expect(actions.result.current.isSaving).toBe(false))
  expect(controller.settingsWriteCount).toBe(1)
  expect(useSettingsIntentStore.getState().active.map(intentId)).toEqual([unrelatedMutationId])
  expect(useSettingsIntentStore.getState().failed).toEqual([
    expect.objectContaining({
      error: expect.objectContaining({ code: 'settings.WRITE_CONTENDED' }),
      request: expect.objectContaining({ mutationId: submission.mutationId }),
      superseded: false,
    }),
  ])
  expect(projectedValue(confirmed, 'workbench.colorTheme')).toBe('system')
  expect(projectedValue(confirmed, 'editor.fontSize')).toBe(18)
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Discard' })).toBeVisible()

  actions.unmount()
  cleanup(queryClient)
})

test('an admitted SSE acknowledgement survives a later HTTP failure without Retry', async ({
  controlledClient,
  server,
}) => {
  resetSettingsIntentStore()
  const controller = controlledClient.controller
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  const deferred = controller.deferNextSettingsWrite()
  const actions = renderHook(() => useSettingsActions(), {
    wrapper: wrapper(queryClient, true),
  })
  const captured: { current?: SettingsSubmission } = {}

  act(() => {
    captured.current = actions.result.current.setSetting('workbench.colorTheme', 'dark')
  })
  const submission = captured.current
  expect(submission?.kind).toBe('submitted')
  if (submission?.kind !== 'submitted') return

  await controller.waitForSettingsWriteRequest(1)
  const entry = useSettingsIntentStore
    .getState()
    .active.find((candidate) => candidate.request.mutationId === submission.mutationId)
  expect(entry).toBeDefined()
  if (!entry) return

  const bypassResponse = await createInProcessClient(server).settings.write.post(entry.request)
  expect(bypassResponse.error).toBeNull()
  expect(bypassResponse.data).toBeDefined()
  const result = bypassResponse.data
  if (!result) return

  await admitSettingsEvent(queryClient, {
    changedSettingIds: result.changedSettingIds,
    originMutationId: submission.mutationId,
    snapshot: result.snapshot,
  })
  expect(useSettingsIntentStore.getState().active).toEqual([
    expect.objectContaining({
      request: expect.objectContaining({ mutationId: submission.mutationId }),
      status: 'acknowledged',
    }),
  ])
  expect(projectedValue(result.snapshot, 'workbench.colorTheme')).toBe('dark')

  deferred.reject({
    code: 'settings.WRITE_INVALID',
    message: 'Injected late HTTP failure',
    status: 400,
  })
  await expect(submission.settled).resolves.toBe('acknowledged')
  await waitFor(() => {
    expect(actions.result.current.isSaving).toBe(false)
    expect(useSettingsIntentStore.getState().active).toEqual([])
  })
  expect(useSettingsIntentStore.getState().failed).toEqual([])
  expect(
    queryClient.getQueryData<Awaited<ReturnType<typeof fetchSettings>>>(settingsKeys.document())
      ?.values['workbench.colorTheme'],
  ).toBe('dark')
  expect(screen.queryByText('Could not save settings')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()

  actions.unmount()
  cleanup(queryClient)
})

test('derives targets from the projected layers without crossing application scope', async ({
  client,
}) => {
  expect(client).toBeDefined()
  await saveSettings(
    {
      mutationId: 'settings-actions-workspace-seed',
      operations: [{ key: 'workbench.colorTheme', kind: 'set', value: 'dark' }],
      target: 'workspace',
    },
    getClient(),
  )
  const confirmed = await fetchSettings(undefined, getClient())
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  resetSettingsIntentStore()
  const actions = renderHook(() => useSettingsActions(), { wrapper: wrapper(queryClient) })
  let submissions: SettingsSubmission[] = []

  act(() => {
    submissions = [
      actions.result.current.setSetting('workbench.colorTheme', 'light'),
      actions.result.current.setSetting('chat.defaultInteractionMode', 'plan'),
      actions.result.current.setSetting('editor.fontSize', 19),
    ]
  })

  const active = useSettingsIntentStore.getState().active
  expect(active.map((entry) => entry.request.target)).toEqual(['workspace', 'user', 'user'])
  expect(active.map((entry) => entry.clientSequence)).toEqual([1, 2, 3])

  const handles = submissions.filter(isSubmitted)
  expect(await Promise.all(handles.map((submission) => submission.settled))).toEqual([
    'acknowledged',
    'acknowledged',
    'acknowledged',
  ])
  const persisted = await fetchSettings(undefined, getClient())
  expect(persisted.values['workbench.colorTheme']).toBe('light')
  expect(persisted.values['chat.defaultInteractionMode']).toBe('plan')
  expect(persisted.values['editor.fontSize']).toBe(19)

  actions.unmount()
  cleanup(queryClient)
})

test('a deterministic rejection exposes same-id Retry and explicit Discard', async ({ client }) => {
  expect(client).toBeDefined()
  resetSettingsIntentStore()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const actions = renderHook(() => useSettingsActions(), { wrapper: wrapper(queryClient) })
  const captured: { current?: SettingsSubmission } = {}

  act(() => {
    captured.current = actions.result.current.setSetting(
      'chat.defaultInteractionMode',
      'plan',
      'workspace',
    )
  })

  const submission = captured.current
  expect(submission).toBeDefined()
  if (!submission) return
  expect(submission.kind).toBe('submitted')
  if (submission.kind !== 'submitted') return
  const mutationId = submission.mutationId
  expect(useSettingsIntentStore.getState().active[0]?.request.mutationId).toBe(mutationId)
  expect(await submission.settled).toBe('failed')
  expect(useSettingsIntentStore.getState().active).toEqual([])
  expect(useSettingsIntentStore.getState().failed[0]).toMatchObject({
    request: { mutationId, target: 'workspace' },
    superseded: false,
  })

  const retried = retrySettingsIntent(mutationId)
  expect(retried?.request.mutationId).toBe(mutationId)
  expect(retried?.clientSequence).toBe(2)
  expect(
    projectSettings(
      await fetchSettings(undefined, getClient()),
      useSettingsIntentStore.getState().active,
    ).pendingMutationIds,
  ).toEqual([mutationId])

  expect(failSettingsIntent(mutationId, { code: 'settings.SCOPE_NOT_ALLOWED' })).not.toBeNull()
  expect(discardFailedSettingsIntent(mutationId)).toBe(true)
  expect(useSettingsIntentStore.getState().failed).toEqual([])

  actions.unmount()
  cleanup(queryClient)
})

function wrapper(queryClient: ReturnType<typeof createTestQueryClient>, withToaster = false) {
  return ({ children }: { readonly children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>
      {children}
      {withToaster ? <ThemeAwareToaster /> : null}
    </AppProviders>
  )
}

function isSubmitted(submission: SettingsSubmission): submission is SettingsIntentHandle {
  return submission.kind === 'submitted'
}

function projectedValue(
  confirmed: Awaited<ReturnType<typeof fetchSettings>>,
  key: 'editor.fontSize' | 'workbench.colorTheme',
) {
  return projectSettings(confirmed, useSettingsIntentStore.getState().active).values[key]
}

function intentId(entry: { readonly request: { readonly mutationId: string } }) {
  return entry.request.mutationId
}

function temporaryWriteFailure(attempt: string) {
  return {
    code: 'settings.WRITE_TEMPORARILY_UNAVAILABLE',
    message: `Injected ${attempt}-attempt failure`,
    status: 503,
  }
}

function cleanup(queryClient: ReturnType<typeof createTestQueryClient>) {
  toast.dismiss()
  resetSettingsSnapshotAdmission(queryClient)
  resetSettingsIntentStore()
  queryClient.clear()
}
