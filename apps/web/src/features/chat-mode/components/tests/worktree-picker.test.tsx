import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreePicker } from '@/features/chat/components/worktree-picker'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import { chatWorktree, sessionShell, TEST_WORKTREE_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('both visible creation choices create ID-only bootstrap targets', async () => {
  const target = { kind: 'current' as const, worktreeId: TEST_WORKTREE_ID }
  const view = renderWithProviders(
    <WorktreePicker base={chatWorktree()} target={target} onCurrent={() => {}} onNew={() => {}} />,
  )
  expect(screen.getByRole('button', { name: 'Send to current branch' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'Send to current branch' })).toHaveFocus()
  const newTarget = newWorktreeTarget(TEST_WORKTREE_ID)
  view.rerender(
    <WorktreePicker
      base={chatWorktree()}
      target={newTarget}
      onCurrent={() => {}}
      onNew={() => {}}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New worktree' }))
  expect(screen.getByRole('button', { name: 'New worktree' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  for (const worktreeTarget of [target, newTarget]) {
    const submission = createDraftSessionSubmission({
      createdAt: '2026-09-06T10:00:00Z',
      modelSelection: sessionShell().modelSelection,
      text: 'Hello',
      worktreeTarget,
    })
    expect(submission.command.bootstrap?.createSession?.worktreeTarget).toEqual(worktreeTarget)
    expect(submission.command.bootstrap?.createSession).not.toHaveProperty('worktreePath')
    expect(submission.command.bootstrap?.createSession).not.toHaveProperty('branch')
  }
})

test('non-Git bases permit current and explain unavailable new worktrees', () => {
  renderWithProviders(
    <WorktreePicker
      base={chatWorktree({ worktreeCreationCapability: { allowed: false, reason: 'not-git' } })}
      target={{ kind: 'current', worktreeId: TEST_WORKTREE_ID }}
      onCurrent={() => {}}
      onNew={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: 'Send to current branch' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'New worktree' })).toBeDisabled()
  expect(screen.getByText('New worktrees require a Git repository.')).toBeInTheDocument()
})

test('missing bases disable both choices', () => {
  renderWithProviders(
    <WorktreePicker
      base={chatWorktree({
        lifecycle: { state: 'missing' },
        worktreeCreationCapability: { allowed: false, reason: 'base-not-ready' },
      })}
      target={{ kind: 'current', worktreeId: TEST_WORKTREE_ID }}
      onCurrent={() => {}}
      onNew={() => {}}
    />,
  )
  expect(screen.getByRole('button', { name: 'Send to current branch' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'New worktree' })).toBeDisabled()
})
