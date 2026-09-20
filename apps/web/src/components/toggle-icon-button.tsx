import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
export function ToggleIconButton({
  active,
  icon,
  label,
  tooltipSide = 'bottom',
  onClick,
}: {
  readonly active: boolean
  readonly icon: ReactNode
  readonly label: string
  readonly tooltipSide?: 'left' | 'right' | 'bottom'
  readonly onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active}
            className={cn('text-muted-foreground', active && 'bg-accent text-accent-foreground')}
            size='icon-sm'
            type='button'
            variant='ghost'
            onClick={onClick}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
}
