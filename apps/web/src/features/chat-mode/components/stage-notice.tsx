import { WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

/**
 * The stage with no conversation on it: a title, a sentence of why, and the actions that
 * get out of the state. Shared so setup, failure and a vanished session all read as the
 * same surface rather than three improvised screens.
 */
export function StageNotice({
  children,
  detail,
  failed = false,
  title,
}: {
  readonly children: ReactNode
  readonly detail: string
  readonly failed?: boolean
  readonly title: string
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center'>
      {failed ? <WarningCircleIcon className='text-destructive size-(--icon-size)' /> : null}
      <div className='flex flex-col gap-1'>
        <h2 className='text-foreground text-sm font-medium'>{title}</h2>
        <p className='text-muted-foreground max-w-sm text-xs break-words'>{detail}</p>
      </div>
      <div className='flex flex-wrap items-center justify-center gap-2'>{children}</div>
    </div>
  )
}
