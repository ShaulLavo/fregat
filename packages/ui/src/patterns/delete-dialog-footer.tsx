import { TrashIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button'
import { DialogFooter } from '../components/dialog'
import { HoldButton } from '../components/hold-button'
import { Spinner } from '../components/spinner'

/**
 * Cancel beside a destructive Delete whose icon becomes the loader while the delete runs.
 * `hold` makes Delete a hold-to-confirm, for a delete nothing can undo.
 */
export function DeleteDialogFooter({
  cancelDisabled = false,
  children,
  confirmDisabled = false,
  hold = false,
  onCancel,
  onConfirm,
  pending = false,
}: {
  readonly cancelDisabled?: boolean
  /** Extra actions, rendered before Cancel. */
  readonly children?: ReactNode
  readonly confirmDisabled?: boolean
  readonly hold?: boolean
  onCancel(): void
  onConfirm(): void
  readonly pending?: boolean
}) {
  const label = (
    <>
      {pending ? <Spinner /> : <TrashIcon data-icon='inline-start' />}
      Delete
    </>
  )
  return (
    <DialogFooter>
      {children}
      <Button disabled={cancelDisabled} onClick={onCancel} type='button' variant='outline'>
        Cancel
      </Button>
      {hold ? (
        <HoldButton disabled={confirmDisabled || pending} onConfirm={onConfirm}>
          {label}
        </HoldButton>
      ) : (
        <Button
          disabled={confirmDisabled || pending}
          onClick={onConfirm}
          type='button'
          variant='destructive'
        >
          {label}
        </Button>
      )}
    </DialogFooter>
  )
}
