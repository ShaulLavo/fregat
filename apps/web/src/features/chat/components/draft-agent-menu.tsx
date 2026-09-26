import { CaretDownIcon, RobotIcon } from '@phosphor-icons/react'
import type { ProviderInstanceId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { useState } from 'react'

import { DraftAgentList } from './draft-agent-list'

/** The agent definition a new session runs as. The list loads only once the menu is opened. */
export function DraftAgentMenu({
  cwd,
  onSelect,
  providerInstanceId,
  value,
}: {
  readonly cwd: string
  readonly onSelect: (agent: string | null) => void
  readonly providerInstanceId: ProviderInstanceId | null
  readonly value: string | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Run the session as an agent'
            className='text-muted-foreground min-w-0 gap-1 text-xs font-normal'
            size='sm'
            title={value ? `Runs as the ${value} agent` : 'Runs as the default agent'}
            type='button'
            variant='ghost'
          >
            <RobotIcon className='size-(--icon-size-sm) shrink-0' />
            <span className='truncate'>{value ?? 'Default agent'}</span>
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='max-h-80 w-72 p-1' side='top'>
        <DraftAgentList
          cwd={cwd}
          enabled={open}
          providerInstanceId={providerInstanceId}
          value={value}
          onSelect={onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
