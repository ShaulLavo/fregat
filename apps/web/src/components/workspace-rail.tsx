import type { ReactNode } from 'react'
import { GearSixIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'

export function WorkspaceRail({
  children,
  label,
  side,
}: {
  readonly children: ReactNode
  readonly label: string
  readonly side: 'left' | 'right'
}) {
  const bus = useCommandBus()

  return (
    <nav
      aria-label={label}
      className={cn(
        'border-border flex w-(--rail-width) shrink-0 flex-col items-center gap-1 p-1',
        side === 'left' ? 'border-r' : 'bg-card backdrop-material border-l',
      )}
    >
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Settings'
              className='text-muted-foreground mt-auto'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={() =>
                bus.dispatch('workspace.showSettings', {
                  source: { kind: 'programmatic', caller: 'workspace-rail' },
                })
              }
            />
          }
        >
          <GearSixIcon className='size-(--icon-size)' />
        </TooltipTrigger>
        <TooltipContent side={side === 'left' ? 'right' : 'left'}>Settings</TooltipContent>
      </Tooltip>
    </nav>
  )
}
