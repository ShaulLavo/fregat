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
              {conflict ? 'Recovery conflict' : 'Workspace recovery required'}
            </DialogTitle>
            <DialogDescription>
              {conflict
                ? 'Rollback data was discarded without proving that every path was restored.'
                : 'An atomic workspace edit could not restore every path. Recovery data is being kept until you choose an explicit outcome.'}
            </DialogDescription>
          </DialogHeader>

          {conflict ? (
            <Alert variant='warning'>
              <WarningOctagonIcon />
              <AlertTitle>Workspace state is unknown</AlertTitle>
              <AlertDescription>
                <p>
                  Save and resource operations are disabled for affected live buffers. Close and
                  reopen them from disk before editing again.
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
                {recovery?.unrecoveredPaths.length ?? 0} unrecovered{' '}
                {recovery?.unrecoveredPaths.length === 1 ? 'path' : 'paths'}
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
              {state.phase === 'recovering'
                ? 'Retrying exact recovery…'
                : 'Releasing recovery data…'}
            </div>
          ) : null}

          <DialogFooter>
            {conflict ? (
              <>
                <Button disabled type='button'>
                  <FloppyDiskIcon data-icon='inline-start' />
                  Save affected buffers
                </Button>
                <Button onClick={dismissConflict} type='button' variant='outline'>
                  Continue with conflicted buffers
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
                  Discard recovery data
                </Button>
                <Button disabled={busy} onClick={() => void service.retryRecovery()} type='button'>
                  <ArrowCounterClockwiseIcon data-icon='inline-start' />
                  Retry recovery
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
            <DialogTitle>Discard rollback data?</DialogTitle>
            <DialogDescription>
              Files may remain changed. This only deletes the rollback data and cannot prove that
              the workspace was restored.
            </DialogDescription>
          </DialogHeader>
          <ul className='bg-muted text-2xs grid max-h-40 gap-1 overflow-auto rounded-lg p-3 font-mono'>
            {recovery?.unrecoveredPaths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setConfirmDiscard(false)} type='button' variant='outline'>
              Keep recovery data
            </Button>
            <Button onClick={() => void discard()} type='button' variant='destructive'>
              <TrashIcon data-icon='inline-start' />
              Discard exact paths
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
