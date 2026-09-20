import type { ComponentProps } from 'react'

import { cn } from '@workspace/ui/lib/utils'

/**
 * Two counter-rotating conic arcs under a slow breathing scale — ellie's
 * AILoader and SpinningLoader are the same mark, so this is both of them.
 *
 * Holds its shape at any diameter: legible at 14px next to a line of text and
 * still right at 48px owning a surface. Draws in currentColor, so it takes the
 * weight of whatever it sits in. OrbitLoader is the busier sibling — reach for
 * this one when the wait should stay quiet.
 *
 * Still not the default: a region with no content yet gets LoadingState, and a
 * control mid-action gets OrbitLoader. This is for a wait worth looking at.
 */
function RingLoader({
  className,
  label = 'Loading',
  ...props
}: ComponentProps<'div'> & { label?: string }) {
  return (
    <div
      aria-label={label}
      className={cn('loader-ring relative size-10', className)}
      data-slot='ring-loader'
      role='status'
      {...props}
    >
      <span aria-hidden='true' className='loader-ring-outer absolute inset-0 rounded-full' />
      <span aria-hidden='true' className='loader-ring-inner absolute inset-0 rounded-full' />
    </div>
  )
}

export { RingLoader }
