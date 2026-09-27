import { CaretDownIcon } from '@phosphor-icons/react'
import type { EnvironmentId } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { WidestLabel } from '@workspace/ui/components/widest-label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { Phase } from '@/lib/environments/components/phase'
import type { DraftMachine } from '../utils/draft-workspace'
import { DraftMachineList } from './draft-machine-list'

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
            <WidestLabel labels={machines.map((machine) => machine.label)}>
              {current.label}
            </WidestLabel>
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-56 p-1' side='top'>
        <DraftMachineList
          environmentId={environmentId}
          lockedReason={lockedReason}
          machines={machines}
          onSelect={onSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
