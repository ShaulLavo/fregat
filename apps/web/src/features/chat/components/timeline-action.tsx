import type { ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

/** Keep interactive and plain timeline rows on the same icon column. */
export function TimelineAction({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      // Compensate for Button’s transparent 1px border beside plain rows’ 4px padding.
      className={cn('px-[calc(--spacing(1)-1px)]', className)}
    />
  )
}
