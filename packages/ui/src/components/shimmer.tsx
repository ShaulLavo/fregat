import type { ComponentProps } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * A label that is already on screen and is transiently in progress — a header
 * detail, a summary line, a tool status. The sweep is what separates it from
 * the same sentence sitting still.
 *
 * Not another loader: a region with nothing in it yet gets LoadingState, and a
 * control mid-action gets OrbitLoader. This is only for text that was already
 * earning its place.
 */
function Shimmer({ children, className, ...props }: ComponentProps<'span'>) {
  return (
    <span className={cn('text-shimmer', className)} data-slot='shimmer' {...props}>
      {children}
    </span>
  )
}

export { Shimmer }
