import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/** Label and value pairs in two aligned columns, with an action column that keeps its width. */
function ValueGrid({ className, ...props }: ComponentProps<'dl'>) {
  return (
    <dl
      data-slot='value-grid'
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 text-xs',
        className,
      )}
      {...props}
    />
  )
}

/**
 * One pair. The value is mono and cut to one line, so the caller gives the full value as `title`
 * when it can be longer than the row.
 */
function ValueGridRow({
  action,
  label,
  title,
  value,
}: {
  /** A copy button or similar; the column is reserved either way. */
  readonly action?: ReactNode
  readonly label: string
  readonly title?: string
  readonly value: ReactNode
}) {
  return (
    <div className='contents' data-slot='value-grid-row'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='min-w-0 truncate font-mono' title={title}>
        {value}
      </dd>
      <dd className='flex h-6 min-w-6 items-center justify-end'>{action}</dd>
    </div>
  )
}

export { ValueGrid, ValueGridRow }
