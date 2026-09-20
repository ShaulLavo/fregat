import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import type { ReactNode } from 'react'

export function SummaryButton({
  children,
  className,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  className?: string
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className={cn('text-muted-foreground', className)}
            disabled={disabled}
            focusableWhenDisabled
            size='icon-sm'
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
