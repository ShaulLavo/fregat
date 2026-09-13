import { PlusIcon } from '@phosphor-icons/react'

import { useTerminalTabActions } from '@/features/workbench/hooks/use-terminal-tab-actions'
import { Button } from '@workspace/ui/components/button'

export function TerminalActions({ rootPath }: { readonly rootPath: string }) {
  const { openTab } = useTerminalTabActions(rootPath)

  return (
    <div className='border-border flex shrink-0 items-center border-b px-(--density-control-gap)'>
      <Button
        aria-label='New terminal'
        className='text-muted-foreground'
        size='icon-sm'
        title='New terminal'
        type='button'
        variant='ghost'
        onClick={openTab}
      >
        <PlusIcon className='size-3.5' />
      </Button>
    </div>
  )
}
