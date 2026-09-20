import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { PlusIcon } from '@phosphor-icons/react'

import { useTerminalTabActions } from '@/features/workbench/hooks/use-terminal-tab-actions'
import { Button } from '@workspace/ui/components/button'

export function TerminalActions({ rootPath }: { readonly rootPath: string }) {
  const { openTab } = useTerminalTabActions(rootPath)

  return (
    <div className='flex shrink-0 items-center px-(--density-control-gap)'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='New terminal'
              className='text-muted-foreground'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={openTab}
            >
              <PlusIcon className='size-(--icon-size-sm)' />
            </Button>
          }
        />{' '}
        <TooltipContent>{'New terminal'}</TooltipContent>
      </Tooltip>
    </div>
  )
}
