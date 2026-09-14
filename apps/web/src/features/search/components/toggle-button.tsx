import type { ReactNode } from 'react'

import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'

type SearchToggleButtonProps = {
  active: boolean
  children: ReactNode
  className?: string
  label: string
  onClick: () => void
}

export function SearchToggleButton({
  active,
  children,
  className,
  label,
  onClick,
}: SearchToggleButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active}
            className={cn(
              'text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground',
              className,
            )}
            size='icon-xs'
            type='button'
            variant='ghost'
            onClick={onClick}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
