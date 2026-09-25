import { Spinner } from '@workspace/ui/components/spinner'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { InlineError } from '@/components/inline-error'

export function CheckpointRevertDialog({
  turnCount,
  disabled,
  pending = false,
  onCancel,
  onConfirm,
  canRestoreFiles = false,
  error = null,
}: {
  readonly turnCount: number | null
  readonly disabled: boolean
  readonly pending?: boolean
  readonly onCancel: () => void
  readonly onConfirm: (restoreFiles: boolean) => void
  readonly canRestoreFiles?: boolean
  readonly error?: string | null
}) {
  return (
    <Dialog open={turnCount !== null} onOpenChange={(open) => open || disabled || onCancel()}>
      <DialogContent role='alertdialog' showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className='tabular-nums'>
            Revert this session to checkpoint {turnCount}?
          </DialogTitle>
          <DialogDescription>
            Newer messages will be removed and the original prompt restored to the composer. Keep
            your current files, or restore files in an isolated worktree. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <InlineError message={error} onHandOff={onCancel} title='Checkpoint revert' />
        ) : null}
        <DialogFooter>
          <Button type='button' variant='outline' disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
          {canRestoreFiles ? (
            <Button
              type='button'
              variant='destructive'
              disabled={disabled}
              onClick={() => onConfirm(true)}
            >
              Rewind and restore files
            </Button>
          ) : null}
          <Button type='button' disabled={disabled} onClick={() => onConfirm(false)}>
            {pending ? <Spinner aria-hidden /> : null}
            Rewind conversation only
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
