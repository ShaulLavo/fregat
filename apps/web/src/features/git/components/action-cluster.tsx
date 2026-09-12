import type { ReactNode } from 'react'
import { cn } from '@workspace/ui/lib/utils'

export function ActionCluster({
  children,
  hoverGroup,
}: {
  children: ReactNode
  hoverGroup: 'group' | 'row'
}) {
  return (
    <div
      className={cn(
        'pointer-events-none flex opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100',
        hoverGroup === 'group'
          ? 'group-hover/group:pointer-events-auto group-hover/group:opacity-100'
          : 'group-hover/row:pointer-events-auto group-hover/row:opacity-100',
      )}
    >
      {children}
    </div>
  )
}
