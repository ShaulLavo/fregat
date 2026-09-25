import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionWorktreeTarget, WorktreeId } from '@workspace/contracts'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import { vi } from 'vitest'

import { DraftWorkspaceMenu } from '@/features/chat/components/draft-workspace-menu'
import { newWorktreeTarget } from '@/features/chat/utils/worktree-target'
import { chatWorktree, sessionShell, TEST_WORKTREE_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

const current: SessionWorktreeTarget = { kind: 'current', worktreeId: TEST_WORKTREE_ID }
const linkedId = '6c1f0c64-5d8e-4c38-9b0f-2f1a3f5a9d11' as WorktreeId

function renderMenu(overrides: Partial<Parameters<typeof DraftWorkspaceMenu>[0]> = {}) {
  const props = {
    base: chatWorktree({ branch: 'main' }),
    currentCheckout: null,
    worktrees: [],
    target: current,
    pending: false,
    onNew: vi.fn(),
    onWorktree: vi.fn(),
    ...overrides,
  }
  const view = renderWithProviders(<DraftWorkspaceMenu {...props} />)
  return { ...view, props }
}

test('the trigger names the workspace, and New worktree asks for an ID-only target', async () => {
  const { props, rerender } = renderMenu()
  expect(screen.getByRole('button', { name: 'Workspace' })).toHaveTextContent('Current checkout')

  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))
  expect(await screen.findByRole('menuitemradio', { name: 'Current checkout' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'New worktree' }))
  expect(props.onNew).toHaveBeenCalledOnce()

  const next = { ...newWorktreeTarget(TEST_WORKTREE_ID), baseBranch: 'release' }
  rerender(<DraftWorkspaceMenu {...props} target={next} />)
  expect(screen.getByRole('button', { name: 'Workspace' })).toHaveTextContent('New worktree')
  for (const worktreeTarget of [current, next]) {
    const submission = createDraftSessionSubmission({
      createdAt: '2026-09-06T10:00:00Z',
      modelSelection: sessionShell().modelSelection,
      text: 'Hello',
      worktreeTarget,
    })
    expect(submission.command.bootstrap?.createSession?.worktreeTarget).toEqual(worktreeTarget)
    expect(submission.command.bootstrap?.createSession).not.toHaveProperty('worktreePath')
  }
})

test('a base that cannot branch explains why New worktree is unavailable', async () => {
  renderMenu({
    base: chatWorktree({ worktreeCreationCapability: { allowed: false, reason: 'not-git' } }),
  })
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))

  expect(await screen.findByRole('menuitemradio', { name: 'New worktree' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  expect(screen.getByText('New worktrees require a Git repository.')).toBeVisible()
})

test('existing worktrees are offered by branch, with their session counts', async () => {
  const linked = chatWorktree({
    id: linkedId,
    kind: 'linked',
    branch: 'feature/strip',
    path: '/repo/platform/.git/platform-worktrees/a',
    cleanupEligibility: {
      reason: 'protected',
      nonDeletedSessionCount: 3,
      canResolveMissing: false,
    },
  })
  const { props } = renderMenu({ worktrees: [linked] })
  await userEvent.click(screen.getByRole('button', { name: 'Workspace' }))

  const row = await screen.findByRole('menuitemradio', { name: /feature\/strip/ })
  expect(row).toHaveTextContent('3')
  expect(row).toHaveAttribute('title', linked.path)
  await userEvent.click(row)
  expect(props.onWorktree).toHaveBeenCalledWith(linked)
})
