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
import { cleanupStatusLabel } from '@workspace/client-core/chat/worktrees/cleanup'
import { worktreeActions } from '@workspace/client-core/chat/worktrees/actions'
import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'
import { InlineError } from '@/components/inline-error'
import { WorktreeSetupStatus } from '@/features/chat-mode/components/worktree-setup-status'

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
  const choices = worktreeActions(worktree, false)
  return (
    <li className='flex flex-col gap-2 py-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <WorktreeChip worktree={worktree} repositoryKind={project.repositoryKind} />
        {actions.pending ? <Spinner /> : null}
      </div>
      <p className='text-muted-foreground text-xs tabular-nums'>{cleanupStatusLabel(worktree)}</p>
      <WorktreeSetupStatus
        worktree={worktree}
        hasSetupScript={project.scripts.some((script) => script.runOnWorktreeCreate)}
        pending={actions.pending}
        onRun={() => void actions.run('worktree.setup.run')}
        onStop={() => void actions.run('worktree.setup.cancel')}
      />
      {actions.error ? <InlineError message={actions.error} title='Worktree action' /> : null}
      <div className='flex flex-wrap gap-1'>
        {choices.map((choice) => (
          <Button
            key={choice.value}
            size='sm'
            variant={choice.value === 'release' ? 'ghost' : 'outline'}
            disabled={actions.pending}
            onClick={() => {
              if (choice.kind === 'run') return void actions.run(choice.command)
              if (choice.value === 'release') return actions.requestRelease()
              return void actions.preview(choice.value)
            }}
          >
            {choice.value === 'cleanup' ? 'Clean up' : choice.name}
          </Button>
        ))}
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
