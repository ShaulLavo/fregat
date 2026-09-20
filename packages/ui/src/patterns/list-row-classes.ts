import { cn } from '@workspace/ui/lib/utils'

export function listRowClassName({
  interactive = true,
  className,
}: {
  interactive?: boolean
  className?: string
} = {}) {
  return cn(
    'group/row relative flex h-(--density-row-height) min-w-0 shrink-0 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-xs text-foreground outline-none select-none',
    'aria-selected:bg-row-selected aria-selected:text-foreground data-[selected=true]:bg-row-selected data-[selected=true]:text-foreground data-[marked=true]:ring-1 data-[marked=true]:ring-inset data-[marked=true]:ring-ring/40 aria-disabled:opacity-50 data-[disabled=true]:opacity-50',
    interactive &&
      'not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:hover:bg-row-hover not-aria-disabled:not-data-[disabled=true]:not-aria-selected:not-data-[selected=true]:active:bg-row-active',
    className,
  )
}
