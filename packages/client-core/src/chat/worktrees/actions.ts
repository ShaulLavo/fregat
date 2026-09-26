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
      description: 'Check running processes and changes before removing the checkout',
    })
  if (canRetryWorktree(worktree) && (!current || worktree.lifecycle.state === 'creation-failed'))
    actions.push({
      kind: 'run',
      value: 'retry',
      command:
        worktree.lifecycle.state === 'creation-failed' ? 'worktree.retry' : 'worktree.cleanup',
      name: 'Retry',
      description: 'Retry the failed worktree operation',
    })
  if (canRetainWorktree(worktree))
    actions.push({
      kind: 'run',
      value: 'retain',
      command: 'worktree.retain',
      name: 'Retain checkout',
      description: 'Keep files and restore this checkout to ready',
    })
  if (!current && canForceCleanupWorktree(worktree))
    actions.push({
      kind: 'confirm',
      value: 'force',
      name: 'Discard changes…',
      description: 'Preview tracked, untracked, and ignored changes before removal',
    })
  if (worktree.ownership === 'unclaimed')
    actions.push({
      kind: 'run',
      value: 'adopt',
      command: 'worktree.adopt',
      name: 'Adopt checkout',
      description: 'Give Platform ownership of this checkout',
    })
  if (canReleaseWorktree(worktree))
    actions.push({
      kind: 'confirm',
      value: 'release',
      name: 'Release…',
      description: 'Keep files and transfer cleanup responsibility outside Platform',
    })
  if (!current && worktree.cleanupEligibility.canResolveMissing)
    actions.push({
      kind: 'confirm',
      value: 'missing',
      name: 'Resolve missing checkout…',
      description: 'Confirm that no checkout files remain',
    })
  return actions
}
