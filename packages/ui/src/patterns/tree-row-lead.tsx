import type { MouseEvent, ReactNode } from 'react'

import { cn } from '@workspace/ui/lib/utils'

const CHEVRON =
  'M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z'

// Six guide tones cycle by level; each lights while the pointer is over the `group/tree` ancestor.
const GUIDE_TONES = [
  'group-hover/tree:bg-(--tree-guide-1)',
  'group-hover/tree:bg-(--tree-guide-2)',
  'group-hover/tree:bg-(--tree-guide-3)',
  'group-hover/tree:bg-(--tree-guide-4)',
  'group-hover/tree:bg-(--tree-guide-5)',
  'group-hover/tree:bg-(--tree-guide-6)',
] as const

/**
 * A tree row's leading edge: one `--tree-indent` step per level, a guide per level when `guides`
 * is set, and a `--tree-lane` wide lane holding the disclosure chevron, or `children` for a row
 * that does not expand.
 */
export function TreeRowLead({
  depth,
  expanded,
  guides = false,
  activeGuide,
  className,
  children,
  onChevronClick,
}: {
  readonly depth: number
  /** Whether the row is open; leave it out for a row with nothing to disclose. */
  readonly expanded?: boolean
  readonly guides?: boolean
  /** The level whose guide stays lit, such as the focused row's parent. */
  readonly activeGuide?: number
  readonly className?: string
  readonly children?: ReactNode
  readonly onChevronClick?: (event: MouseEvent<SVGSVGElement>) => void
}) {
  return (
    <span
      data-slot='tree-row-lead'
      className={cn('relative flex shrink-0 items-center self-stretch', className)}
      style={depth > 0 ? { paddingInlineStart: `calc(${depth} * var(--tree-indent))` } : undefined}
    >
      {guides ? <TreeRowGuides activeGuide={activeGuide} depth={depth} /> : null}
      <span
        data-slot='tree-row-lane'
        className='flex w-(--tree-lane) shrink-0 items-center justify-center'
      >
        {expanded === undefined ? (
          children
        ) : (
          <TreeChevron expanded={expanded} onClick={onChevronClick} />
        )}
      </span>
    </span>
  )
}

function TreeRowGuides({ depth, activeGuide }: { depth: number; activeGuide?: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      aria-hidden='true'
      data-slot='tree-row-guide'
      className={cn(
        'pointer-events-none absolute inset-y-0 w-px -translate-x-(--tree-guide-shift) bg-(--tree-guide) transition-opacity motion-reduce:transition-none',
        GUIDE_TONES[level % GUIDE_TONES.length],
        level === activeGuide
          ? 'opacity-(--tree-guide-active-opacity)'
          : 'opacity-(--tree-guide-opacity) group-hover/tree:opacity-(--tree-guide-hover-opacity)',
      )}
      style={{ left: `calc(var(--tree-guide-offset) + ${level} * var(--tree-indent))` }}
    />
  ))
}

// The chevron jumps between states, as the file tree's always has; a rotation caught mid-way reads
// as a third state.
function TreeChevron({
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
