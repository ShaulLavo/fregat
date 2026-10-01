import { createSessionArchiveCommand } from '@workspace/client-core/chat/commands'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { act, waitFor } from '@testing-library/react'
import { environmentIdSchema, scopedSessionKey } from '@workspace/contracts'
import { useSessionSearch } from '@/features/chat-mode/hooks/use-session-search'
import { useSessionSearchStore } from '@/features/chat-mode/state/session-search-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  queryClientFor,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { activeServerOrigin } from '@/lib/client'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { renderHookWithProviders } from '../../../../../test/render'
import { createRailHarness } from '../../../../../test/factories/rail-harness'
import { seedSearchSession } from '../../../../../test/factories/session-search'
import { createInProcessClient } from '../../../../../test/client'
import { makeTestServer } from '../../../../../test/server'
import { TEST_SESSION_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import * as v from 'valibot'

const remoteId = v.parse(environmentIdSchema, 'e0000000-0000-4000-8000-000000000098')
const remoteOrigin = 'http://remote-hook-search.test'

test('partial disconnect removes only remote matches and retains the completed local scan', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server)
  const remote = await makeTestServer({ environmentId: remoteId })
  const previousProjection = useChatProjectionStore.getState().slices
  const priorQuery = useSessionRailStore.getState().query
  let unmount = () => {}
  try {
    const remoteClient = createInProcessClient(remote)
    const sharedId = harness.sessionIds[0]!
    await seedSearchSession(remoteClient, remote.root, sharedId, 'crossownerneedle')
    await seedSearchSession(client, server.root, TEST_SESSION_ID, 'crossownerneedle')
    await harness.refresh()
    registerEnvironmentQueryClient(
      queryClientFor(activeServerOrigin()),
      activeServerOrigin(),
      client,
    )
    registerEnvironmentQueryClient(queryClientFor(remoteOrigin), remoteOrigin, remoteClient)
    useChatProjectionStore
      .getState()
      .syncShellSnapshot(remoteId, await fetchOrchestrationShellSnapshotHttp(remoteClient))
    useEnvironmentsStore.setState((state) => ({
      entries: {
        ...state.entries,
        [remoteOrigin]: {
          ...createEnvironmentEntry(remoteOrigin, activeServerOrigin()),
          environmentId: remoteId,
          label: 'Remote search',
          phase: 'live',
        },
      },
    }))
    useSessionRailStore.getState().setQuery('crossownerneedle')
    const hook = renderHookWithProviders(() => useSessionSearch())
    unmount = hook.unmount
    await waitFor(() =>
      expect(Object.keys(useSessionSearchStore.getState().matchBySessionKey).sort()).toEqual(
        [
          scopedSessionKey({ environmentId: remoteId, sessionId: sharedId }),
          scopedSessionKey({ environmentId: harness.environmentId, sessionId: TEST_SESSION_ID }),
        ].sort(),
      ),
    )
    expect(useSessionSearchStore.getState().searching).toBe(false)
    expect(
      (
        await remoteClient.orchestration.commands.post(
          createSessionArchiveCommand({ sessionId: sharedId }),
        )
      ).error,
    ).toBeNull()
    const archived = await fetchOrchestrationShellSnapshotHttp(remoteClient)
    act(() => useChatProjectionStore.getState().syncShellSnapshot(remoteId, archived))
    const matched = useSessionSearchStore.getState().matchBySessionKey
    const model = (machineFilter: typeof remoteId, view: 'active' | 'archived') =>
      sessionRailModel({
        environments: currentRailEnvironments(),
        query: 'crossownerneedle',
        searchMatches: matched,
        machineFilter,
        view,
      })
    expect(model(remoteId, 'active').sessions).toEqual([])
    expect(model(remoteId, 'archived').sessions.map((row) => row.key)).toEqual([
      scopedSessionKey({ environmentId: remoteId, sessionId: sharedId }),
    ])
    expect(model(harness.environmentId, 'active').sessions.map((row) => row.key)).toEqual([
      scopedSessionKey({ environmentId: harness.environmentId, sessionId: TEST_SESSION_ID }),
    ])
    expect(model(harness.environmentId, 'archived').sessions).toEqual([])
    act(() =>
      useEnvironmentsStore.setState((state) => ({
        entries: {
          ...state.entries,
          [remoteOrigin]: { ...state.entries[remoteOrigin]!, phase: 'offline' },
        },
      })),
    )
    await waitFor(() =>
      expect(useSessionSearchStore.getState().unavailable).toContain('Remote search'),
    )
    expect(Object.keys(useSessionSearchStore.getState().matchBySessionKey)).toEqual([
      scopedSessionKey({ environmentId: harness.environmentId, sessionId: TEST_SESSION_ID }),
    ])
    expect(useSessionSearchStore.getState().searching).toBe(false)
  } finally {
    unmount()
    useSessionRailStore.getState().setQuery(priorQuery)
    useChatProjectionStore.setState({ slices: previousProjection })
    useSessionSearchStore.getState().begin('', false)
    queryClientFor(remoteOrigin).clear()
    await remote.cleanup()
  }
})
