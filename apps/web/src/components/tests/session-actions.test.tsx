import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { createRailHarness, renderSessionHeaders } from '../../../test/factories/rail-harness'
import { expect, test } from '../../../test/fixtures'

function header(name: 'Stage header' | 'Sidebar header') {
  return screen.getByRole('region', { name })
}

async function openActions(name: 'Stage header' | 'Sidebar header') {
  await userEvent.click(within(header(name)).getByRole('button', { name: 'Session actions' }))
  return screen.findAllByRole('menuitem')
}

async function menuLabels(name: 'Stage header' | 'Sidebar header') {
  const items = await openActions(name)
  const labels = items.map((item) => item.textContent?.trim())
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0))
  return labels
}

test('both chat headers offer the same actions for the same session', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderSessionHeaders(h)

  const stage = await menuLabels('Stage header')
  const sidebar = await menuLabels('Sidebar header')

  expect(sidebar).toEqual(stage)
  expect(sidebar).toEqual(expect.arrayContaining(['Rename', 'Archive', 'Delete']))
  expect(sidebar).not.toContain('Open')
  expect(sidebar).not.toContain('Show Only This Project')
})

test('renaming from the sidebar header swaps only that header for a field', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderSessionHeaders(h)

  await openActions('Sidebar header')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))

  expect(within(header('Sidebar header')).getByRole('textbox')).toBeInTheDocument()
  expect(within(header('Stage header')).queryByRole('textbox')).toBeNull()

  const input = within(header('Sidebar header')).getByRole('textbox')
  await userEvent.clear(input)
  await userEvent.type(input, 'Renamed from sidebar{Enter}')
  await waitFor(async () =>
    expect(
      (await h.refresh()).sessions.find((session) => session.id === h.sessionIds[0])?.title,
    ).toBe('Renamed from sidebar'),
  )
})

test('delete from the sidebar header confirms through the shared dialog and cancels cleanly', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderSessionHeaders(h)

  await openActions('Sidebar header')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((await h.refresh()).sessions).toHaveLength(2)
})

test('Manage worktrees from the sidebar delete opens the session project', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderSessionHeaders(h)

  await openActions('Sidebar header')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Manage worktrees' }))

  expect(useWorktreeManagerStore.getState().project).toMatchObject({
    environmentId: h.environmentId,
    projectId: h.projectId,
  })
  expect(await screen.findByRole('list', { name: 'Project worktrees' })).toBeInTheDocument()
  expect((await h.refresh()).sessions).toHaveLength(2)
})
