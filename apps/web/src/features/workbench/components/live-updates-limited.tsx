import { EyeSlashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useWatchCoverage } from '@/hooks/use-watch-coverage'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'
import { limitedWatchDescription } from '@/features/workbench/utils/watch-coverage-copy'

export function LiveUpdatesLimited({ rootPath }: { readonly rootPath: string }) {
  const coverage = useWatchCoverage(rootPath)
  const bus = useCommandBus()
  if (coverage?.mode !== 'limited') return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label='Live updates limited'
            className='text-muted-foreground'
            data-live-updates-limited=''
            size='icon-sm'
            type='button'
            variant='ghost'
            onClick={() =>
              bus.dispatch('workspace.showWatchSettings', {
                source: { kind: 'programmatic', caller: 'file-navigator-header' },
              })
            }
          >
            <EyeSlashIcon className='size-(--icon-size-sm)' />
          </Button>
        }
      />
      <TooltipContent className='max-w-72'>{limitedWatchDescription(coverage)}</TooltipContent>
    </Tooltip>
  )
}
