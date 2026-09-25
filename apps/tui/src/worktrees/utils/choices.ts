import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  WorktreeId,
} from '@workspace/contracts'
import { worktreeLabel, worktreeLifecycleLabel } from '@workspace/client-core/chat/worktrees/label'

export function worktreeChoices({
  worktrees,
  project,
  value,
  query,
}: {
  readonly worktrees: readonly OrchestrationWorktreeShell[]
  readonly project: OrchestrationProjectShell
  readonly value: WorktreeId | null
  readonly query: string
}) {
  const search = query.trim().toLowerCase()
  return worktrees
    .filter((worktree) => worktree.projectId === project.id)
    .filter((worktree) =>
      `${worktreeLabel(worktree, project.repositoryKind)} ${worktree.canonicalPath}`
        .toLowerCase()
        .includes(search),
    )
    .map((worktree) => ({
      name: `${worktree.id === value ? '● ' : ''}${worktreeLabel(worktree, project.repositoryKind)} · ${worktreeLifecycleLabel(worktree.lifecycle)}`,
      description: `${worktree.ownership} · ${worktree.cleanupEligibility.nonDeletedSessionCount} sessions · ${worktree.canonicalPath}`,
      value: worktree,
    }))
}

export function selectableWorktree(worktree: OrchestrationWorktreeShell) {
  return worktree.lifecycle.state === 'ready' && worktree.ownership !== 'unclaimed'
}

export function openableWorktree(worktree: OrchestrationWorktreeShell) {
  const state = worktree.lifecycle.state
  return (
    state === 'ready' ||
    state === 'orphaned' ||
    state === 'retired' ||
    state === 'cleanup-blocked' ||
    state === 'cleanup-failed'
  )
}

export function worktreeFailure(worktree: OrchestrationWorktreeShell) {
  if ('errorCode' in worktree.lifecycle) return worktree.lifecycle.errorCode
  return null
}
