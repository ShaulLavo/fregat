import { render, screen } from '@testing-library/react'
import { WorktreeSetupStatus } from '@/features/chat-mode/components/worktree-setup-status'
import { chatWorktree } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'

test('a stopping setup offers no rerun the server would refuse', () => {
  const worktree = chatWorktree({
    setup: {
      name: 'Install',
      state: 'cancelling',
      foreground: false,
      exitCode: null,
      output: [],
      updatedAt: '2026-09-25T00:00:00.000Z',
    },
  })
  render(
    <WorktreeSetupStatus
      hasSetupScript
      onRun={() => {}}
      onStop={() => {}}
      pending={false}
      worktree={worktree}
    />,
  )
  expect(screen.queryByRole('button', { name: 'Run setup' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Stop setup' })).toHaveProperty('disabled', true)
})
