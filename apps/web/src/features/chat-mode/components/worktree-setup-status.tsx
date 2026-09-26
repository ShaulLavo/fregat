import type { OrchestrationWorktreeShell } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'
import { worktreeSetupLabel } from '@workspace/client-core/chat/worktrees/label'

/** The project's setup script in this worktree: what it did, its last lines, and a rerun or stop. */
export function WorktreeSetupStatus({
  hasSetupScript,
  onRun,
  onStop,
  pending,
  worktree,
}: {
  readonly hasSetupScript: boolean
  readonly onRun: () => void
  readonly onStop: () => void
  readonly pending: boolean
  readonly worktree: OrchestrationWorktreeShell
}) {
  const setup = worktree.setup
  const stopping = setup?.state === 'cancelling'
  const running = setup?.state === 'queued' || setup?.state === 'running' || stopping
  const label = worktreeSetupLabel(setup)
  const failed = setup?.state === 'failed'
  if (!setup && !hasSetupScript) return null
  if (worktree.lifecycle.state !== 'ready' && !failed) return null

  return (
    <div className='flex flex-col gap-1' data-worktree-setup={setup?.state ?? 'none'}>
      {label ? (
        <p
          className={cn(
            'flex items-center gap-1.5 text-xs',
            failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {running ? <Spinner size='xs' /> : null}
          {label}
        </p>
      ) : null}
      {setup && setup.state !== 'done' && setup.output.length > 0 ? (
        <pre className='bg-muted text-muted-foreground text-2xs max-h-24 overflow-auto overscroll-contain rounded-md px-2 py-1 font-mono whitespace-pre-wrap'>
          {setup.output.slice(-6).join('\n')}
        </pre>
      ) : null}
      <div className='flex gap-1'>
        {running ? (
          <Button size='sm' variant='outline' disabled={pending || stopping} onClick={onStop}>
            Stop setup
          </Button>
        ) : null}
        {!running && hasSetupScript && worktree.lifecycle.state === 'ready' ? (
          <Button size='sm' variant='outline' disabled={pending} onClick={onRun}>
            Run setup
          </Button>
        ) : null}
      </div>
    </div>
  )
}
