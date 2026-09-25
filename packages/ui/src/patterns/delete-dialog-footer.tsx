import { TrashIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button'
import { DialogFooter } from '../components/dialog'
import { Spinner } from '../components/spinner'

/** Cancel beside a destructive Delete whose icon becomes the loader while the delete runs. */
export function DeleteDialogFooter({
  cancelDisabled = false,
  children,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  pending = false,
}: {
  readonly cancelDisabled?: boolean
  /** Extra actions, rendered before Cancel. */
  readonly children?: ReactNode
  readonly confirmDisabled?: boolean
  onCancel(): void
  onConfirm(): void
  readonly pending?: boolean
}) {
  return (
    <DialogFooter>
      {children}
      <Button disabled={cancelDisabled} onClick={onCancel} type='button' variant='outline'>
        Cancel
      </Button>
      <Button
        disabled={confirmDisabled || pending}
        onClick={onConfirm}
        type='button'
        variant='destructive'
      >
        {pending ? <Spinner /> : <TrashIcon data-icon='inline-start' />}
        Delete
      </Button>
    </DialogFooter>
  )
}
