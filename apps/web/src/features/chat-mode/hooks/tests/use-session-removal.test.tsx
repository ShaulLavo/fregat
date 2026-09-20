import { sessionSummary } from '@/features/chat-mode/state/removal'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../../test/factories/federation'
import { Toaster } from '@workspace/ui/components/sonner'
import { createSessionDeleteCommand } from '@workspace/client-core/chat/commands'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSessionDeleteRequestStore } from '@/features/chat-mode/state/session-delete-request-store'
import { createTestNavigation } from '../../../../../test/factories/navigation'
import { waitForNavigation } from '../../../../../test/address'
import { act, waitFor, screen } from '@testing-library/react'
import { createClientError } from '@workspace/client-core/errors'
import type { SessionId } from '@workspace/contracts'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { createObservedInProcessClient } from '../../../../../test/client'
import { renderHookWithProviders, renderWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'

test('three-row deletion retains the failed middle selection and continues deleting real survivors', async ({
  server,
}) => {
  let failedId: SessionId | undefined
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    if (body.type !== 'session.delete' || body.sessionId !== failedId) return
    throw createClientError({
      code: 'TEST_NETWORK_FAILURE',
      message: 'Injected deletion network failure',
      status: 503,
      why: 'The test interrupts one transport request.',
      fix: 'Retry the failed selection.',
    })
  })
  const harness = await createRailHarness(client, server, ['First', 'Middle', 'Last'])
  failedId = harness.sessionIds[1]
  const refs = harness.sessionIds.map((sessionId) => ({
    environmentId: harness.environmentId,
    sessionId,
  }))
  useSessionMultiSelectStore.setState({ refs, anchor: refs[0] })
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: harness.application,
    queryClient: harness.application.getSnapshot().queryClient,
  })
  await act(async () => {
    await hook.result.current.confirmDelete({ refs, title: 'Three sessions' })
  })
  expect((await harness.refresh()).sessions.map((session) => session.id)).toEqual([failedId])
  expect(useSessionMultiSelectStore.getState().refs).toEqual([refs[1]])
})

test('archiving a background row leaves the current selection unchanged', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const first = harness.sessionIds[0]!
  const second = harness.sessionIds[1]!
  useSessionSelectionStore
    .getState()
    .selectSession(harness.environmentId, harness.projectId, second)
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: harness.application,
    queryClient: harness.application.getSnapshot().queryClient,
  })
  await act(async () => {
    expect(
      await hook.result.current.archive({ environmentId: harness.environmentId, sessionId: first }),
    ).toBe(true)
  })
  await waitFor(async () =>
    expect(
      (await harness.refresh()).sessions.find((session) => session.id === first)?.archivedAt,
    ).not.toBeNull(),
  )
  expect(useSessionSelectionStore.getState().selection).toMatchObject({
    kind: 'session',
    environmentId: harness.environmentId,
    sessionId: second,
  })
})

test('archive completion does not overwrite a route chosen while its real request is pending', async ({
  server,
}) => {
  const reached = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    if (body.type !== 'session.archive') return
    reached.resolve()
    await release.promise
  })
  const harness = await createRailHarness(client, server)
  const navigation = createTestNavigation({ application: harness.application })
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: harness.application,
    queryClient: harness.application.getSnapshot().queryClient,
    navigation,
  })
  await waitForNavigation(navigation)
  const first = { environmentId: harness.environmentId, sessionId: harness.sessionIds[0]! }
  const second = { environmentId: harness.environmentId, sessionId: harness.sessionIds[1]! }
  await act(async () => {
    await navigation.openChat({ ...first, surface: 'main' })
  })
  let pending: Promise<boolean> | undefined
  try {
    act(() => {
      pending = hook.result.current.archive(first)
    })
    await reached.promise
    await act(async () => {
      await navigation.openChat({ ...second, surface: 'main' })
    })
    await act(async () => {
      release.resolve()
      expect(await pending).toBe(true)
    })
    expect(useSessionSelectionStore.getState().selection).toMatchObject({
      kind: 'session',
      ...second,
    })
  } finally {
    release.resolve()
  }
})

test('disabling delete confirmation consumes the registry setting and deletes directly', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  expect(
    (
      await client.settings.write.post({
        mutationId: crypto.randomUUID(),
        target: 'user',
        operations: [{ kind: 'set', key: 'chat.confirmSessionDelete', value: false }],
      })
    ).error,
  ).toBeNull()
  const hook = renderHookWithProviders(
    () => ({ actions: useSessionActions(), confirm: useSettingValue('chat.confirmSessionDelete') }),
    {
      application: harness.application,
      queryClient: harness.application.getSnapshot().queryClient,
    },
  )
  await waitFor(() => expect(hook.result.current.confirm).toBe(false))
  await act(async () => {
    hook.result.current.actions.deleteSession(
      { environmentId: harness.environmentId, sessionId: harness.sessionIds[0]! },
      'First',
    )
  })
  await waitFor(async () =>
    expect((await harness.refresh()).sessions.map((session) => session.id)).toEqual([
      harness.sessionIds[1],
    ]),
  )
  expect(useSessionDeleteRequestStore.getState().request).toBeNull()
})

test('successful deletion remains successful when its chosen destination disappears before navigation', async ({
  server,
}) => {
  const reached = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let gatedId: SessionId | undefined
  const client = createObservedInProcessClient(server, async (request) => {
    if (!request.url.endsWith('/orchestration/commands')) return
    const body = await request.clone().json()
    if (body.type !== 'session.delete' || body.sessionId !== gatedId) return
    reached.resolve()
    await release.promise
  })
  const harness = await createRailHarness(client, server, [
    'Deleted',
    'Survivor',
    'Vanishing fallback',
  ])
  gatedId = harness.sessionIds[0]!
  const navigation = createTestNavigation({ application: harness.application })
  const options = {
    application: harness.application,
    queryClient: harness.application.getSnapshot().queryClient,
    navigation,
  }
  renderWithProviders(<Toaster />, options)
  const hook = renderHookWithProviders(() => useSessionActions(), options)
  await waitForNavigation(navigation)
  await act(async () => {
    await navigation.openChat({
      environmentId: harness.environmentId,
      sessionId: gatedId!,
      surface: 'main',
    })
  })
  const ref = { environmentId: harness.environmentId, sessionId: gatedId }
  useSessionMultiSelectStore.setState({ refs: [ref], anchor: ref })
  let pending: Promise<void> | undefined
  try {
    act(() => {
      pending = hook.result.current.confirmDelete({ refs: [ref], title: 'Deleted' })
    })
    await reached.promise
    await harness.dispatch(createSessionDeleteCommand({ sessionId: harness.sessionIds[2]! }))
    await act(async () => {
      await harness.refresh()
      release.resolve()
      await pending
    })
    expect((await harness.refresh()).sessions.map((session) => session.id)).toEqual([
      harness.sessionIds[1],
    ])
    expect(useSessionMultiSelectStore.getState().refs).toEqual([])
    expect(await screen.findByText('1 deleted, 1 navigation failure')).toBeInTheDocument()
  } finally {
    release.resolve()
  }
})

test('archive and delete route to the real owner when two servers share a session ID', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const first = await registerFederatedProject(h.serverA, h.clientA, 'first')
  await registerFederatedProject(h.serverB, h.clientB, 'second', first.sessionId)
  const local = { environmentId: h.descriptorA.environmentId, sessionId: first.sessionId }
  const remote = { environmentId: h.descriptorB.environmentId, sessionId: first.sessionId }
  const hook = renderHookWithProviders(() => useSessionActions(), {
    application: h.application,
    queryClient: h.application.getSnapshot().queryClient,
  })
  await waitFor(() => expect(sessionSummary(remote)).toBeDefined())
  useSessionSelectionStore
    .getState()
    .selectSession(local.environmentId, first.projectId, first.sessionId)
  await act(async () => {
    expect(await hook.result.current.archive(remote)).toBe(true)
  })
  expect(
    (await h.clientA.orchestration['shell-snapshot'].get()).data!.sessions[0]!.archivedAt,
  ).toBeNull()
  expect(
    (await h.clientB.orchestration['shell-snapshot'].get()).data!.sessions[0]!.archivedAt,
  ).not.toBeNull()
  expect(useSessionSelectionStore.getState().selection).toMatchObject({ kind: 'session', ...local })
  useSessionMultiSelectStore.setState({ refs: [local, remote], anchor: local })
  await act(async () => {
    await hook.result.current.confirmDelete({ refs: [remote], title: 'Remote' })
  })
  expect((await h.clientA.orchestration['shell-snapshot'].get()).data!.sessions).toHaveLength(1)
  expect((await h.clientB.orchestration['shell-snapshot'].get()).data!.sessions).toHaveLength(0)
  expect(useSessionMultiSelectStore.getState().refs).toEqual([local])
})
