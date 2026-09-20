import * as React from 'react'

import { cn } from '@workspace/ui/lib/utils'

function PaneBar({
  as: Component = 'div',
  className,
  ...props
}: React.ComponentProps<'div'> & {
  as?: 'header' | 'div' | 'footer'
}) {
  return (
    <Component
      data-slot='pane-bar'
      className={cn(
        'flex h-(--bar-height) shrink-0 items-center gap-(--density-control-gap) px-(--bar-padding-x)',
        className,
      )}
      {...props}
    />
  )
}

export { PaneBar }
