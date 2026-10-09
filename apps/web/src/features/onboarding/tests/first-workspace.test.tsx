import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished, vi } from 'vitest'

import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { FirstWorkspace } from '@/features/onboarding/components/first-workspace'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { createFederationHarness } from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { renderWithLoadedDialogs } from '../../../../test/render'

async function renderFirstWorkspace(server: Parameters<typeof createFederationHarness>[0]) {
  const h = await createFederationHarness(server)
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  // The folder list is virtualized and mounts no rows while its scroll box measures zero.
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  onTestFinished(() => height.mockRestore())
  return h
}

function rootPath(h: Awaited<ReturnType<typeof createFederationHarness>>) {
  return h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path ?? null
}

function projectCount(environmentId: string) {
  return useChatProjectionStore.getState().slices[environmentId as never]?.projectIds.length ?? 0
}

test('a fresh install opens the remote folder on its own machine, apart from the same local path', async ({
  server,
}) => {
  const h = await renderFirstWorkspace(server)
  await mkdir(join(h.serverA.root, 'same'))
  await mkdir(join(h.serverB.root, 'same'))
  await mkdir(join(h.serverB.root, 'only-on-b'))
  await renderWithLoadedDialogs(<FirstWorkspace />, {
    application: h.application,
    connections: h.connections,
    queryClient: queryClientFor(h.originA),
  })

  // No recent folders: the choice opens on arrival, over the empty chat.
  await userEvent.click(await screen.findByRole('button', { name: /^Connect a remote machine/ }))
  await userEvent.click(await screen.findByRole('button', { name: /Remote fixture/ }))
  await screen.findByRole('option', { name: /only-on-b/ })
  await userEvent.click(screen.getByRole('button', { name: 'Go to folder' }))
  const path = screen.getByRole('textbox', { name: 'Folder path' })
  await userEvent.clear(path)
  await userEvent.type(path, join(h.serverB.root, 'same'))
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Folder path' })).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))

  await waitFor(() => expect(h.application.getSnapshot().origin).toBe(h.originB))
  await waitFor(() => expect(rootPath(h)).toBe('same'))
  await waitFor(() => expect(projectCount(h.descriptorB.environmentId)).toBe(1))
  expect(projectCount(h.descriptorA.environmentId)).toBe(0)
})

test('the chosen folder opens its chat while the machine has not yet sent the project event', async ({
  server,
}) => {
  const h = await renderFirstWorkspace(server)
  await mkdir(join(h.serverB.root, 'held'))
  const navigation = createTestNavigation({ application: h.application })
  onTestFinished(() => navigation.dispose())
  await renderWithLoadedDialogs(<FirstWorkspace />, {
    application: h.application,
    connections: h.connections,
    navigation,
    queryClient: queryClientFor(h.originA),
  })

  await userEvent.click(await screen.findByRole('button', { name: /^Connect a remote machine/ }))
  await userEvent.click(await screen.findByRole('button', { name: /Remote fixture/ }))
  await screen.findByRole('option', { name: /held/ })
  h.holdEvents(h.originB)
  onTestFinished(() => h.releaseEvents(h.originB))
  await userEvent.click(screen.getByRole('button', { name: 'Go to folder' }))
  const path = screen.getByRole('textbox', { name: 'Folder path' })
  await userEvent.clear(path)
  await userEvent.type(path, join(h.serverB.root, 'held'))
  await userEvent.keyboard('{Enter}')
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Folder path' })).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Open' }))

  await waitFor(() => expect(navigation.currentAddress().document).toMatch(/^t\/draft-/))
  expect(rootPath(h)).toBe('held')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(projectCount(h.descriptorB.environmentId)).toBe(1)
})

test('cancelling the remote folder step opens nothing and keeps the machine', async ({
  server,
}) => {
  const h = await renderFirstWorkspace(server)
  await renderWithLoadedDialogs(<FirstWorkspace />, {
    application: h.application,
    connections: h.connections,
    queryClient: queryClientFor(h.originA),
  })

  await userEvent.click(await screen.findByRole('button', { name: /^Connect a remote machine/ }))
  await userEvent.click(await screen.findByRole('button', { name: /Remote fixture/ }))
  await screen.findByRole('listbox', { name: 'Folders' })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  // Back on the machine list, the saved machine still connected.
  await screen.findByRole('button', { name: /Remote fixture/ })
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  await userEvent.keyboard('{Escape}')

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /^Connect a remote machine/ })).toBeNull(),
  )
  expect(screen.getByRole('button', { name: 'Remote machine' })).toBeTruthy()
  expect(rootPath(h)).toBeNull()
  expect(h.application.getSnapshot().origin).toBe(h.originA)
  expect(h.connections.store.getState().machines.find((m) => m.name === 'remote')?.phase).toBe(
    'live',
  )
  expect(projectCount(h.descriptorA.environmentId)).toBe(0)
  expect(projectCount(h.descriptorB.environmentId)).toBe(0)
})

test('a later empty workspace offers both actions without opening the choice', async ({
  server,
}) => {
  const h = await renderFirstWorkspace(server)
  await mkdir(join(h.serverA.root, 'earlier'))
  await h.clientA.fs.recents.post({ path: 'earlier' })
  await renderWithLoadedDialogs(<FirstWorkspace />, {
    application: h.application,
    connections: h.connections,
    queryClient: queryClientFor(h.originA),
  })

  await screen.findByRole('button', { name: 'Remote machine' })
  await screen.findByRole('button', { name: /^Folder on / })
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('dialog')).toBeNull()
})
