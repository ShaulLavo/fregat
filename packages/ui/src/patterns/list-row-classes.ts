import { cn } from '@workspace/ui/lib/utils'

export function listRowClassName({
  interactive = true,
  selectedBar = false,
  cursor = false,
  className,
}: {
  interactive?: boolean
  /** Draws a 2px foreground bar at the start edge, inset 4px top and bottom; pass it for a selected row only. */
  selectedBar?: boolean
  /** Rings the row, the list's keyboard cursor, while focus is inside its `group/listbox` ancestor. */
  cursor?: boolean
  className?: string
} = {}) {
  return cn(
    'group/row relative flex h-(--density-row-height) min-w-0 shrink-0 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-xs text-foreground outline-none select-none',
    'aria-selected:bg-row-selected aria-selected:text-foreground data-[selected=true]:bg-row-selected data-[selected=true]:text-foreground data-[marked=true]:ring-1 data-[marked=true]:ring-inset data-[marked=true]:ring-ring/40 aria-disabled:opacity-50 data-[disabled=true]:opacity-50',
    interactive &&
      'not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:hover:bg-row-hover not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:active:bg-row-active',
    // Only on the rows that draw them: a pseudo-element rule on every row costs each restyle.
    selectedBar &&
      'after:pointer-events-none after:absolute after:inset-y-1 after:left-0 after:w-0.5 after:bg-foreground',
    cursor && 'group-focus-within/listbox:focus-ring-inset-drawn',
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
