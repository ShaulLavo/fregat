import type { OrchestrationProjectShell, OrchestrationWorktreeShell } from '@workspace/contracts'
import { GitBranchIcon } from '@phosphor-icons/react'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import { worktreeLabel, worktreeLifecycleLabel } from '@workspace/client-core/chat/worktrees/label'

export function WorktreeChip({
  worktree,
  repositoryKind,
}: {
  readonly worktree: OrchestrationWorktreeShell
  readonly repositoryKind: OrchestrationProjectShell['repositoryKind']
}) {
  const state = worktree.lifecycle.state
  const label = worktreeLabel(worktree, repositoryKind)
  const lifecycle = worktreeLifecycleLabel(worktree.lifecycle)
  const shared = worktree.cleanupEligibility.nonDeletedSessionCount
  const pending = state === 'provisioning' || state === 'cleanup-requested'
  const failed = state === 'creation-failed' || state === 'cleanup-failed' || state === 'missing'
  return (
    <span
      data-worktree-id={worktree.id}
      title={`${label} · ${lifecycle}`}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 overflow-hidden rounded-md border border-border px-1.5 py-0.5 text-2xs leading-4 whitespace-nowrap',
        pending && 'text-info',
        failed && 'text-destructive',
        state === 'cleanup-blocked' && 'text-warning',
      )}
    >
      {pending ? <OrbitLoader label={lifecycle} /> : <GitBranchIcon className='size-3 shrink-0' />}
      <span className='truncate'>{label}</span>
      {state !== 'ready' ? <span className='truncate'>{lifecycle}</span> : null}
      {worktree.ownership === 'protected' ? (
        <span className='sr-only'>Protected checkout</span>
      ) : null}
      {worktree.ownership === 'external' ? <span className='truncate'>External</span> : null}
      {shared > 1 ? <span className='truncate tabular-nums'>{shared} sessions</span> : null}
      {worktree.lifecycle.state === 'cleanup-blocked' &&
      worktree.lifecycle.changedFileCount !== null ? (
        <span className='truncate tabular-nums'>
          {worktree.lifecycle.changedFileCount} changed files
        </span>
      ) : null}
    </span>
  )
}
