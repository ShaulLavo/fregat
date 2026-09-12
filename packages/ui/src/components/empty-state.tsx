import type { ReactNode } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * The one answer to "there is nothing here". Every panel's empty and error
 * state renders through this so they stay the same shape; a *pending* panel
 * renders LoadingState instead, which is the whole point — an empty panel and a
 * loading panel must never look alike.
 *
 * `align='start'` is for states that live inside a list's flow (a references
 * pane, a sidebar section); `align='center'` is for a state that owns a whole
 * pane.
 */
const emptyStateIconTone = {
  error: 'text-destructive',
  muted: 'text-muted-foreground',
  warning: 'text-warning',
} as const

const emptyStateTitleTone = {
  error: 'text-destructive',
  muted: 'text-foreground',
  warning: 'text-foreground',
} as const

function EmptyState({
  action,
  align = 'center',
  className,
  description,
  hint,
  icon,
  iconPosition = 'stacked',
  title,
  tone = 'muted',
}: {
  action?: ReactNode
  align?: 'center' | 'start'
  className?: string
  description?: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  iconPosition?: 'stacked' | 'inline'
  title: string
  tone?: 'error' | 'muted' | 'warning'
}) {
  return (
    <div
      className={cn(
        'flex min-h-0 p-(--density-section-padding) text-xs',
        align === 'center' ? 'items-center justify-center' : 'items-start',
        className,
      )}
      data-slot='empty-state'
      role='status'
    >
      <div
        className={cn(
          'flex flex-col gap-(--density-section-gap)',
          align === 'center' && 'items-center text-center',
        )}
      >
        {icon && iconPosition === 'stacked' ? (
          <span aria-hidden='true' className={cn('[&>svg]:size-6', emptyStateIconTone[tone])}>
            {icon}
          </span>
        ) : null}
        <span className={cn('flex items-center gap-2 font-medium', emptyStateTitleTone[tone])}>
          {icon && iconPosition === 'inline' ? (
            <span
              aria-hidden='true'
              className={cn('shrink-0 [&>svg]:size-4', emptyStateIconTone[tone])}
            >
              {icon}
            </span>
          ) : null}
          {title}
        </span>
        {description ? (
          <span className='text-muted-foreground max-w-64 text-[11px]'>{description}</span>
        ) : null}
        {hint ? (
          <span className='text-muted-foreground/70 flex items-center gap-2 text-[11px]'>
            {hint}
          </span>
        ) : null}
        {action ? <span className='mt-1'>{action}</span> : null}
      </div>
    </div>
  )
}

export { EmptyState }
