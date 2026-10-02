import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'
import { ServerUpdateStatus } from '@/components/server-update-status'
import { updateIntentStore } from '@/features/server-update/state/intent'
import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
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
  const server = await makeTestServer({
    environmentId: TEST_ENVIRONMENT_ID,
    web: {
      root: path.join(production, 'current', 'web'),
      serverReleaseFile: path.join(production, 'current', 'build-config.json'),
    },
    update: { root: production, restart: (record) => exits.push(record) },
  })
  const client = createObservedInProcessClient(server, async (request) => {
    if (new URL(request.url).pathname === '/server/restart')
      requests.push(await request.clone().json())
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
      await primaryQueryClient().invalidateQueries({ queryKey: serverUpdateQueryKeys.release() })
    })
  }

  return {
    requests,
    exits,
    refresh,
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
      await server.restart()
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
  const safety = createStore(() => ({ dirtyFiles: ['draft.ts', 'other.ts'] as readonly string[] }))
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
