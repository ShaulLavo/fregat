import { CaretDownIcon } from '@phosphor-icons/react'
import type { EnvironmentId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { Phase } from '@/lib/environments/components/phase'
import type { DraftMachine } from '../utils/draft-workspace'

export function DraftMachineMenu({
  machines,
  environmentId,
  lockedReason,
  pending,
  onSelect,
}: {
  readonly machines: readonly DraftMachine[]
  readonly environmentId: EnvironmentId
  /** Why the draft cannot leave this machine right now, shown in the menu. */
  readonly lockedReason: string | null
  readonly pending: boolean
  readonly onSelect: (machine: DraftMachine) => void
}) {
  const current = machines.find((machine) => machine.environmentId === environmentId)
  if (!current || machines.length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Machine'
            className='text-muted-foreground min-w-0 gap-1 text-xs font-normal'
            disabled={pending}
            size='sm'
            title={`Runs on ${current.label}`}
            type='button'
            variant='ghost'
          >
            {pending ? (
              <Spinner size='xs' label='Moving draft' />
            ) : (
              <Phase phase={current.phase} label={current.label} />
            )}
            <span className='truncate'>{current.label}</span>
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-56 p-1' side='top'>
        <DropdownMenuRadioGroup aria-label='Run on' value={environmentId}>
          <DropdownMenuLabel>Run on</DropdownMenuLabel>
          {lockedReason ? (
            <p className='text-muted-foreground px-2 pb-1 text-xs'>{lockedReason}</p>
          ) : null}
          {machines.map((machine) => (
            <DropdownMenuRadioItem
              key={machine.environmentId}
              closeOnClick
              disabled={
                machine.environmentId !== environmentId &&
                (lockedReason !== null || machine.phase !== 'live' || !machine.worktree)
              }
              title={machine.label}
              value={machine.environmentId}
              onClick={() => {
                if (machine.environmentId !== environmentId) onSelect(machine)
              }}
            >
              <Phase phase={machine.phase} label={machine.label} />
              <span className='truncate'>{machine.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
