import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { updateForApp } from 'server/testing'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { toast } from 'sonner'
import { onTestFinished } from 'vitest'
import { createStore } from 'zustand/vanilla'

import { createInProcessClient, createObservedInProcessClient } from '../../../../test/client'
import { TEST_ENVIRONMENT_ID } from '../../../../test/factories/chat'
import { installTestClient } from '../../../../test/factories/client-binding'
import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { fetchSettings, saveSettings } from '@/features/settings/utils/api'
import { makeTestServer } from '../../../../test/server'
import { ServerUpdateStatus } from '@/components/server-update-status'
import { updateIntentStore } from '@/features/server-update/state/intent'
import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { serverUpdateMutationKeys } from '@/features/server-update/utils/mutation-keys'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { resetServerConnectionStore, useEnvironmentsStore } from '@/lib/environments/state/store'

async function releaseFixture({ liveCheck = true } = {}) {
  const production = await mkdtemp(path.join(tmpdir(), 'web-update-reload-'))
  const release = (name: string) => path.join(production, 'releases', name)
  for (const name of ['running-release', 'target-release', 'newer-release']) {
    await mkdir(path.join(release(name), 'web'), { recursive: true })
    await writeFile(
      path.join(release(name), 'web', 'index.html'),
      '<!doctype html><title>App</title>',
    )
    await writeFile(
      path.join(release(name), 'build-config.json'),
      JSON.stringify({ release: name, liveCheck }),
    )
  }
  await symlink(release('running-release'), path.join(production, 'current'))
  await symlink(release('target-release'), path.join(production, 'pending'))
  const requests: unknown[] = []
  const exits: unknown[] = []
  const serverReleaseFile = path.join(production, 'server-build-config.json')
  await writeFile(
    serverReleaseFile,
    await readFile(path.join(release('running-release'), 'build-config.json')),
  )
  const server = await makeTestServer({
    environmentId: TEST_ENVIRONMENT_ID,
    web: {
      root: path.join(production, 'current', 'web'),
      serverReleaseFile,
    },
    update: { root: production, restart: (record) => exits.push(record) },
  })
  let descriptorUnavailable = false
  const restartTransport = Promise.withResolvers<void>()
  let holdRestart = false
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname === '/release' && descriptorUnavailable)
      throw new TypeError('Failed to fetch')
    if (new URL(request.url).pathname !== '/server/restart') return
    requests.push(await request.clone().json())
    if (holdRestart) await restartTransport.promise
  })
  const restore = installTestClient(client)
  const meta = document.createElement('meta')
  meta.name = 'platform-release'
  meta.content = 'running-release'
  document.head.append(meta)
  updateIntentStore.getState().setIntent({ kind: 'idle' })
  primaryQueryClient().removeQueries({ queryKey: serverUpdateQueryKeys.release() })
  const origin = primaryServerOrigin()
  useEnvironmentsStore.getState().recordHandshake(
    origin,
    orchestrationServerConfig({
      environmentId: TEST_ENVIRONMENT_ID,
      serverInstanceId: 'server-1',
    }),
  )
  useEnvironmentsStore.getState().recordServerUpdate(origin, updateForApp(server.app).state())
  onTestFinished(async () => {
    restartTransport.resolve()
    await waitFor(() =>
      expect(
        primaryQueryClient().isMutating({ mutationKey: serverUpdateMutationKeys.restart() }),
      ).toBe(0),
    )
    meta.remove()
    restore()
    resetServerConnectionStore()
    updateIntentStore.getState().setIntent({ kind: 'idle' })
    primaryQueryClient().removeQueries({ queryKey: serverUpdateQueryKeys.release() })
    await server.cleanup()
    await rm(production, { force: true, recursive: true })
  })

  async function refresh() {
    await act(async () => {
      useEnvironmentsStore.getState().recordServerUpdate(origin, updateForApp(server.app).state())
      await primaryQueryClient().invalidateQueries({
        queryKey: serverUpdateQueryKeys.release(),
      })
    })
  }

  return {
    requests,
    exits,
    refresh,
    holdRestart() {
      holdRestart = true
    },
    releaseRestart() {
      restartTransport.resolve()
    },
    failDescriptor() {
      descriptorUnavailable = true
    },
    restoreDescriptor() {
      descriptorUnavailable = false
    },
    async deadlineSettings() {
      await saveSettings(
        {
          mutationId: 'update-reload-deadline',
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
    disconnect() {
      act(() => useEnvironmentsStore.getState().markDisconnected(origin))
    },
    reconnect() {
      act(() =>
        useEnvironmentsStore.getState().recordHandshake(
          origin,
          orchestrationServerConfig({
            environmentId: TEST_ENVIRONMENT_ID,
            serverInstanceId: 'server-2',
          }),
        ),
      )
    },
    async promote(name = 'target-release') {
      await rm(path.join(production, 'current'))
      await symlink(release(name), path.join(production, 'current'))
      await rm(path.join(production, 'pending'), { force: true })
      await writeFile(
        serverReleaseFile,
        await readFile(path.join(release(name), 'build-config.json')),
      )
      await server.restart()
      await refresh()
    },
    async publishWeb(name = 'newer-release') {
      await rm(path.join(production, 'current'))
      await symlink(release(name), path.join(production, 'current'))
      updateForApp(server.app).reread('release')
      await refresh()
    },
    async verdict(
      status: 'passed' | 'failed',
      name = 'target-release',
      checkedAt = new Date().toISOString(),
    ) {
      await writeFile(
        path.join(release(name), 'live-check.json'),
        JSON.stringify({ release: name, status, checkedAt, fresh: [] }),
      )
      updateForApp(server.app).reread('release')
      await refresh()
    },
    async clearVerdict(name = 'target-release') {
      await rm(path.join(release(name), 'live-check.json'), { force: true })
      updateForApp(server.app).reread('release')
      await refresh()
    },
    async restage(name = 'newer-release') {
      await rm(path.join(production, 'pending'), { force: true })
      await symlink(release(name), path.join(production, 'pending'))
      updateForApp(server.app).reread('release')
      await refresh()
    },
    async response() {
      return (await createInProcessClient(server).release.get()).data
    },
  }
}

test('an explicitly skipped live check reloads the exact healthy target without a report', async () => {
  const fixture = await releaseFixture({ liveCheck: false })
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  expect(fixture.requests).toEqual([
    {
      target: expect.objectContaining({ release: 'target-release', stagedAt: expect.any(String) }),
      interrupt: [],
    },
  ])
  expect(reloads).toBe(0)

  await fixture.promote()
  expect((await fixture.response())?.server.release).toBe('target-release')
  expect((await fixture.response())?.liveCheck).toBeNull()
  expect((await fixture.response())?.liveCheckRequired).toBe(false)
  await waitFor(() => expect(reloads).toBe(1))
  await fixture.refresh()
  expect(reloads).toBe(1)
  expect(toast.getHistory().some((shown) => shown.id === 'client-update')).toBe(false)
})

test.each(['old server still running', 'missing live check', 'unavailable descriptor'] as const)(
  'an accepted restart reaches bounded retry recovery with %s',
  async (failure) => {
    const fixture = await releaseFixture()
    const queryClient = await fixture.deadlineSettings()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
      queryClient,
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(fixture.exits).toHaveLength(1))
    const accepted = updateIntentStore.getState().intent
    expect(accepted.kind).toBe('restarting')
    if (accepted.kind !== 'restarting') return

    if (failure === 'unavailable descriptor') {
      fixture.failDescriptor()
      fixture.disconnect()
      await fixture.refresh()
    }
    if (failure === 'missing live check') await fixture.promote()
    expect(reloads).toBe(0)
    expect(await screen.findByText('Updating…')).toBeInTheDocument()
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(),
      { timeout: 4000 },
    )
    expect(updateIntentStore.getState().intent).toMatchObject({
      kind: 'failed',
      target: accepted.target,
    })
    expect(reloads).toBe(0)
    expect(fixture.requests).toHaveLength(1)
    expect(screen.queryByText('Updating…')).toBeNull()
    await user.unhover(screen.getByRole('button', { name: 'Retry update' }))
    await user.hover(screen.getByRole('button', { name: 'Retry update' }))
    expect(await screen.findByText(/within the update time limit/)).toBeVisible()
  },
)

test.each(['timeout', 'unreachable'] as const)(
  'retrying a %s restart resends the exact target when the old server still has it staged',
  async (reason) => {
    const fixture = await releaseFixture()
    const queryClient = await fixture.deadlineSettings()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
      queryClient,
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(fixture.exits).toHaveLength(1))
    if (reason === 'unreachable') {
      fixture.failDescriptor()
      fixture.disconnect()
      await fixture.refresh()
    }
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(),
      {
        timeout: 4000,
      },
    )
    if (reason === 'unreachable') {
      fixture.restoreDescriptor()
      fixture.reconnect()
      await fixture.refresh()
    }
    await user.click(screen.getByRole('button', { name: 'Retry update' }))
    await waitFor(() => expect(fixture.requests).toHaveLength(2))
    expect(fixture.requests[1]).toEqual(fixture.requests[0])
    expect(fixture.requests[1]).toMatchObject({ interrupt: [] })
    expect(reloads).toBe(0)
    await fixture.promote()
    await fixture.verdict('passed')
    await waitFor(() => expect(reloads).toBe(1))
  },
)

test('a newer promoted release clears a timed out staged intent and offers its own reload', async () => {
  const fixture = await releaseFixture()
  const queryClient = await fixture.deadlineSettings()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
    queryClient,
  })
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(), {
    timeout: 4000,
  })
  fixture.disconnect()
  await fixture.promote('newer-release')
  fixture.reconnect()
  await fixture.refresh()
  await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe('idle'))
  expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()
  expect((await fixture.response())?.pending).toBeNull()
  expect((await fixture.response())?.server.release).toBe('newer-release')
  expect(reloads).toBe(0)
})

test.each(['restarting', 'failed'] as const)(
  'a web-only publication clears a %s staged intent when server and web releases differ',
  async (phase) => {
    const fixture = await releaseFixture()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(fixture.exits).toHaveLength(1))
    await fixture.promote()
    if (phase === 'failed') await fixture.verdict('failed')
    await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe(phase))
    await fixture.publishWeb()
    const descriptor = await fixture.response()
    expect(descriptor?.server.release).toBe('target-release')
    expect(descriptor?.release).toBe('newer-release')
    expect(descriptor?.pending).toBeNull()
    await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe('idle'))
    expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()
    expect(reloads).toBe(0)
  },
)

test.each(['missing', 'failed'] as const)(
  'a waiting staged target externally promoted with a %s check reaches bounded recovery after saving',
  async (check) => {
    const fixture = await releaseFixture()
    const queryClient = await fixture.deadlineSettings()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: ['draft.ts'] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
      queryClient,
    })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Update app' }))
    await user.click(await screen.findByRole('button', { name: 'Update when done' }))
    expect(updateIntentStore.getState().intent.kind).toBe('waiting')
    await fixture.promote()
    if (check === 'failed') await fixture.verdict('failed')
    expect(reloads).toBe(0)
    act(() => safety.setState({ dirtyFiles: [] }))
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(),
      {
        timeout: 4000,
      },
    )
    expect(updateIntentStore.getState().intent).toMatchObject({
      kind: 'failed',
      reason: check === 'failed' ? 'health-check' : 'timeout',
      target: { release: 'target-release', stagedAt: expect.any(String) },
    })
    expect(fixture.requests).toEqual([])
    expect(fixture.exits).toEqual([])
    expect(reloads).toBe(0)
  },
)

test.each(['page-only', 'staged'] as const)(
  'an old hung restart cannot keep a superseding %s release busy',
  async (next) => {
    const fixture = await releaseFixture()
    const queryClient = await fixture.deadlineSettings()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
      queryClient,
    })
    const user = userEvent.setup()
    fixture.holdRestart()
    await user.click(await screen.findByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(fixture.requests).toHaveLength(1))
    if (next === 'page-only') await fixture.promote('newer-release')
    else await fixture.restage()
    await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe('idle'))
    expect(
      await screen.findByRole('button', {
        name: next === 'page-only' ? 'Reload app' : 'Update app',
      }),
    ).toBeEnabled()
    expect(screen.queryByText('Updating…')).toBeNull()
    if (next === 'page-only') {
      act(() => safety.setState({ dirtyFiles: ['draft.ts'] }))
      await user.click(screen.getByRole('button', { name: 'Reload app' }))
      expect(await screen.findByText('draft.ts')).toBeInTheDocument()
      expect(reloads).toBe(0)
    } else {
      await user.click(screen.getByRole('button', { name: 'Update app' }))
      await waitFor(
        () => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(),
        {
          timeout: 4000,
        },
      )
      expect(updateIntentStore.getState().intent).toMatchObject({
        kind: 'failed',
        target: { release: 'newer-release' },
      })
    }
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.exits).toEqual([])
    fixture.releaseRestart()
    await waitFor(() =>
      expect(
        primaryQueryClient().isMutating({ mutationKey: serverUpdateMutationKeys.restart() }),
      ).toBe(0),
    )
  },
)

test('a required live check waits for a fresh passed verdict after the exact target is served', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))

  await fixture.promote()
  expect((await fixture.response())?.server.release).toBe('target-release')
  expect((await fixture.response())?.liveCheckRequired).toBe(true)
  expect((await fixture.response())?.liveCheck).toBeNull()
  expect(reloads).toBe(0)
  await fixture.verdict('passed')
  await waitFor(() => expect(reloads).toBe(1))
})

test('retrying a failed staged live check preserves its exact health target until a fresh pass', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  const target = updateIntentStore.getState().intent
  expect(target.kind).toBe('restarting')
  if (target.kind !== 'restarting') return

  await fixture.promote()
  await fixture.verdict('failed')
  await user.click(await screen.findByRole('button', { name: 'Retry update' }))
  expect(reloads).toBe(0)
  expect(updateIntentStore.getState().intent).toMatchObject({
    target: target.target,
  })
  expect(fixture.requests).toHaveLength(1)
  await fixture.refresh()
  expect(reloads).toBe(0)
  await fixture.verdict('passed', 'target-release', '2000-01-01T00:00:00.000Z')
  expect(reloads).toBe(0)
  await fixture.verdict('passed')
  await waitFor(() => expect(reloads).toBe(1))
})

test('a successful health retry keeps unsaved buffers protected until the last buffer is saved', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await fixture.promote()
  await fixture.verdict('failed')
  await user.click(await screen.findByRole('button', { name: 'Retry update' }))
  expect(reloads).toBe(0)
  act(() => safety.setState({ dirtyFiles: ['draft.ts'] }))
  await fixture.verdict('passed')
  expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()
  expect(reloads).toBe(0)
  expect(fixture.requests).toHaveLength(1)
  await fixture.refresh()
  expect(reloads).toBe(0)
  act(() => safety.setState({ dirtyFiles: [] }))
  await waitFor(() => expect(reloads).toBe(1))
})

test('a stale passed verdict cannot satisfy the exact staged target until a fresh check arrives', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))

  await fixture.verdict('passed', 'target-release', '2000-01-01T00:00:00.000Z')
  await fixture.promote()
  expect((await fixture.response())?.liveCheck?.status).toBe('passed')
  expect(reloads).toBe(0)
  await fixture.verdict('passed')
  await waitFor(() => expect(reloads).toBe(1))
})

test('unsaved buffers defer a healthy target reload and saving the last buffer clears the deferral', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({
    dirtyFiles: ['draft.ts', 'other.ts'] as readonly string[],
  }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Update app' }))
  expect(await screen.findByText('draft.ts')).toBeInTheDocument()
  expect(fixture.exits).toEqual([])
  await user.click(screen.getByRole('button', { name: 'Update now' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await fixture.promote()
  await fixture.verdict('passed')
  expect(reloads).toBe(0)
  expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()

  act(() => safety.setState({ dirtyFiles: ['other.ts'] }))
  await fixture.refresh()
  expect(reloads).toBe(0)

  act(() => safety.setState({ dirtyFiles: [] }))
  await waitFor(() => expect(reloads).toBe(1))
  await fixture.refresh()
  expect(reloads).toBe(1)
})

test.each(['failed', 'missing'] as const)(
  'a dirty deferred reload whose verdict becomes %s reaches recovery and retains its health target',
  async (verdict) => {
    const fixture = await releaseFixture()
    const queryClient = await fixture.deadlineSettings()
    let reloads = 0
    const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
    renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />, {
      queryClient,
    })
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(fixture.exits).toHaveLength(1))
    await fixture.promote()
    act(() => safety.setState({ dirtyFiles: ['draft.ts'] }))
    await fixture.verdict('passed')
    expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()
    const deferred = updateIntentStore.getState().intent
    expect(deferred.kind).toBe('reload')
    if (deferred.kind !== 'reload') return
    if (verdict === 'failed') await fixture.verdict('failed')
    else await fixture.clearVerdict()
    expect(reloads).toBe(0)
    act(() => safety.setState({ dirtyFiles: [] }))
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Retry update' })).toBeEnabled(),
      {
        timeout: 4000,
      },
    )
    expect(updateIntentStore.getState().intent).toMatchObject({
      kind: 'failed',
      reason: verdict === 'failed' ? 'health-check' : 'timeout',
      target: deferred.target,
    })
    expect(reloads).toBe(0)
    expect(fixture.requests).toHaveLength(1)
    expect(fixture.exits).toHaveLength(1)
  },
)

test('a healthy different release after restaging never fulfills the original reload intent', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await fixture.restage()
  await fixture.promote('newer-release')
  await fixture.verdict('passed', 'newer-release')
  expect((await fixture.response())?.server.release).toBe('newer-release')
  expect(reloads).toBe(0)
})

test('a newer promoted release after a missed restage push clears the old intent and offers its own reload', async () => {
  const fixture = await releaseFixture()
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))

  fixture.disconnect()
  // Promotion happens during the socket gap; this client never sees the newer pending link.
  await fixture.promote('newer-release')
  fixture.reconnect()
  await fixture.refresh()
  await waitFor(() => expect(updateIntentStore.getState().intent.kind).toBe('idle'))
  expect(await screen.findByRole('button', { name: 'Reload app' })).toBeInTheDocument()
  expect((await fixture.response())?.pending).toBeNull()
  expect(reloads).toBe(0)
})

test('a failed live check blocks reload even for a skipped policy and keeps its failure feedback', async () => {
  const fixture = await releaseFixture({ liveCheck: false })
  let reloads = 0
  const safety = createStore(() => ({ dirtyFiles: [] as readonly string[] }))
  renderWithProviders(<ServerUpdateStatus reload={() => reloads++} safety={safety} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Update app' }))
  await waitFor(() => expect(fixture.exits).toHaveLength(1))
  await fixture.verdict('failed')
  await fixture.promote()
  await waitFor(() => {
    expect(
      toast.getHistory().some((shown) => String(shown.id).startsWith('live-check:target-release:')),
    ).toBe(true)
  })
  expect(reloads).toBe(0)
  await fixture.refresh()
  expect(reloads).toBe(0)
})
