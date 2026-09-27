import type { MouseEvent } from 'react'

import { cn } from '@workspace/ui/lib/utils'

const CHEVRON =
  'M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z'

// The chevron jumps between states, as the file tree's always has; a rotation caught mid-way reads
// as a third state.
export function TreeChevron({
  expanded,
  onClick,
}: {
  expanded: boolean
  onClick?: (event: MouseEvent<SVGSVGElement>) => void
}) {
  return (
    <svg
      aria-hidden='true'
      data-slot='tree-chevron'
      data-expanded={expanded}
      className={cn('size-(--tree-lane) shrink-0 text-muted-foreground', !expanded && '-rotate-90')}
      viewBox='0 0 16 16'
      onClick={onClick}
    >
      <path d={CHEVRON} fill='currentcolor' />
    </svg>
  )
}
