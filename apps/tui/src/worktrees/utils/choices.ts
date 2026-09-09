import type {
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  WorktreeId,
} from '@workspace/contracts'
import { worktreeLabel, worktreeLifecycleLabel } from '@workspace/client-core/chat/worktrees/label'
import {
  canForceCleanupWorktree,
  canReleaseWorktree,
  canRetainWorktree,
  canRetryWorktree,
} from '@workspace/client-core/chat/worktrees/cleanup'

export type WorktreeAction =
  | 'cleanup'
  | 'force'
  | 'missing'
  | 'release'
  | 'retry'
  | 'retain'
  | 'adopt'

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

export function worktreeActions(worktree: OrchestrationWorktreeShell, current: boolean) {
  const actions: { name: string; description: string; value: WorktreeAction }[] = []
  const add = (value: WorktreeAction, name: string, description: string) =>
    actions.push({ name, description, value })
  const eligible = worktree.cleanupEligibility.reason === 'eligible'
  if (!current && eligible && worktree.lifecycle.state === 'ready')
    add('cleanup', 'Clean up…', 'Check running processes and changes before removing the checkout')
  if (canRetryWorktree(worktree) && (!current || worktree.lifecycle.state === 'creation-failed'))
    add('retry', 'Retry', 'Retry the failed worktree operation')
  if (canRetainWorktree(worktree))
    add('retain', 'Retain checkout', 'Keep files and restore this checkout to ready')
  if (!current && canForceCleanupWorktree(worktree))
    add(
      'force',
      'Discard changes…',
      'Preview tracked, untracked, and ignored changes before removal',
    )
  if (worktree.ownership === 'unclaimed')
    add('adopt', 'Adopt checkout', 'Give Platform ownership of this checkout')
  if (canReleaseWorktree(worktree))
    add('release', 'Release…', 'Keep files and transfer cleanup responsibility outside Platform')
  if (!current && worktree.cleanupEligibility.canResolveMissing)
    add('missing', 'Resolve missing checkout…', 'Confirm that no checkout files remain')
  return actions
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
