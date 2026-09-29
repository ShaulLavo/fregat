import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

export function RawConflictReloadDialog({
  onCancel,
  onConfirm,
  open,
}: {
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly open: boolean
}) {
  return (
    <Dialog onOpenChange={(next) => next || onCancel()} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Drop your unsaved edits?</DialogTitle>
          <DialogDescription>
            settings.json goes back to the latest version and your unsaved edits are lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button onClick={onConfirm} type='button' variant='destructive'>
            Drop my edits
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
