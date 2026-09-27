import { cn } from '@workspace/ui/lib/utils'

export function listRowClassName({
  interactive = true,
  selectedBar = false,
  cursor = false,
  className,
}: {
  interactive?: boolean
  /** A 2px foreground bar at the start edge of a selected row, inset 4px top and bottom. */
  selectedBar?: boolean
  /** Rings the row that carries `data-cursor` while focus is inside its `group/listbox` ancestor. */
  cursor?: boolean
  className?: string
} = {}) {
  return cn(
    'group/row relative flex h-(--density-row-height) min-w-0 shrink-0 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-xs text-foreground outline-none select-none',
    'aria-selected:bg-row-selected aria-selected:text-foreground data-[selected=true]:bg-row-selected data-[selected=true]:text-foreground data-[marked=true]:ring-1 data-[marked=true]:ring-inset data-[marked=true]:ring-ring/40 aria-disabled:opacity-50 data-[disabled=true]:opacity-50',
    interactive &&
      'not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:hover:bg-row-hover not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:active:bg-row-active',
    selectedBar &&
      'aria-selected:after:pointer-events-none aria-selected:after:absolute aria-selected:after:inset-y-1 aria-selected:after:left-0 aria-selected:after:w-0.5 aria-selected:after:bg-foreground data-[selected=true]:after:pointer-events-none data-[selected=true]:after:absolute data-[selected=true]:after:inset-y-1 data-[selected=true]:after:left-0 data-[selected=true]:after:w-0.5 data-[selected=true]:after:bg-foreground',
    cursor && 'group-focus-within/listbox:data-[cursor=true]:focus-ring-inset-drawn',
    className,
  )
}

/**
 * Releases a row's fixed token height for the rare row that stacks two lines.
 * Without it the second line paints on top of the first, because the row height
 * is a hard `h-`, not a `min-h-`.
 */
export const stackedListRowClassName =
  'h-auto min-h-(--density-row-height) py-(--density-row-padding-y)'
