import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

export function CheckpointRevertDialog({
  turnCount,
  disabled,
  onCancel,
  onConfirm,
}: {
  readonly turnCount: number | null
  readonly disabled: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <Dialog open={turnCount !== null} onOpenChange={(open) => open || onCancel()}>
      <DialogContent role='alertdialog' showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className='tabular-nums'>
            Revert this session to checkpoint {turnCount}?
          </DialogTitle>
          <DialogDescription>
            This will discard newer messages and turn diffs in this session. This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onCancel}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' disabled={disabled} onClick={onConfirm}>
            Revert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
