import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { BusySession, SessionId } from '@workspace/contracts'
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

import { InlineError } from '@/components/inline-error'
import {
  busySessionTitle,
  busyStateLabel,
  restartDescription,
  waitingNote,
} from '@/features/server-update/utils/restart-prompt'

const NO_SESSIONS: readonly BusySession[] = []

/** Names the sessions a restart interrupts; a second busy answer replaces the list in place. */
export function RestartDialog({
  busy,
  error,
  onCancel,
  onConfirm,
  pending,
}: {
  busy: readonly BusySession[] | null
  error: string | null
  onCancel: () => void
  onConfirm: (interrupt: SessionId[]) => void
  pending: boolean
}) {
  const sessions = busy ?? NO_SESSIONS
  const note = waitingNote(sessions)

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
      open={busy !== null}
    >
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none text-sm sm:max-w-none'
        // Portalled, yet React bubbles its events to the titlebar's context menu trigger.
        onContextMenu={(event) => event.stopPropagation()}
        role='alertdialog'
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Restart server</DialogTitle>
          <DialogDescription className='tabular-nums'>
            {restartDescription(sessions)}
          </DialogDescription>
        </DialogHeader>
        <ul aria-label='Sessions to interrupt' className='flex flex-col gap-(--density-gap-tight)'>
          {sessions.map((session) => (
            <li
              className='flex min-w-0 items-baseline gap-(--density-gap-tight) text-xs'
              key={session.sessionId}
              title={busySessionTitle(session)}
            >
              <span className='min-w-0 truncate'>{session.title}</span>
              <span className='text-muted-foreground shrink-0'>
                {busyStateLabel(session.state)}
              </span>
            </li>
          ))}
        </ul>
        {note ? <p className='text-muted-foreground text-xs'>{note}</p> : null}
        {error ? <InlineError message={error} onHandOff={onCancel} title='Restart server' /> : null}
        <DialogFooter>
          <Button disabled={pending} onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => onConfirm(sessions.map((session) => session.sessionId))}
            type='button'
            variant='destructive'
          >
            {pending ? <Spinner /> : <ArrowClockwiseIcon data-icon='inline-start' />}
            Restart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
