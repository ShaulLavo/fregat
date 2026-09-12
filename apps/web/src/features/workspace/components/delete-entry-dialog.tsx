import { TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import type { DeleteTarget } from '@/features/workspace/hooks/use-fs-actions'
import { Spinner } from '@workspace/ui/components/spinner'

/**
 * Deleting is the one tree action with nothing to undo — no trash, no revert —
 * so it never runs straight off a menu click.
 */
export function DeleteEntryDialog({
  deleting,
  error,
  mutationsEnabled,
  onCancel,
  onConfirm,
  target,
}: {
  readonly deleting: boolean
  readonly error: string | null
  readonly mutationsEnabled: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly target: DeleteTarget | null
}) {
  return (
    <Dialog onOpenChange={(open) => open || onCancel()} open={target !== null}>
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none border text-sm sm:max-w-none'
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Delete {target?.isDirectory ? 'folder' : 'file'}</DialogTitle>
          <DialogDescription>{deleteDescription(target)}</DialogDescription>
        </DialogHeader>
        {target ? (
          <div className='bg-muted/30 text-muted-foreground truncate rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
            {target.path}
          </div>
        ) : null}
        {error ? (
          <div
            className='border-destructive/25 bg-destructive/10 text-destructive flex items-start gap-(--density-control-gap) rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
            role='alert'
          >
            <WarningCircleIcon className='mt-0.5 size-3.5 shrink-0' />
            <span>{error}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button disabled={deleting} onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button
            disabled={deleting || !mutationsEnabled}
            onClick={onConfirm}
            type='button'
            variant='destructive'
          >
            {deleting ? (
              <Spinner aria-hidden='true' data-icon='inline-start' role='presentation' />
            ) : (
              <TrashIcon data-icon='inline-start' />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function deleteDescription(target: DeleteTarget | null) {
  if (!target) return 'This cannot be undone.'
  if (target.isDirectory) {
    return `Permanently delete ${target.name} and everything inside it? This cannot be undone.`
  }

  return `Permanently delete ${target.name}? This cannot be undone.`
}
