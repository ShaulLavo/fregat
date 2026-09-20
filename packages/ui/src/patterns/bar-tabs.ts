import { cn } from '@workspace/ui/lib/utils'

export const BAR_TAB_STRIP_CLASS =
  'no-scrollbar flex h-(--bar-height) shrink-0 items-stretch overflow-x-auto'

export const BAR_TAB_FILLER_CLASS = 'min-w-0 flex-1 self-stretch'

export function barTabClassName(active: boolean, className?: string) {
  return cn(
    'flex shrink-0 items-center gap-(--density-control-gap) px-(--density-control-padding-x) text-xs whitespace-nowrap',
    active
      ? 'bg-content-well text-foreground'
      : 'text-muted-foreground hover:bg-row-hover active:bg-row-active hover:text-foreground',
    className,
  )
}
