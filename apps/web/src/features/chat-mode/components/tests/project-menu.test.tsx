import { scopedProjectKey } from '@workspace/contracts'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'
import { holdToConfirm } from '../../../../../test/hold'

test('project menu scopes and collapses the repository group', async ({ client, server }) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  // The scope menu trigger carries the same path title once scoped; the group header is the
  // expanded one, since the group stays open until this test collapses it.
  const groupHeader = () =>
    screen
      .getAllByTitle(h.context.worktree!.path)
      .find((element) => element.getAttribute('aria-expanded') === 'true')!
  await userEvent.pointer({ keys: '[MouseRight]', target: groupHeader() })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Show Only This Project' }))
  expect(useSessionRailStore.getState().scope).toBe(
    `physical:${scopedProjectKey({ environmentId: h.environmentId, projectId: h.projectId })}`,
  )
  await userEvent.click(groupHeader())
  expect(useSessionRailStore.getState().collapsedProjectIds).toEqual([
    scopedProjectKey({ environmentId: h.environmentId, projectId: h.projectId }),
  ])
  expect(screen.getByTitle('First')).toBeVisible()
  expect(screen.queryByTitle('Second')).toBeNull()
})
test('new session opens the actual project checkout before selecting its draft', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByTitle(h.context.worktree!.path),
  })
  await userEvent.click(
    await screen.findByRole('menuitem', { name: 'New Session in This Project' }),
  )
  await waitFor(() =>
    expect(useSessionSelectionStore.getState().selection).toEqual({
      kind: 'draft',
      environmentId: h.environmentId,
      projectId: h.projectId,
      draftId: expect.stringMatching(/\S/),
    }),
  )
  expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
    h.context.worktree!.path,
  )
})
test('archive all reaches every settled session on the owning server', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByTitle(h.context.worktree!.path),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive All Sessions' }))
  await waitFor(async () =>
    expect((await h.refresh()).sessions.every((session) => session.archivedAt !== null)).toBe(true),
  )
})
test('project deletion retains its scoped confirmation and deletes after confirmation', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByTitle(h.context.worktree!.path),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete Project' }))
  expect((await h.refresh()).projects).toHaveLength(1)
  holdToConfirm(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(async () => expect((await h.refresh()).projects).toHaveLength(0))
})
