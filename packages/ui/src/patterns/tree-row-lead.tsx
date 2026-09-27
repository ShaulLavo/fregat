import type { MouseEvent, ReactNode } from 'react'

import { TreeChevron } from '@workspace/ui/patterns/tree-chevron'
import { TreeRowGuides } from '@workspace/ui/patterns/tree-row-guides'

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
  children,
  onChevronClick,
}: {
  readonly depth: number
  /** Whether the row is open; leave it out for a row with nothing to disclose. */
  readonly expanded?: boolean
  readonly guides?: boolean
  /** The level whose guide stays lit, such as the focused row's parent. */
  readonly activeGuide?: number
  readonly children?: ReactNode
  readonly onChevronClick?: (event: MouseEvent<SVGSVGElement>) => void
}) {
  return (
    <span
      data-slot='tree-row-lead'
      className='relative flex shrink-0 items-center self-stretch'
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
