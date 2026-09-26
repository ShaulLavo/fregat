import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import { useId, useState } from 'react'

import { InlineError } from '@/components/inline-error'
import { DialogField } from '@/features/git/components/dialog-field'
import { useCloneRepositoryMutation } from '@/features/git/hooks/use-clone-repository-mutation'
import type { CloneProgress } from '@/features/git/utils/api'
import { cloneDestination } from '@/features/git/utils/clone-destination'
import { cloneProgressLabel } from '@/features/git/utils/clone-progress-label'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'

/** Clones a repository into a new folder and opens it as a project. */
export function CloneRepositoryDialog({
  defaultParent,
  onCloned,
  onOpenChange,
  open,
}: {
  /** Where a folder named after the repository goes unless the user names another. */
  readonly defaultParent: string
  readonly onCloned: (path: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
}) {
  const id = useId()
  const clone = useCloneRepositoryMutation()
  const [source, setSource] = useState('')
  const [folder, setFolder] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [cancel, setCancel] = useState<AbortController | null>(null)
  const destination = folder ?? cloneDestination(defaultParent, source)
  const ready = source.trim().length > 0 && destination.length > 0 && !clone.isPending

  function submit() {
    const controller = new AbortController()
    setCancel(controller)
    setProgress(null)
    clone.mutate(
      { source: source.trim(), destination, signal: controller.signal, onProgress: setProgress },
      {
        onSuccess: (result) => {
          onOpenChange(false)
          onCloned(result.path)
        },
      },
    )
  }

  function close(next: boolean) {
    if (!next) cancel?.abort()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Clone repository</DialogTitle>
          <DialogDescription>
            Clone into a new folder and open it as a project. A cancelled clone leaves nothing
            behind.
          </DialogDescription>
        </DialogHeader>
        <form
          className='flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) submit()
          }}
        >
          <DialogField id={`${id}-source`} label='Repository'>
            <Input
              id={`${id}-source`}
              autoCapitalize='off'
              autoComplete='off'
              autoCorrect='off'
              disabled={clone.isPending}
              placeholder='https://github.com/owner/name.git or owner/name'
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.currentTarget.value)}
            />
          </DialogField>
          <DialogField id={`${id}-folder`} label='Folder'>
            <Input
              id={`${id}-folder`}
              autoCapitalize='off'
              autoComplete='off'
              disabled={clone.isPending}
              spellCheck={false}
              title={destination}
              value={destination}
              onChange={(event) => setFolder(event.currentTarget.value)}
            />
          </DialogField>
          {clone.isPending ? (
            <p
              className='text-muted-foreground flex items-center gap-2 text-xs tabular-nums'
              role='status'
            >
              <Spinner size='xs' />
              {cloneProgressLabel(progress)}
            </p>
          ) : null}
          {clone.error && !cancel?.signal.aborted ? (
            <InlineError message={clientErrorMessage(clone.error)} title='Clone repository' />
          ) : null}
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type='submit' disabled={!ready}>
              {clone.isPending ? <Spinner /> : null}
              Clone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
