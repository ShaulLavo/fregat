import { CaretDownIcon } from '@phosphor-icons/react'

import { cn } from '@workspace/ui/lib/utils'

type LogsRowChevronProps = {
  expanded: boolean
}

export function LogsRowChevron({ expanded }: LogsRowChevronProps) {
  return (
    <CaretDownIcon
      aria-hidden='true'
      className={cn(
        'text-muted-foreground size-(--icon-size-sm) shrink-0 transition-transform',
        expanded && 'rotate-180',
      )}
    />
  )
}
