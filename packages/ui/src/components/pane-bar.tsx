import * as React from 'react'

import { cn } from '@workspace/ui/lib/utils'

const borderClasses = {
  bottom: 'border-b border-border',
  top: 'border-t border-border',
  none: '',
} as const

function PaneBar({
  as: Component = 'div',
  border = 'none',
  className,
  ...props
}: React.ComponentProps<'div'> & {
  as?: 'header' | 'div' | 'footer'
  border?: keyof typeof borderClasses
}) {
  return (
    <Component
      data-slot='pane-bar'
      className={cn(
        'flex h-(--bar-height) shrink-0 items-center gap-(--density-control-gap) px-(--bar-padding-x)',
        borderClasses[border],
        className,
      )}
      {...props}
    />
  )
}

export { PaneBar }
