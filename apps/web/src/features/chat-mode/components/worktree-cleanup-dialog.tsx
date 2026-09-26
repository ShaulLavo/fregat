import { cleanupConfirmationText } from '@workspace/client-core/chat/worktrees/confirmation'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { HoldButton } from '@workspace/ui/components/hold-button'
import { Spinner } from '@workspace/ui/components/spinner'
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
  const { action, description } = cleanupConfirmationText(
    confirmation ?? { kind: 'release' },
    label,
  )
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
          <DialogDescription className='tabular-nums'>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <InlineError message={error} onHandOff={onCancel} title='Worktree cleanup' />
        ) : null}
        <DialogFooter>
          <Button disabled={pending} variant='outline' onClick={onCancel}>
            Cancel
          </Button>
          {/* Only a forced removal deletes files; releasing and resolving an absent checkout do not. */}
          {force ? (
            <HoldButton disabled={pending} onConfirm={onConfirm}>
              {pending ? <Spinner /> : null}
              {action}
            </HoldButton>
          ) : (
            <Button disabled={pending} onClick={onConfirm}>
              {pending ? <Spinner /> : null}
              {action}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
