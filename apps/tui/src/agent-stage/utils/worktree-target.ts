import * as v from 'valibot'
import {
  worktreeIdSchema,
  type OrchestrationWorktreeShell,
  type SessionWorktreeTarget,
  type WorktreeId,
} from '@workspace/contracts'

export function draftWorktreeTarget(
  worktreeId: WorktreeId,
  mode: SessionWorktreeTarget['kind'],
): SessionWorktreeTarget {
  if (mode === 'current') return { kind: 'current', worktreeId }
  return {
    kind: 'new',
    worktreeId: v.parse(worktreeIdSchema, crypto.randomUUID()),
    baseWorktreeId: worktreeId,
  }
}

export function draftWorktreeReason(
  worktree: OrchestrationWorktreeShell | undefined,
  mode: SessionWorktreeTarget['kind'],
) {
  if (!worktree) return 'Select a worktree before sending.'
  if (worktree.lifecycle.state !== 'ready') return 'This checkout is not ready for a new turn.'
  if (mode === 'current' || worktree.worktreeCreationCapability.allowed) return null
  if (worktree.worktreeCreationCapability.reason === 'not-git')
    return 'New worktrees require a Git repository.'
  return 'This checkout is not available as the base for a new worktree.'
}
