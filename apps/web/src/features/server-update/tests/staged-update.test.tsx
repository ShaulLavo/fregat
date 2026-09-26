import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { MockProviderAdapter, orchestrationForApp, updateForApp } from 'server/testing'

import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { installTestClient } from '../../../../test/factories/client-binding'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'
import { ServerUpdateStatus } from '@/features/server-update/components/status'
import { primaryServerOrigin } from '@/lib/client'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'

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
  const restoreClient = installTestClient(createInProcessClient(server))
  onTestFinished(async () => {
    held.resolve()
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
  return { exits, startTurn }
}

test('Restart names the running session, Cancel keeps it, and confirming restarts the server', async () => {
  const { exits, startTurn } = await busyServer()
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />)

  expect(await screen.findByText('Update available')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Restart' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Restart server' })
  expect(within(dialog).getByText('Fix the parser')).toBeInTheDocument()
  expect(within(dialog).getByText('Running')).toBeInTheDocument()
  expect(
    within(dialog).getByText(
      'Restarting interrupts 1 session. Queued messages start on the new server.',
    ),
  ).toBeInTheDocument()
  expect(exits).toEqual([])

  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(exits).toEqual([])

  await user.click(screen.getByRole('button', { name: 'Restart' }))
  const again = await screen.findByRole('alertdialog', { name: 'Restart server' })
  await startTurn(LATE_SESSION_ID, 'Write the docs')
  await user.click(within(again).getByRole('button', { name: 'Restart' }))

  // A session that became busy after the first answer comes back in the same dialog.
  expect(await within(again).findByText('Write the docs')).toBeInTheDocument()
  expect(within(again).getByText('Fix the parser')).toBeInTheDocument()
  expect(exits).toEqual([])

  await user.click(within(again).getByRole('button', { name: 'Restart' }))
  expect(await screen.findByText('Restarting…')).toBeInTheDocument()
  expect(exits).toHaveLength(1)
  expect(exits[0]?.interrupted.map((session) => session.sessionId).toSorted()).toEqual(
    [SESSION_ID, LATE_SESSION_ID].toSorted(),
  )
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('A dropped Restart request shows Restarting… only while the socket is off the instance it asked', async () => {
  const production = await stagedProduction()
  const server = await makeTestServer({
    environmentId: TEST_ENVIRONMENT_ID,
    update: { root: production, restart: () => {} },
  })
  let attempts = 0
  const restoreClient = installTestClient(
    createObservedInProcessClient(server, (request) => {
      if (new URL(request.url).pathname !== '/server/restart') return
      attempts += 1
      throw new TypeError('Failed to fetch')
    }),
  )
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
  const user = userEvent.setup()
  renderWithProviders(<ServerUpdateStatus />)

  await user.click(await screen.findByRole('button', { name: 'Restart' }))
  await waitFor(() => expect(attempts).toBe(1))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Restart' })).toBeEnabled())
  expect(screen.queryByText('Restarting…')).toBeNull()

  act(() => useEnvironmentsStore.getState().markDisconnected(origin))
  expect(await screen.findByText('Restarting…')).toBeInTheDocument()

  // Reconnecting to the same process proves nothing restarted.
  act(() => useEnvironmentsStore.getState().recordHandshake(origin, connected))
  expect(await screen.findByText('Update available')).toBeInTheDocument()
  expect(screen.queryByText('Restarting…')).toBeNull()
})
