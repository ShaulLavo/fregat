import { Spinner } from '@workspace/ui/components/spinner'
import { Button } from '@workspace/ui/components/button'
import { HoldButton } from '@workspace/ui/components/hold-button'
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
          <DialogTitle>Rewind to before this message?</DialogTitle>
          <DialogDescription>
            This message and everything after it leave the chat, and the message goes back into the
            message box so you can edit it. This cannot be undone.
            {canRestoreFiles
              ? ' You can also put the files in this worktree back to how they were before it.'
              : ' Your files stay as they are now.'}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <InlineError message={error} onHandOff={onCancel} title='Could not rewind' />
        ) : null}
        <DialogFooter>
          <Button type='button' variant='outline' disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
          {canRestoreFiles ? (
            <HoldButton disabled={disabled} onConfirm={() => onConfirm(true)}>
              Rewind chat and files
            </HoldButton>
          ) : null}
          <HoldButton disabled={disabled} onConfirm={() => onConfirm(false)} variant='default'>
            {pending ? <Spinner aria-hidden /> : null}
            Rewind chat only
          </HoldButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
