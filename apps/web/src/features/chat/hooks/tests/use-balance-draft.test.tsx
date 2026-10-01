import { act, waitFor } from '@testing-library/react'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { test, expect } from '../../../../../test/fixtures'
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
