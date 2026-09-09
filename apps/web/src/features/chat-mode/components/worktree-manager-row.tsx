import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
} from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { WorktreeChip } from '@/features/chat-mode/components/worktree-chip'
import { WorktreeCleanupDialog } from '@/features/chat-mode/components/worktree-cleanup-dialog'
import { useWorktreeActions } from '@/features/chat-mode/hooks/use-worktree-actions'
import {
  canForceCleanupWorktree,
  canReleaseWorktree,
  canRetainWorktree,
  canRetryWorktree,
  cleanupStatusLabel,
} from '@workspace/client-core/chat/worktrees/cleanup'
import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'

export function WorktreeManagerRow({
  environmentId,
  project,
  worktree,
}: {
  readonly environmentId: EnvironmentId
  readonly project: OrchestrationProjectShell
  readonly worktree: OrchestrationWorktreeShell
}) {
  const actions = useWorktreeActions({ environmentId, worktreeId: worktree.id })
  const eligibility = worktree.cleanupEligibility
  const eligible = eligibility.reason === 'eligible'
  return (
    <li className='border-border flex flex-col gap-2 border-b py-3 last:border-0'>
      <div className='flex min-w-0 items-center gap-2'>
        <WorktreeChip worktree={worktree} repositoryKind={project.repositoryKind} />
        {actions.pending ? <Spinner /> : null}
      </div>
      <p className='text-muted-foreground text-xs tabular-nums'>{cleanupStatusLabel(worktree)}</p>
      {actions.error ? (
        <p className='text-destructive text-xs' role='alert'>
          {actions.error}
        </p>
      ) : null}
      <div className='flex flex-wrap gap-1'>
        {eligible && worktree.lifecycle.state === 'ready' ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() => void actions.run('worktree.cleanup')}
          >
            Clean up
          </Button>
        ) : null}
        {canRetryWorktree(worktree) ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() =>
              void actions.run(
                worktree.lifecycle.state === 'creation-failed'
                  ? 'worktree.retry'
                  : 'worktree.cleanup',
              )
            }
          >
            Retry
          </Button>
        ) : null}
        {canRetainWorktree(worktree) ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() => void actions.run('worktree.retain')}
          >
            Retain checkout
          </Button>
        ) : null}
        {canForceCleanupWorktree(worktree) ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() => void actions.preview('force')}
          >
            Discard changes…
          </Button>
        ) : null}
        {worktree.ownership === 'unclaimed' ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() => void actions.run('worktree.adopt')}
          >
            Adopt checkout
          </Button>
        ) : null}
        {canReleaseWorktree(worktree) ? (
          <Button
            size='sm'
            variant='ghost'
            disabled={actions.pending}
            onClick={actions.requestRelease}
          >
            Release…
          </Button>
        ) : null}
        {eligibility.canResolveMissing ? (
          <Button
            size='sm'
            variant='outline'
            disabled={actions.pending}
            onClick={() => void actions.preview('missing')}
          >
            Resolve missing checkout…
          </Button>
        ) : null}
      </div>
      <WorktreeCleanupDialog
        confirmation={actions.confirmation}
        label={worktreeLabel(worktree, project.repositoryKind)}
        pending={actions.pending}
        error={actions.error}
        onCancel={actions.dismissConfirmation}
        onConfirm={() => void actions.confirm()}
      />
    </li>
  )
}
