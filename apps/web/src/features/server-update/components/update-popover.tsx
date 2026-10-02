import { basename, parentPath } from '@/lib/path-formatters'
import type { BusySession } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import type { ReactElement } from 'react'

import {
  busySessionTitle,
  busyStateLabel,
  waitingNote,
} from '@/features/server-update/utils/restart-prompt'

export function UpdatePopover({
  open,
  onOpenChange,
  busy,
  dirtyFiles,
  pending,
  onWait,
  onUpdate,
  children,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly busy: readonly BusySession[]
  readonly dirtyFiles: readonly string[]
  readonly pending: boolean
  readonly onWait: () => void
  readonly onUpdate: () => void
  readonly children: ReactElement
}) {
  const note = waitingNote(busy)
  return (
    <Popover open={open} onOpenChange={onOpenChange} presentation='anchored'>
      <PopoverTrigger render={children} />
      <PopoverContent
        align='end'
        aria-label='Update now?'
        onContextMenu={(event) => event.stopPropagation()}
      >
        <PopoverTitle>Update now?</PopoverTitle>
        <PopoverDescription>
          {busy.length > 0
            ? `Updating now interrupts ${busy.length} session${busy.length === 1 ? '' : 's'}.`
            : 'Save these files to finish reloading the app.'}
        </PopoverDescription>
        {busy.length > 0 ? (
          <ul aria-label='Affected sessions' className='flex flex-col gap-(--density-gap-tight)'>
            {busy.map((session) => (
              <li
                key={session.sessionId}
                title={busySessionTitle(session)}
                className='flex min-w-0 items-baseline gap-(--density-gap-tight)'
              >
                <span className='min-w-0 truncate'>{session.title}</span>
                <span className='text-muted-foreground shrink-0'>
                  {busyStateLabel(session.state)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {dirtyFiles.length > 0 ? (
          <>
            <p className='text-muted-foreground'>
              The page reload waits for these files to be saved.
            </p>
            <ul aria-label='Unsaved files' className='flex flex-col gap-(--density-gap-tight)'>
              {dirtyFiles.map((file, index) => (
                <li
                  key={`${file}:${index}`}
                  title={file}
                  className='flex min-w-0 gap-(--density-gap-tight) font-mono'
                >
                  <span className='shrink-0'>{basename(file)}</span>
                  <span className='text-muted-foreground min-w-0 truncate'>{parentPath(file)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {note ? <p className='text-muted-foreground'>{note}</p> : null}
        <div className='flex justify-end gap-(--density-gap-tight)'>
          <Button size='xs' variant='secondary' disabled={pending} onClick={onWait}>
            Update when done
          </Button>
          <Button size='xs' variant='destructive' disabled={pending} onClick={onUpdate}>
            Update now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
