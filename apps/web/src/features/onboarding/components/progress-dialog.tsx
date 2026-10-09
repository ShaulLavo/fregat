import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'

import { InlineError } from '@/components/inline-error'

/** A step that waits on a machine: what it waits for, why it stopped, and the way back. */
export function ProgressDialog({
  detail,
  error = null,
  onCancel,
  title,
}: {
  readonly detail: string
  readonly error?: string | null
  readonly onCancel?: () => void
  readonly title: string
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel?.()
      }}
    >
      <DialogContent
        className='sm:max-w-md'
        data-first-workspace-progress=''
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {error ? null : <Spinner size='sm' />}
            {title}
          </DialogTitle>
          <DialogDescription>{detail}</DialogDescription>
        </DialogHeader>
        {error ? <InlineError message={error} title={title} /> : null}
        {onCancel ? (
          <Button className='justify-self-end' type='button' variant='ghost' onClick={onCancel}>
            {error ? 'Back' : 'Cancel'}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
