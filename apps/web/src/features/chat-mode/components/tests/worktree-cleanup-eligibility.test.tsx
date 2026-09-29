import { screen } from '@testing-library/react'
import { commandIdSchema, type WorktreeLifecycle } from '@workspace/contracts'
import * as v from 'valibot'
import { WorktreeManagerRow } from '@/features/chat-mode/components/worktree-manager-row'
import {
  cleanupEligibilityLabel,
  canReleaseWorktree,
} from '@workspace/client-core/chat/worktrees/cleanup'
import { chatProject, chatWorktree, TEST_ENVIRONMENT_ID } from '../../../../../test/factories/chat'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('unknown terminal and external-driver ownership explain stopping management and removing it yourself', () => {
  for (const reason of ['terminal-ownership-unknown', 'external-driver-unverified'] as const) {
    const eligibility = { reason, nonDeletedSessionCount: 0, canResolveMissing: false }
    expect(cleanupEligibilityLabel(eligibility)).toContain('remove it yourself')
    expect(
      canReleaseWorktree(chatWorktree({ ownership: 'platform', cleanupEligibility: eligibility })),
    ).toBe(true)
  }
})

test('archived references still prevent release and cleanup', () => {
  const eligibility = {
    reason: 'referenced' as const,
    nonDeletedSessionCount: 2,
    canResolveMissing: false,
  }
  expect(cleanupEligibilityLabel(eligibility)).toContain('2 sessions')
  expect(
    canReleaseWorktree(chatWorktree({ ownership: 'platform', cleanupEligibility: eligibility })),
  ).toBe(false)
})

test('a live cleanup blocker stays visible even when the projection allows a safe retry', () => {
  for (const reason of ['active-runtime', 'active-terminal'] as const) {
    const worktree = chatWorktree({
      ownership: 'platform',
      lifecycle: {
        state: 'cleanup-blocked',
        operationId: v.parse(commandIdSchema, 'runtime-cleanup'),
        reason,
        changedFileCount: null,
      },
      cleanupEligibility: {
        reason: 'eligible',
        nonDeletedSessionCount: 0,
        canResolveMissing: false,
      },
    })
    const view = renderWithProviders(
      <WorktreeManagerRow
        environmentId={TEST_ENVIRONMENT_ID}
        project={chatProject()}
        worktree={worktree}
      />,
    )
    expect(screen.getByText(/last removal found a running/)).toHaveTextContent(
      'Check again before removing files.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Delete changes and remove…' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/No sessions or running processes/)).not.toBeInTheDocument()
    view.unmount()
  }
})
test('released failed or blocked checkouts offer no Platform retry or retain actions', () => {
  const operationId = v.parse(commandIdSchema, 'released-operation')
  const lifecycles: readonly WorktreeLifecycle[] = [
    { state: 'creation-failed', operationId, errorCode: 'GIT_FAILED' },
    { state: 'cleanup-failed', operationId, errorCode: 'GIT_FAILED' },
    { state: 'cleanup-blocked', operationId, reason: 'dirty', changedFileCount: 1 },
  ]
  for (const lifecycle of lifecycles) {
    const worktree = chatWorktree({
      ownership: 'external',
      lifecycle,
      cleanupEligibility: {
        reason: 'external',
        nonDeletedSessionCount: 0,
        canResolveMissing: false,
      },
    })
    const view = renderWithProviders(
      <WorktreeManagerRow
        environmentId={TEST_ENVIRONMENT_ID}
        project={chatProject()}
        worktree={worktree}
      />,
    )
    expect(screen.getByText('This worktree is managed outside Platform.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep worktree' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop managing…' })).not.toBeInTheDocument()
    view.unmount()
  }
})
