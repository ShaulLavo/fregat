import type { OrchestrationWorktreeShell } from '@workspace/contracts'

export type WorktreeRemovalChoice = 'offer' | 'automatic' | 'shared' | 'kept'

/** What deleting a session can do with its worktree; only a session worktree can go. */
export function worktreeRemovalChoice(
  worktree: OrchestrationWorktreeShell | undefined,
  cleanupOnDelete: boolean,
): WorktreeRemovalChoice {
  if (!worktree || worktree.ownership !== 'platform') return 'kept'
  if (worktree.cleanupEligibility.nonDeletedSessionCount > 1) return 'shared'
  return cleanupOnDelete ? 'automatic' : 'offer'
}
