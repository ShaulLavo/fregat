import type { ComponentProps, ReactNode } from 'react'

import { PaneBar } from '@workspace/ui/components/pane-bar'
import { cn } from '@workspace/ui/lib/utils'

export type ToolPaneHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode
  detail?: ReactNode
  actions?: ReactNode
  orientation?: 'horizontal' | 'vertical'
}

export function ToolPaneHeader({
  title,
  detail,
  actions,
  orientation = 'horizontal',
  className,
  children,
  ...props
}: ToolPaneHeaderProps) {
  const content = (
    <>
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-(--density-control-gap)',
          orientation === 'vertical' && 'min-h-0 w-full flex-col',
        )}
        title={typeof detail === 'string' ? detail : undefined}
      >
        {title ? (
          <div
            className={cn(
              'shrink-0 truncate text-xs font-medium text-foreground',
              orientation === 'vertical' && 'min-h-0 [writing-mode:vertical-rl]',
            )}
          >
            {title}
          </div>
        ) : null}
        {detail ? (
          <div className='text-2xs text-muted-foreground min-w-0 truncate tabular-nums'>
            {detail}
          </div>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-0.5',
            orientation === 'vertical' ? 'w-full flex-col' : 'ml-auto',
          )}
          data-slot='tool-pane-actions'
        >
          {actions}
        </div>
      ) : null}
    </>
  )

  if (orientation === 'vertical') {
    return (
      <div
        {...props}
        data-slot='tool-pane-header'
        className={cn(
          'flex h-full w-(--rail-width) shrink-0 flex-col items-center gap-1 px-1 py-1 text-foreground',
          className,
        )}
      >
        {content}
      </div>
    )
  }

  return (
    <PaneBar
      {...props}
      as='header'
      data-slot='tool-pane-header'
      className={cn('text-foreground', className)}
    >
      {content}
    </PaneBar>
  )
}
