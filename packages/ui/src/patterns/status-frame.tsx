import { WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'

import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

/**
 * One fixed frame for a surface that is connecting or has failed to. Every slot keeps its size in
 * both states, so moving between them changes only the words: the mark, the title, a one-line
 * detail that rises in when it changes, and an action row reserved even while empty.
 */
export function StatusFrame({
  action,
  className,
  detail,
  title,
  tone,
}: {
  /** Shown on failure, in the row the pending state leaves empty. */
  readonly action?: ReactNode
  readonly className?: string
  readonly detail?: string
  readonly title: string
  readonly tone: 'pending' | 'error'
}) {
  return (
    <div
      aria-live='polite'
      className={cn(
        'bg-background text-foreground grid min-h-svh place-content-center p-8',
        className,
      )}
      data-slot='status-frame'
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className='grid w-80 max-w-full justify-items-center gap-3 text-center'>
        <div className='flex size-10 items-center justify-center'>
          {tone === 'pending' ? (
            <Spinner aria-hidden='true' size='lg' />
          ) : (
            <WarningCircleIcon aria-hidden='true' className='text-destructive size-(--icon-size)' />
          )}
        </div>
        <p className='text-sm font-medium'>{title}</p>
        <p
          className='text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-1 h-10 text-xs/5 motion-reduce:animate-none'
          key={detail}
          title={detail}
        >
          <span className='line-clamp-2'>{detail}</span>
        </p>
        <div className='flex h-(--density-control-height) items-center justify-center'>
          {tone === 'error' ? action : null}
        </div>
      </div>
    </div>
  )
}
