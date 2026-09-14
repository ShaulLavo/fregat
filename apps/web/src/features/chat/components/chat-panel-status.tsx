import { HourglassMediumIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

export function ChatPanelStatus({
  createError,
  projectError,
  shellError,
}: {
  createError: string | null
  projectError: string | null
  shellError: string | null
}) {
  const slowRequestCount = useEnvironmentsStore(
    (state) => selectServerConnection(state, state.activeOrigin).slowRequestCount,
  )
  const message = createError ?? projectError ?? shellError
  // Errors win: a request being slow while something is already broken is not
  // the thing the user needs told.
  if (message) {
    return (
      <StatusLine title={message} tone='destructive'>
        <WarningCircleIcon className='size-3.5 shrink-0' />
        <span className='truncate'>{message}</span>
      </StatusLine>
    )
  }
  if (slowRequestCount === 0) return null

  // Said out loud because the alternative is silence: one flat timeout makes a
  // forty-second answer look exactly like a stuck one for the whole forty
  // seconds, and the user has no way to tell whether to wait.
  return (
    <StatusLine tone='warning'>
      <HourglassMediumIcon className='size-3.5 shrink-0' />
      <span className='truncate'>
        Waiting on the server (<span className='tabular-nums'>{slowRequestCount}</span>{' '}
        {slowRequestCount === 1 ? 'request' : 'requests'})
      </span>
    </StatusLine>
  )
}

function StatusLine({
  children,
  title,
  tone,
}: {
  readonly children: ReactNode
  readonly title?: string
  readonly tone: 'destructive' | 'warning'
}) {
  return (
    <div
      title={title}
      className={
        tone === 'destructive'
          ? 'text-destructive text-2xs border-t px-(--density-control-padding-x) py-(--density-section-gap)'
          : 'text-warning text-2xs border-t px-(--density-control-padding-x) py-(--density-section-gap)'
      }
    >
      <div className='flex min-w-0 items-center gap-(--density-control-gap)'>{children}</div>
    </div>
  )
}
