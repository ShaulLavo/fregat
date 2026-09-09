import type { OrchestrationProjectShell, OrchestrationWorktreeShell } from '@workspace/contracts'
import { worktreeLabel, worktreeLifecycleLabel } from '@workspace/client-core/chat/worktrees/label'

export function worktreeSummary(
  worktree: OrchestrationWorktreeShell,
  repositoryKind: OrchestrationProjectShell['repositoryKind'],
) {
  const parts = [worktreeLabel(worktree, repositoryKind)]
  if (worktree.lifecycle.state !== 'ready') parts.push(worktreeLifecycleLabel(worktree.lifecycle))
  if (worktree.ownership === 'protected') parts.push('Protected')
  if (worktree.ownership === 'external') parts.push('External')
  const shared = worktree.cleanupEligibility.nonDeletedSessionCount
  if (shared > 1) parts.push(`${shared} sessions`)
  if (
    worktree.lifecycle.state === 'cleanup-blocked' &&
    worktree.lifecycle.changedFileCount !== null
  )
    parts.push(`${worktree.lifecycle.changedFileCount} changed files`)
  return parts.join(' · ')
}
