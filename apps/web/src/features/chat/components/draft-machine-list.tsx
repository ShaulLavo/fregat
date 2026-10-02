import type { EnvironmentId } from '@workspace/contracts'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@workspace/ui/components/dropdown-menu'

import { Phase } from '@/lib/environments/components/phase'
import type { DraftMachine } from '../utils/draft-workspace'

export function DraftMachineList({
  machines,
  environmentId,
  lockedReason,
  onSelect,
}: {
  readonly machines: readonly DraftMachine[]
  readonly environmentId: EnvironmentId
  /** Why the draft cannot leave this machine right now. */
  readonly lockedReason: string | null
  readonly onSelect: (machine: DraftMachine) => void
}) {
  return (
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
            onSelect(machine)
          }}
        >
          <Phase phase={machine.phase} label={machine.label} />
          <span className='truncate'>{machine.label}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
