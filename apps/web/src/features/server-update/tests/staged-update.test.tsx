import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, onTestFinished } from 'vitest'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { MockProviderAdapter, orchestrationForApp, updateForApp } from 'server/testing'

import { createObservedInProcessClient } from '../../../../test/client'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { installTestClient } from '../../../../test/factories/client-binding'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { makeTestServer } from '../../../../test/server'
import { ServerUpdateStatus } from '@/components/server-update-status'
import { updateIntentStore } from '@/features/server-update/state/intent'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { serverUpdateMutationKeys } from '@/features/server-update/utils/mutation-keys'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'

beforeEach(() => {
  updateIntentStore.getState().setIntent({ kind: 'idle' })
  primaryQueryClient().removeQueries({ queryKey: serverUpdateQueryKeys.release() })
})

type RestartRecord = { interrupted: { sessionId: string }[] }

const SESSION_ID = '5f0c2d1e-7a44-4b8e-9d7e-2b1c3a4d5e6f'
const LATE_SESSION_ID = '6a1d3e2f-8b55-4c9f-8e8f-3c2d4b5e6f70'

/** A production root whose `pending` link names one staged release. */
async function stagedProduction() {
  const production = await mkdtemp(path.join(tmpdir(), 'web-server-update-'))
  const release = path.join(production, 'releases', 'staged-release')
  await mkdir(release, { recursive: true })
  await symlink(release, path.join(production, 'pending'))
  return production
}

/** A real app with a staged release whose provider holds its one turn open. */
async function busyServer() {
  const production = await stagedProduction()
  const held = Promise.withResolvers<void>()
  const waiters: Array<{ count: number; resolve: () => void }> = []
  let turns = 0
  const exits: RestartRecord[] = []
  const server = await makeTestServer({
    environmentId: TEST_ENVIRONMENT_ID,
    providerRuntime: true,
    providerAdapter: new MockProviderAdapter({
      beforeComplete: () => {
        turns += 1
        for (const waiter of waiters) if (turns >= waiter.count) waiter.resolve()
        return held.promise
      },
    }),
    update: { root: production, restart: (record) => exits.push(record) },
  })
  const requests: unknown[] = []
  const restartTransport = Promise.withResolvers<void>()
  let holdRestart = false
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/server/restart') return
    requests.push(await request.clone().json())
    if (holdRestart) await restartTransport.promise
  })
  const restoreClient = installTestClient(client)
  onTestFinished(async () => {
    held.resolve()
    restartTransport.resolve()
    restoreClient()
    await server.cleanup()
    await rm(production, { force: true, recursive: true })
  })

  const engine = orchestrationForApp(server.app)
  let command = 0
  const dispatch = (input: Record<string, unknown>) =>
    engine.dispatchClientCommand({ commandId: `server-update-${++command}`, ...input })
  const project = await dispatch({
    type: 'project.create',
    title: 'Platform',
    workspaceRoot: server.root,
  })
  if (!project.result || !('worktreeId' in project.result)) throw new TypeError('No worktree')
  const worktreeId = project.result.worktreeId
  const startTurn = async (sessionId: string, title: string) => {
    const started = Promise.withResolvers<void>()
    waiters.push({ count: turns + 1, resolve: started.resolve })
    await dispatch({
      type: 'session.create',
      sessionId,
      worktreeTarget: { kind: 'current', worktreeId },
      title,
      modelSelection: { providerInstanceId: 'codex', model: 'gpt-5-codex' },
      interactionMode: 'default',
      runtimeMode: 'full-access',
      createdAt: new Date().toISOString(),
    })
    await dispatch({
      type: 'session.turn.start',
      sessionId,
      turnId: `turn-${sessionId}`,
      message: { messageId: `message-${sessionId}`, role: 'user', text: 'Hello' },
      interactionMode: 'default',
      runtimeMode: 'full-access',
      createdAt: new Date().toISOString(),
    })
    await started.promise
  }
  await startTurn(SESSION_ID, 'Fix the parser')
  // The socket's push, delivered the way the orchestration client records it.
  useEnvironmentsStore
    .getState()
    .recordServerUpdate(primaryServerOrigin(), updateForApp(server.app).state())
  return {
    async deadlineSettings() {
      await saveSettings(
        {
          mutationId: 'busy-update-deadline',
          operations: [{ key: 'server.activationTimeoutSeconds', kind: 'set', value: 1 }],
          target: 'user',
        },
        client,
      )
      const queryClient = createTestQueryClient()
      queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
      onTestFinished(() => queryClient.clear())
      return queryClient
    },
    exits,
    requests,
    startTurn,
    holdRestart() {
      holdRestart = true
    },
    releaseRestart() {
      restartTransport.resolve()
    },
    async finishTurns() {
      held.resolve()
      await engine.providerRuntimeIdle()
    },
  }
}

test('Update app lists busy sessions, closing keeps them, and Update now interrupts the accepted list', async () => {
  const { exits, startTurn } = await busyServer()
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />)

  expect(await screen.findByRole('button', { name: 'Update app' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Update app' }))
  const dialog = await screen.findByRole('dialog', { name: 'Update now?' })
  expect(within(dialog).getByText('Fix the parser')).toBeInTheDocument()
  expect(within(dialog).getByText('Running')).toBeInTheDocument()
  expect(within(dialog).getByText('Updating now interrupts 1 session.')).toBeInTheDocument()
  expect(exits).toEqual([])

  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(exits).toEqual([])

  await user.click(screen.getByRole('button', { name: 'Update app' }))
  const again = await screen.findByRole('dialog', { name: 'Update now?' })
  await startTurn(LATE_SESSION_ID, 'Write the docs')
  await user.click(within(again).getByRole('button', { name: 'Update now' }))

  // A session that became busy after the first answer comes back in the same dialog.
  expect(await within(again).findByText('Write the docs')).toBeInTheDocument()
  expect(within(again).getByText('Fix the parser')).toBeInTheDocument()
  expect(exits).toEqual([])

  await user.click(within(again).getByRole('button', { name: 'Update now' }))
  expect(
    await screen.findByRole('button', { name: /Restarting…|Reconnecting…|Waiting for readiness…/ }),
  ).toBeInTheDocument()
  expect(exits).toHaveLength(1)
  expect(exits[0]?.interrupted.map((session) => session.sessionId).sort()).toEqual(
    [SESSION_ID, LATE_SESSION_ID].sort(),
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('Update when done waits for authoritative busy state to clear without interrupting', async () => {
  const { deadlineSettings, exits, requests, finishTurns } = await busyServer()
  const queryClient = await deadlineSettings()
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />, { queryClient })

  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  const popover = await screen.findByRole('dialog', { name: 'Update now?' })
  expect(within(popover).getByText('Fix the parser')).toBeInTheDocument()
  await user.click(within(popover).getByRole('button', { name: 'Update when done' }))
  expect(exits).toEqual([])

  const requestCount = requests.length
  // Re-reading the same busy snapshot cannot turn waiting into forced interruption.
  await act(async () => {
    await primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  })
  expect(exits).toEqual([])

  expect(requests).toHaveLength(requestCount)
  const waitingSince = Date.now()
  await waitFor(() => expect(Date.now() - waitingSince).toBeGreaterThanOrEqual(2400), {
    timeout: 4000,
  })
  expect(updateIntentStore.getState().intent.kind).toBe('waiting')
  expect(screen.queryByRole('button', { name: 'Retry update' })).toBeNull()
  expect(exits).toEqual([])
  expect(requests).toHaveLength(requestCount)

  await finishTurns()
  await act(async () => {
    await primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  })
  await waitFor(() => expect(exits).toHaveLength(1))
  expect(exits[0]?.interrupted).toEqual([])
  expect(requests).toHaveLength(requestCount + 1)
  expect(requests.at(-1)).toMatchObject({ interrupt: [] })
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('a hung automatic restart is bounded and its late acknowledgement cannot overwrite a retry', async () => {
  const fixture = await busyServer()
  const queryClient = await fixture.deadlineSettings()
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />, { queryClient })
  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  const dialog = await screen.findByRole('dialog', { name: 'Update now?' })
  await user.click(within(dialog).getByRole('button', { name: 'Update when done' }))
  const beforeAutomaticRestart = fixture.requests.length
  fixture.holdRestart()
  await fixture.finishTurns()
  await act(async () => {
    await primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
  })
  await waitFor(() => expect(fixture.requests).toHaveLength(beforeAutomaticRestart + 1))
  expect(fixture.requests.at(-1)).toMatchObject({ interrupt: [] })
  expect(fixture.exits).toEqual([])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(), {
    timeout: 4000,
  })
  const expired = updateIntentStore.getState().intent
  expect(expired.kind).toBe('failed')
  if (expired.kind !== 'failed') return
  await user.click(screen.getByRole('button', { name: 'Retry update' }))
  await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe('restarting'))
  const retried = updateIntentStore.getState().intent
  expect(retried).toMatchObject({ target: expired.target })
  if (retried.kind !== 'restarting') return
  expect(fixture.requests).toHaveLength(beforeAutomaticRestart + 1)
  fixture.releaseRestart()
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await waitFor(() =>
    expect(
      primaryQueryClient().isMutating({ mutationKey: serverUpdateMutationKeys.restart() }),
    ).toBe(0),
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Restarting…|Reconnecting…|Waiting for readiness…/ }),
    ).toHaveAttribute('aria-busy', 'true'),
  )
  expect(updateIntentStore.getState().intent).toMatchObject({
    kind: 'restarting',
    target: expired.target,
    startedAt: retried.startedAt,
  })
  expect(
    fixture.requests.every(
      (request) => (request as { interrupt: unknown[] }).interrupt.length === 0,
    ),
  ).toBe(true)
})

test('a dropped restart reaches bounded exact-target retry when the same server instance reconnects', async () => {
  const production = await stagedProduction()
  const server = await makeTestServer({
    environmentId: TEST_ENVIRONMENT_ID,
    update: { root: production, restart: () => {} },
  })
  const requests: unknown[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname !== '/server/restart') return
    requests.push(await request.clone().json())
    throw new TypeError('Failed to fetch')
  })
  const restoreClient = installTestClient(client)
  onTestFinished(async () => {
    restoreClient()
    resetServerConnectionStore()
    await server.cleanup()
    await rm(production, { force: true, recursive: true })
  })
  const origin = primaryServerOrigin()
  const store = useEnvironmentsStore.getState()
  const connected = orchestrationServerConfig({
    environmentId: TEST_ENVIRONMENT_ID,
    serverInstanceId: 'server-1',
  })
  store.recordHandshake(origin, connected)
  store.recordServerUpdate(origin, updateForApp(server.app).state())
  await saveSettings(
    {
      mutationId: 'dropped-update-deadline',
      operations: [{ key: 'server.activationTimeoutSeconds', kind: 'set', value: 1 }],
      target: 'user',
    },
    client,
  )
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, client))
  onTestFinished(() => queryClient.clear())
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />, { queryClient })

  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(
    await screen.findByRole('button', { name: /Restarting…|Reconnecting…|Waiting for readiness…/ }),
  ).toBeInTheDocument()
  const original = updateIntentStore.getState().intent
  expect(original.kind).toBe('restarting')
  if (original.kind !== 'restarting') return
  expect(original.confirmed).toBe(false)

  act(() => useEnvironmentsStore.getState().markDisconnected(origin))
  expect(
    await screen.findByRole('button', { name: /Restarting…|Reconnecting…|Waiting for readiness…/ }),
  ).toBeInTheDocument()

  // Reconnecting to the same process proves nothing restarted.
  act(() => useEnvironmentsStore.getState().recordHandshake(origin, connected))
  expect(
    await screen.findByRole('button', { name: /Restarting…|Reconnecting…|Waiting for readiness…/ }),
  ).toBeInTheDocument()
  expect(requests).toHaveLength(1)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(), {
    timeout: 4000,
  })
  expect(updateIntentStore.getState().intent).toMatchObject({
    kind: 'failed',
    target: original.target,
  })
  await user.click(screen.getByRole('button', { name: 'Retry update' }))
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1]).toEqual(requests[0])
  expect(requests[1]).toMatchObject({ interrupt: [] })
})
