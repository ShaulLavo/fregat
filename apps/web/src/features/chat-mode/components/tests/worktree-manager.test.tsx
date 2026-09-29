import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRailHarness, renderRailHarness } from '../../../../../test/factories/rail-harness'
import { expect, test } from '../../../../../test/fixtures'

test('the worktree manager stays reachable when the project has no sessions', async ({
  client,
  server,
}) => {
  const harness = await createRailHarness(client, server, [])
  renderRailHarness(harness)
  await userEvent.click(screen.getByRole('button', { name: 'Manage worktrees' }))
  expect(await screen.findByRole('dialog', { name: 'Worktrees' })).toBeInTheDocument()
  expect(screen.getByText('Workspace')).toBeInTheDocument()
  expect(screen.getByText('The main checkout is protected from removal.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Worktrees' })).not.toBeInTheDocument(),
  )
})
