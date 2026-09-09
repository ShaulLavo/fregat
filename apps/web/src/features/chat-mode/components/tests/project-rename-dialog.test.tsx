import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createProjectDeleteCommand } from '@workspace/client-core/chat/commands'
import { useProjectRenameRequestStore } from '@/features/chat-mode/state/project-rename-request-store'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'

test('accepted project rename updates the server and closes its dialog', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByTitle(h.context.worktree!.path),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename Project' }))
  const input = screen.getByRole('textbox', { name: 'Project name' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Updated project{Enter}')
  await waitFor(() => expect(useProjectRenameRequestStore.getState().request).toBeNull())
  expect((await h.refresh()).projects[0]?.title).toBe('Updated project')
})
test('a project removed while the dialog is open leaves a refused rename reviewable', async ({
  client,
  server,
}) => {
  const h = await createRailHarness(client, server)
  renderRailHarness(h)
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByTitle(h.context.worktree!.path),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename Project' }))
  await h.dispatch(createProjectDeleteCommand({ projectId: h.projectId }))
  const input = screen.getByRole('textbox', { name: 'Project name' })
  await userEvent.clear(input)
  await userEvent.type(input, 'Cannot rename{Enter}')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled())
  expect(useProjectRenameRequestStore.getState().request?.ref).toEqual({
    environmentId: h.environmentId,
    projectId: h.projectId,
  })
})
