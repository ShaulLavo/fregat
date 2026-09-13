import { cn } from '@workspace/ui/lib/utils'

export const BAR_TAB_STRIP_CLASS =
  'no-scrollbar flex h-(--bar-height) shrink-0 items-stretch overflow-x-auto'

export const BAR_TAB_FILLER_CLASS = 'border-border min-w-0 flex-1 self-stretch border-b'

export function barTabClassName(active: boolean, className?: string) {
  return cn(
    'flex shrink-0 items-center gap-(--density-control-gap) border-x border-b px-(--density-control-padding-x) text-xs whitespace-nowrap transition-[color,background-color,border-color,box-shadow]',
    active
      ? 'border-x-border bg-content-well text-foreground border-b-transparent'
      : 'border-x-transparent border-b-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
    className,
  )
}
