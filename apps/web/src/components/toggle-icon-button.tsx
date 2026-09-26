import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Kbd } from '@workspace/ui/components/kbd'
import { useCommandShortcut } from '@/keymap/hooks/use-command-shortcut'
import type { PlatformCommandId } from '@/keymap/types'
export function ToggleIconButton({
  active,
  command,
  icon,
  keyShortcuts,
  label,
  tooltipSide = 'bottom',
  onClick,
}: {
  readonly active: boolean
  /** The command the click stands for; its bound key shows in the tooltip. */
  readonly command?: PlatformCommandId
  readonly icon: ReactNode
  readonly keyShortcuts?: string
  readonly label: string
  readonly tooltipSide?: 'left' | 'right' | 'bottom'
  readonly onClick: () => void
}) {
  const shortcut = useCommandShortcut(command)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={keyShortcuts}
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
      <TooltipContent side={tooltipSide}>
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
