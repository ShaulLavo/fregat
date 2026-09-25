import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import type { WorktreeConfirmation } from '@workspace/client-core/chat/worktrees/commands'
import { InlineError } from '@/components/inline-error'

export function WorktreeCleanupDialog({
  confirmation,
  label,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly confirmation: WorktreeConfirmation | null
  readonly label: string
  readonly pending: boolean
  readonly error: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const force = confirmation?.kind === 'force'
  const missing = confirmation?.kind === 'missing'
  let action = 'Release worktree'
  let description = `Keep ${label} and its branch on disk. Platform will give up cleanup ownership. Any later cleanup must be done manually.`
  if (force) {
    action = 'Discard changes and remove'
    description = `Remove ${label} and permanently discard its tracked, untracked, and ignored files. The branch and commits will be retained.`
  }
  if (missing) {
    action = 'Confirm checkout is absent'
    description = `Resolve the absent checkout ${label}. No files will be deleted. Its branch and commits may still exist.`
  }
  return (
    <Dialog
      open={confirmation !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
    >
      <DialogContent className='max-w-md' showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{action}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {confirmation?.kind === 'force' ? (
          <p className='text-muted-foreground text-sm tabular-nums'>
            {confirmation.preview.changedFileCount} changed files. Any further edit requires a new
            confirmation.
          </p>
        ) : null}
        {error ? (
          <InlineError message={error} onHandOff={onCancel} title='Worktree cleanup' />
        ) : null}
        <DialogFooter>
          <Button disabled={pending} variant='outline' onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            variant={force ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {pending ? <OrbitLoader /> : null}
            {action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
