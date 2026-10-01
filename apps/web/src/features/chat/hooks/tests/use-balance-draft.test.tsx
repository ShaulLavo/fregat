import { MutationObserver, onlineManager } from '@tanstack/react-query'
import { useMoveDraft } from '../use-move-draft'
import { chatMutationKeys } from '../../utils/mutation-keys'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../../test/factories/federation'
import { createTestNavigation } from '../../../../../test/factories/navigation'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '../../state/chat-projection-store'
import { act, waitFor } from '@testing-library/react'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { test, expect } from '../../../../../test/fixtures'
import { fixtureEnvironmentId } from '../../../../../test/factories/chat'
import { hostResources, machineDraftFixture } from '../../../../../test/factories/host-resources'
import { createTestQueryClient, renderHookWithProviders } from '../../../../../test/render'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { primaryServerOrigin } from '@/lib/client'
import { useSettingValue } from '@/hooks/use-setting-value'
import {
  queryClientFor,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { createClientInvariantError } from '@/lib/structured-errors'
import { useChatInputDraftStore } from '../../state/chat-input-draft-store'
import { useBalanceDraft } from '../use-balance-draft'
import { machineCapacityQueryOptions } from '../../utils/machine-capacity-query'
import { machineCapacityKeys } from '../../utils/query-keys'
import { makeTestServer } from '../../../../../test/server'
import { createInProcessClient } from '../../../../../test/client'

test('a settled automatic draft keeps its intent while capacity refreshes', async ({ client }) => {
  const fixture = machineDraftFixture()
  const previousEntries = useEnvironmentsStore.getState()
  const previousDrafts = useChatInputDraftStore.getState()
  const queryClient = createTestQueryClient()
  const origin = primaryServerOrigin()
  await saveSettings(
    {
      mutationId: 'balance-stability-policy',
      target: 'user',
      operations: [{ kind: 'set', key: 'environments.loadBalancing', value: true }],
    },
    client,
  )
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
  // Capacity is an outside-world sample; use an already received sample for both owners.
  queryClient.setQueryDefaults(['chat', 'machine-capacity'], { enabled: false })
  for (const [index, machine] of fixture.machines.entries()) {
    const ownOrigin = index === 0 ? origin : 'http://balance-stability.test'
    useEnvironmentsStore.setState((state) => ({
      entries: {
        ...state.entries,
        [ownOrigin]: {
          ...createEnvironmentEntry(ownOrigin, origin),
          environmentId: machine.environmentId,
          phase: 'live',
        },
      },
    }))
    queryClient.setQueryData(
      machineCapacityKeys.resources(machine.environmentId, ownOrigin),
      hostResources({ cpuCount: index === 0 ? 8 : 2 }),
    )
  }
  useChatInputDraftStore
    .getState()
    .setIdentity(fixture.target, { ...fixture.identity, machineSelection: 'automatic' })
  useChatInputDraftStore.getState().setPrompt(fixture.target, 'Keep my draft')
  const original = useChatInputDraftStore.getState().getDraft(fixture.target)
  const view = renderHookWithProviders(() => useBalanceDraft(fixture.target, fixture.machines), {
    queryClient,
    settingsOwner: queryClient,
  })
  try {
    await waitFor(() => expect(view.result.current.pending).toBe(false))
    act(() =>
      queryClient.setQueryData(
        machineCapacityKeys.resources(
          fixture.machines[1]!.environmentId,
          'http://balance-stability.test',
        ),
        hostResources({ cpuCount: 128 }),
      ),
    )
    expect(useChatInputDraftStore.getState().getDraft(fixture.target)).toBe(original)
    expect(view.result.current.requiresChoice).toBe(false)
    act(() =>
      useChatInputDraftStore.getState().setIdentity(fixture.target, {
        ...fixture.identity,
        machineSelection: 'pinned',
        worktreeTarget: {
          kind: 'new',
          worktreeId: fixture.identity.baseWorktreeId,
          baseWorktreeId: fixture.identity.baseWorktreeId,
          baseBranch: 'release',
        },
      }),
    )
    const pinned = useChatInputDraftStore.getState().getDraft(fixture.target)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['chat', 'machine-capacity'] })
    })
    expect(useChatInputDraftStore.getState().getDraft(fixture.target)).toBe(pinned)
    expect(pinned.identity?.worktreeTarget).toMatchObject({ baseBranch: 'release' })
  } finally {
    view.unmount()
    queryClient.clear()
    useEnvironmentsStore.setState(previousEntries, true)
    useChatInputDraftStore.setState(previousDrafts, true)
  }
})

test('a failed resource read requires manual choice even with healthy capacity on another machine', async ({
  client,
}) => {
  const fixture = machineDraftFixture()
  const previousEntries = useEnvironmentsStore.getState()
  const previousDrafts = useChatInputDraftStore.getState()
  const first = await makeTestServer({ machines: { resources: async () => hostResources() } })
  const second = await makeTestServer({
    environmentId: fixture.machines[1]!.environmentId,
    machines: {
      resources: async () => {
        throw createClientInvariantError('Capacity read failed')
      },
    },
  })
  const origins = ['http://balance-healthy.test', 'http://balance-failed.test'] as const
  const queryClient = createTestQueryClient()
  await saveSettings(
    {
      mutationId: 'balance-failed-read-policy',
      target: 'user',
      operations: [{ kind: 'set', key: 'environments.loadBalancing', value: true }],
    },
    client,
  )
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
  for (const [index, machine] of fixture.machines.entries()) {
    const origin = origins[index]!
    registerEnvironmentQueryClient(
      queryClientFor(origin),
      origin,
      createInProcessClient(index === 0 ? first : second),
    )
    useEnvironmentsStore.setState((state) => ({
      entries: {
        ...state.entries,
        [origin]: {
          ...createEnvironmentEntry(origin, primaryServerOrigin()),
          environmentId: machine.environmentId,
          phase: 'live',
        },
      },
    }))
  }
  useChatInputDraftStore.getState().setIdentity(fixture.target, fixture.identity)
  useChatInputDraftStore.getState().setPrompt(fixture.target, 'Choose for me after reads')
  const original = useChatInputDraftStore.getState().getDraft(fixture.target)
  const view = renderHookWithProviders(
    () => ({
      ...useBalanceDraft(fixture.target, fixture.machines),
      balancingEnabled: useSettingValue('environments.loadBalancing'),
    }),
    {
      queryClient,
      settingsOwner: queryClient,
    },
  )
  try {
    await waitFor(() => expect(view.result.current.balancingEnabled).toBe(true))
    await waitFor(() =>
      expect(
        queryClient.getQueryState(
          machineCapacityKeys.resources(fixture.machines[1]!.environmentId, origins[1]),
        )?.status,
      ).toBe('error'),
    )
    await waitFor(() => expect(view.result.current.pending).toBe(false))
    expect(view.result.current.requiresChoice).toBe(true)
    const held = useChatInputDraftStore.getState().getDraft(fixture.target)
    expect(held).toMatchObject({
      prompt: original.prompt,
      attachments: original.attachments,
      terminalContexts: original.terminalContexts,
      identity: { ...fixture.identity, machineSelection: 'required' },
    })
    act(() =>
      queryClient.setQueryData(
        machineCapacityKeys.resources(fixture.machines[1]!.environmentId, origins[1]),
        hostResources({ cpuCount: 128 }),
      ),
    )
    expect(view.result.current.requiresChoice).toBe(true)
    expect(useChatInputDraftStore.getState().getDraft(fixture.target)).toBe(held)
    act(() =>
      useChatInputDraftStore
        .getState()
        .setIdentity(fixture.target, { ...fixture.identity, machineSelection: 'pinned' }),
    )
    expect(view.result.current.requiresChoice).toBe(false)
  } finally {
    view.unmount()
    queryClient.clear()
    useEnvironmentsStore.setState(previousEntries, true)
    useChatInputDraftStore.setState(previousDrafts, true)
    await first.cleanup()
    await second.cleanup()
  }
})

test.for(['paused', 'idle'] as const)(
  '%s stale capacity requires a choice and stays held after recovery',
  async (fetchStatus, { client }) => {
    const fixture = machineDraftFixture(fixtureEnvironmentId(3))
    const previousEntries = useEnvironmentsStore.getState()
    const previousDrafts = useChatInputDraftStore.getState()
    const wasOnline = onlineManager.isOnline()
    let sawPaused = false
    const queryClient = createTestQueryClient()
    const first = await makeTestServer({
      environmentId: fixture.target.environmentId,
      machines: { resources: async () => hostResources() },
    })
    const second = await makeTestServer({
      environmentId: fixture.machines[1]!.environmentId,
      machines: { resources: async () => hostResources({ cpuCount: 128 }) },
    })
    const origins = [
      'http://balance-paused-first.test',
      'http://balance-paused-second.test',
    ] as const
    queryClient.setQueryDefaults(['chat', 'machine-capacity'], {
      refetchOnMount: fetchStatus === 'paused',
    })
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.query.queryKey[0] === 'chat' &&
        event.query.queryKey[1] === 'machine-capacity' &&
        event.query.state.fetchStatus === 'paused'
      )
        sawPaused = true
    })
    await saveSettings(
      {
        mutationId: 'balance-paused-policy',
        target: 'user',
        operations: [{ kind: 'set', key: 'environments.loadBalancing', value: true }],
      },
      client,
    )
    queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
    for (const [index, machine] of fixture.machines.entries()) {
      const origin = origins[index]!
      registerEnvironmentQueryClient(
        queryClientFor(origin),
        origin,
        createInProcessClient(index === 0 ? first : second),
      )
      useEnvironmentsStore.setState((state) => ({
        entries: {
          ...state.entries,
          [origin]: {
            ...createEnvironmentEntry(origin, primaryServerOrigin()),
            environmentId: machine.environmentId,
            phase: 'live',
          },
        },
      }))
      queryClient.setQueryData(
        machineCapacityKeys.resources(machine.environmentId, origin),
        hostResources({ cpuCount: index === 0 ? 8 : 2 }),
        { updatedAt: Date.now() - 60_000 },
      )
    }
    useChatInputDraftStore.getState().setIdentity(fixture.target, fixture.identity)
    onlineManager.setOnline(fetchStatus === 'idle')
    if (fetchStatus === 'paused')
      await queryClient.refetchQueries({ queryKey: ['chat', 'machine-capacity'] })
    const view = renderHookWithProviders(() => useBalanceDraft(fixture.target, fixture.machines), {
      queryClient,
      settingsOwner: queryClient,
    })
    try {
      await waitFor(() => expect(view.result.current).not.toBeNull())
      if (fetchStatus === 'paused') expect(sawPaused).toBe(true)
      await waitFor(() =>
        expect(
          useChatInputDraftStore.getState().getDraft(fixture.target).identity?.machineSelection,
        ).toBe('required'),
      )
      const held = useChatInputDraftStore.getState().getDraft(fixture.target)
      expect(
        queryClient.getQueryState(
          machineCapacityKeys.resources(fixture.target.environmentId, origins[0]),
        )?.dataUpdatedAt,
      ).toBeLessThan(Date.now() - 15_000)
      await act(async () => {
        onlineManager.setOnline(true)
        const recovered = await queryClient.query(
          machineCapacityQueryOptions(fixture.machines[1]!.environmentId, origins[1]),
        )
        expect(recovered.cpuCount).toBe(128)
      })
      expect(view.result.current.requiresChoice).toBe(true)
      expect(useChatInputDraftStore.getState().getDraft(fixture.target)).toBe(held)
    } finally {
      view.unmount()
      onlineManager.setOnline(wasOnline)
      unsubscribe()
      queryClient.clear()
      useEnvironmentsStore.setState(previousEntries, true)
      useChatInputDraftStore.setState(previousDrafts, true)
      await first.cleanup()
      await second.cleanup()
    }
  },
)

test('an explicit branch pin supersedes an automatic move waiting in the scope queue', async ({
  server,
}) => {
  const fixture = machineDraftFixture()
  const h = await createFederationHarness(server)
  const a = await registerFederatedProject(h.serverA, h.clientA, 'queue-A')
  const b = await registerFederatedProject(h.serverB, h.clientB, 'queue-B')
  await waitFor(() =>
    expect(
      selectChatProjectionSlice(useChatProjectionStore.getState(), h.descriptorB.environmentId)
        .worktreeById[b.worktreeId!],
    ).toBeDefined(),
  )
  const target = { ...fixture.target, environmentId: h.descriptorA.environmentId, rootPath: 'repo' }
  const previousDrafts = useChatInputDraftStore.getState()
  const queryClient = createTestQueryClient()
  const navigation = createTestNavigation({ application: h.application })
  const gate = Promise.withResolvers<void>()
  const blocker = new MutationObserver(queryClient, {
    mutationKey: chatMutationKeys.moveDraft(h.descriptorB.environmentId, 'held-draft'),
    scope: { id: 'draft-move' },
    mutationFn: () => gate.promise,
  })
  const holding = blocker.mutate()
  const sourceIdentity = {
    ...fixture.identity,
    projectId: a.projectId!,
    rootPath: 'repo',
    baseWorktreeId: a.worktreeId!,
    worktreeTarget: { kind: 'current' as const, worktreeId: a.worktreeId! },
    machineSelection: 'automatic' as const,
  }
  useChatInputDraftStore.getState().setIdentity(target, sourceIdentity)
  useChatInputDraftStore.getState().setPrompt(target, 'Keep explicit intent')
  const view = renderHookWithProviders(() => useMoveDraft(target), {
    queryClient,
    navigation,
    application: h.application,
    connections: h.connections,
  })
  try {
    await waitFor(() => expect(view.result.current).not.toBeNull())
    act(() =>
      view.result.current.mutate({
        environmentId: h.descriptorB.environmentId,
        projectId: b.projectId!,
        worktree: { id: b.worktreeId!, path: 'repo' },
        machineSelection: 'automatic',
        sourceIdentity,
      }),
    )
    await waitFor(() => expect(view.result.current.isPaused).toBe(true))
    act(() =>
      useChatInputDraftStore.getState().setIdentity(target, {
        ...sourceIdentity,
        machineSelection: 'pinned',
        worktreeTarget: {
          kind: 'new',
          worktreeId: a.worktreeId!,
          baseWorktreeId: a.worktreeId!,
          baseBranch: 'release',
        },
      }),
    )
    const pinned = useChatInputDraftStore.getState().getDraft(target)
    const address = navigation.currentAddress()
    await act(async () => {
      gate.resolve()
      await holding
    })
    await waitFor(() => expect(view.result.current.status).toBe('success'), { timeout: 5_000 })
    expect(useChatInputDraftStore.getState().getDraft(target)).toBe(pinned)
    expect(view.result.current.data).toBe(false)
    expect(navigation.currentAddress()).toEqual(address)
    expect(pinned.identity?.worktreeTarget).toMatchObject({ kind: 'new', baseBranch: 'release' })
    expect(pinned.prompt).toBe('Keep explicit intent')
  } finally {
    gate.resolve()
    await holding
    blocker.reset()
    view.unmount()
    navigation.dispose()
    queryClient.clear()
    useChatInputDraftStore.setState(previousDrafts, true)
  }
})

test('separate draft controls observe an executing move and reopen after settlement', async () => {
  const fixture = machineDraftFixture()
  const queryClient = createTestQueryClient()
  const gate = Promise.withResolvers<void>()
  const executing = new MutationObserver(queryClient, {
    mutationKey: chatMutationKeys.moveDraft(fixture.target.environmentId, fixture.target.draftKey),
    scope: { id: 'draft-move' },
    mutationFn: () => gate.promise,
  })
  const view = renderHookWithProviders(() => useMoveDraft(fixture.target), { queryClient })
  let completion: Promise<void> | undefined
  try {
    await waitFor(() => expect(view.result.current).not.toBeNull())
    expect(view.result.current.canChange()).toBe(true)
    act(() => {
      completion = executing.mutate()
    })
    expect(view.result.current.canChange()).toBe(false)
    await waitFor(() => expect(view.result.current.isMoving).toBe(true))
    expect(view.result.current.isPending).toBe(true)
    await act(async () => {
      gate.resolve()
      await completion
    })
    await waitFor(() => expect(view.result.current.isMoving).toBe(false))
    expect(view.result.current.canChange()).toBe(true)
  } finally {
    gate.resolve()
    await completion
    executing.reset()
    view.unmount()
    queryClient.clear()
  }
})
