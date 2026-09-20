import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type { DocumentKey } from '@/lib/documents/utils/types'
import { useIsMutating } from '@tanstack/react-query'
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
              ? 'The one earlier state of this file, and any text only it still holds, will be gone.'
              : `All ${stateCount} earlier states of this file, and any text only they still hold, will be gone.`}
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
          <Button disabled={pending} onClick={onConfirm} type='button' variant='destructive'>
            {pending ? <OrbitLoader /> : null}
            Clear history
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
