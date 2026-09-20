import type { ComponentProps, ReactNode } from 'react'

import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { cn } from '@workspace/ui/lib/utils'
import { ToolPaneHeader } from '@workspace/ui/patterns/tool-pane-header'

export type ToolPaneProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: string
  detail?: ReactNode
  actions?: ReactNode
  header?: ReactNode
  subheader?: ReactNode
  state?: { pending?: boolean; error?: boolean; empty?: boolean }
  loading?: ReactNode
  errorState?: ReactNode
  emptyState?: ReactNode
  bodyClassName?: string
  bodyProps?: ComponentProps<'div'>
}

export function ToolPane({
  title,
  detail,
  actions,
  header,
  subheader,
  state,
  loading,
  errorState,
  emptyState,
  bodyClassName,
  bodyProps,
  children,
  className,
  ...props
}: ToolPaneProps) {
  let content = children
  if (state?.pending)
    content = loading ?? (
      <LoadingState
        label={`Loading ${title ?? 'content'}`}
        className='flex h-full items-center justify-center'
      >
        <RingLoader />
      </LoadingState>
    )
  else if (state?.error)
    content = errorState ?? (
      <EmptyState title={`Unable to load ${title ?? 'content'}`} tone='error' />
    )
  else if (state?.empty) content = emptyState ?? <EmptyState title='Nothing here yet' />

  return (
    <div
      {...props}
      data-slot='tool-pane'
      className={cn('flex min-h-0 flex-1 flex-col bg-background', className)}
    >
      {header === undefined ? (
        <ToolPaneHeader title={title} detail={detail} actions={actions} />
      ) : (
        header
      )}
      {subheader}
      <div
        {...bodyProps}
        data-slot='tool-pane-body'
        className={cn(
          'min-h-0 flex-1 overflow-auto focus-ring-inset',
          bodyClassName,
          bodyProps?.className,
        )}
      >
        {content}
      </div>
    </div>
  )
}
