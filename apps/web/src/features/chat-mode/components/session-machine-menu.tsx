import { CaretUpDownIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { Phase } from '@/lib/environments/components/phase'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useConnectedMachines } from '@/hooks/use-connected-machines'

export function SessionMachineMenu() {
  const machines = useConnectedMachines()
  const selected = useSessionRailStore((state) => state.machineFilter)
  const select = useSessionRailStore((state) => state.setMachineFilter)
  if (machines.length < 2 && !selected) return null
  const machine = machines.find((machine) => machine.environmentId === selected)
  const fallback = selected ? 'Unavailable machine' : 'All machines'
  const title = machine?.label ?? machine?.name ?? fallback
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Filter machines'
            size='sm'
            variant='ghost'
            className='text-muted-foreground text-2xs min-w-0 gap-1 px-1'
            title={machine ? `${machine.name} · ${machine.origin}` : undefined}
          >
            <span className='truncate'>{title}</span>
            <CaretUpDownIcon className='size-(--icon-size-sm) shrink-0' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-56'>
        <DropdownMenuRadioGroup value={selected ?? ''}>
          <DropdownMenuLabel>Show machines</DropdownMenuLabel>
          <DropdownMenuRadioItem value='' onClick={() => select(null)}>
            All machines
          </DropdownMenuRadioItem>
          {machines.map((machine) => (
            <DropdownMenuRadioItem
              key={machine.environmentId}
              title={`${machine.name} · ${machine.origin}`}
              value={machine.environmentId}
              onClick={() => select(machine.environmentId)}
            >
              <Phase phase={machine.phase} label={machine.label ?? machine.name} />
              <span className='truncate'>{machine.label ?? machine.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
