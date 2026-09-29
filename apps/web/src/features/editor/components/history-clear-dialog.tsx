import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { useIsMutating } from '@tanstack/react-query'
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
import { Spinner } from '@workspace/ui/components/spinner'

export function HistoryClearDialog({
  documentKey,
  open,
  stateCount,
  onConfirm,
  onOpenChange,
}: {
  documentKey: DocumentKey
  open: boolean
  stateCount: number
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  const pending = useIsMutating({ mutationKey: editorMutationKeys.historyClear(documentKey) }) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear history?</DialogTitle>
          <DialogDescription className='tabular-nums'>
            {stateCount === 1
              ? 'Deletes the earlier version of this file. Text that exists only in it is gone for good.'
              : `Deletes all ${stateCount} earlier versions of this file. Text that exists only in them is gone for good.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => onOpenChange(false)}
            type='button'
            variant='outline'
          >
            Cancel
          </Button>
          <HoldButton disabled={pending} onConfirm={onConfirm}>
            {pending ? <Spinner /> : null}
            Clear history
          </HoldButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
