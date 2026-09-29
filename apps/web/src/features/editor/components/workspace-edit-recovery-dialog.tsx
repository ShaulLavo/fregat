import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import {
  ArrowCounterClockwiseIcon,
  FloppyDiskIcon,
  TrashIcon,
  WarningOctagonIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { useState } from 'react'

import { useWorkspaceEditState } from '@/features/editor/hooks/use-workspace-edit-state'
import { useWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import { selectWorkspaceEditRecovery } from '@/features/editor/utils/workspace-edit-dialog-state'

export function WorkspaceEditRecoveryDialog() {
  const service = useWorkspaceEditService()
  const state = useWorkspaceEditState(selectWorkspaceEditRecovery)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const recovery = state?.recovery ?? null
  const busy = state?.phase === 'recovering' || state?.phase === 'releasing-recovery'
  const conflict = state?.phase === 'released' && recovery !== null
  const open = state !== null

  const discard = async () => {
    if (!recovery) return
    const released = await service.discardRecoveryData(recovery.unrecoveredPaths)
    if (released) setConfirmDiscard(false)
  }

  const dismissConflict = () => {
    if (!conflict) return
    service.dismissResult()
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) return
          dismissConflict()
        }}
      >
        <DialogContent
          className='w-[min(520px,calc(100vw-2rem))] max-w-none sm:max-w-none'
          finalFocus={false}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>
              {conflict ? 'Some files may be wrong' : 'Some files could not be put back'}
            </DialogTitle>
            <DialogDescription>
              {conflict
                ? 'The saved copies were deleted before every file was put back, so these files may still hold part of the failed edit.'
                : 'A multi-file edit failed partway, and undoing it did not put every file back. Copies of the originals are kept until you choose what to do.'}
            </DialogDescription>
          </DialogHeader>

          {conflict ? (
            <Alert variant='warning'>
              <WarningOctagonIcon />
              <AlertTitle>File contents are unknown</AlertTitle>
              <AlertDescription>
                <p>
                  Saving is off for these files while they are open. Close and reopen them to load
                  what is on disk, then edit again.
                </p>
                <ul className='text-2xs grid gap-1 font-mono'>
                  {recovery.unrecoveredPaths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant='destructive'>
              <WarningOctagonIcon />
              <AlertTitle className='tabular-nums'>
                {recovery?.unrecoveredPaths.length ?? 0}{' '}
                {recovery?.unrecoveredPaths.length === 1 ? 'file' : 'files'} not put back
              </AlertTitle>
              <AlertDescription>
                <ul className='text-2xs grid gap-1 font-mono'>
                  {recovery?.unrecoveredPaths.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {busy ? (
            <div className='text-muted-foreground flex items-center gap-2 text-xs' role='status'>
              <Spinner size='sm' aria-hidden='true' />
              {state.phase === 'recovering' ? 'Putting files back…' : 'Deleting the saved copies…'}
            </div>
          ) : null}

          <DialogFooter>
            {conflict ? (
              <>
                <Button disabled type='button'>
                  <FloppyDiskIcon data-icon='inline-start' />
                  Save these files
                </Button>
                <Button onClick={dismissConflict} type='button' variant='outline'>
                  Close
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={busy}
                  onClick={() => setConfirmDiscard(true)}
                  type='button'
                  variant='destructive'
                >
                  <TrashIcon data-icon='inline-start' />
                  Delete saved copies
                </Button>
                <Button disabled={busy} onClick={() => void service.retryRecovery()} type='button'>
                  <ArrowCounterClockwiseIcon data-icon='inline-start' />
                  Try again
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent
          className='w-[min(480px,calc(100vw-2rem))] max-w-none sm:max-w-none'
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>Delete the saved copies?</DialogTitle>
            <DialogDescription>
              These files may still hold part of the failed edit. Once the copies are gone, they
              cannot be put back.
            </DialogDescription>
          </DialogHeader>
          <ul className='bg-muted text-2xs grid max-h-40 gap-1 overflow-auto overscroll-contain rounded-lg p-3 font-mono'>
            {recovery?.unrecoveredPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setConfirmDiscard(false)} type='button' variant='outline'>
              Keep saved copies
            </Button>
            <Button onClick={() => void discard()} type='button' variant='destructive'>
              <TrashIcon data-icon='inline-start' />
              Delete copies
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
