import type { OrchestrationWorktreeShell } from '@workspace/contracts'
import {
  canForceCleanupWorktree,
  canReleaseWorktree,
  canRetainWorktree,
  canRetryWorktree,
} from './cleanup'
import type { WorktreeAction as WorktreeCommandType } from './commands'

export type WorktreeAction =
  | 'cleanup'
  | 'force'
  | 'missing'
  | 'release'
  | 'retry'
  | 'retain'
  | 'adopt'

type ActionText = { readonly name: string; readonly description: string }
export type WorktreeActionChoice = ActionText &
  (
    | {
        readonly kind: 'run'
        readonly value: 'cleanup' | 'retry' | 'retain' | 'adopt'
        readonly command: WorktreeCommandType
      }
    | { readonly kind: 'confirm'; readonly value: 'force' | 'release' | 'missing' }
  )

export function worktreeActions(
  worktree: OrchestrationWorktreeShell,
  current: boolean,
): readonly WorktreeActionChoice[] {
  const actions: WorktreeActionChoice[] = []
  const eligible = worktree.cleanupEligibility.reason === 'eligible'
  if (!current && eligible && worktree.lifecycle.state === 'ready')
    actions.push({
      kind: 'run',
      value: 'cleanup',
      command: 'worktree.cleanup',
      name: 'Clean up…',
      description: 'Remove the worktree folder if nothing runs in it and it has no changes',
    })
  if (canRetryWorktree(worktree) && (!current || worktree.lifecycle.state === 'creation-failed'))
    actions.push({
      kind: 'run',
      value: 'retry',
      command:
        worktree.lifecycle.state === 'creation-failed' ? 'worktree.retry' : 'worktree.cleanup',
      name: 'Retry',
      description: 'Try the failed worktree step again',
    })
  if (canRetainWorktree(worktree))
    actions.push({
      kind: 'run',
      value: 'retain',
      command: 'worktree.retain',
      name: 'Keep worktree',
      description: 'Stop removing it and keep using its files',
    })
  if (!current && canForceCleanupWorktree(worktree))
    actions.push({
      kind: 'confirm',
      value: 'force',
      name: 'Delete changes and remove…',
      description: 'See which changed files would be deleted, then remove the worktree',
    })
  if (worktree.ownership === 'unclaimed')
    actions.push({
      kind: 'run',
      value: 'adopt',
      command: 'worktree.adopt',
      name: 'Manage in Fregat',
      description: 'Let Fregat manage this worktree and remove it later',
    })
  if (canReleaseWorktree(worktree))
    actions.push({
      kind: 'confirm',
      value: 'release',
      name: 'Stop managing…',
      description: 'Keep the worktree on disk and stop Fregat from managing it',
    })
  if (!current && worktree.cleanupEligibility.canResolveMissing)
    actions.push({
      kind: 'confirm',
      value: 'missing',
      name: 'Forget missing worktree…',
      description: 'The folder is gone. Stop tracking it',
    })
  return actions
}
