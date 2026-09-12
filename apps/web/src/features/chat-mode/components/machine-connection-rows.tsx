import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'

import { Phase } from '@/lib/environments/components/phase'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { isDesktop } from '@/lib/platform/bridge'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'

export function MachineConnectionRows() {
  const connections = useEnvironmentConnections()
  const entries = useEnvironmentsStore((state) => state.entries)
  const primary = entries[primaryServerOrigin()]
  const machines = connections.machines
    .filter(
      (machine) =>
        (machine.phase === 'idle' && machine.environmentId !== null) ||
        hasConnectionNotice({
          ...machine,
          connectedAt: machine.origin ? (entries[machine.origin]?.connectedAt ?? null) : null,
        }),
    )
    .map((machine) => ({
      name: `machine:${machine.name}`,
      label: machine.config.label ?? machine.name,
      phase: machine.phase,
      lastError: machine.lastError,
      disabled: machine.config.kind === 'ssh' && !isDesktop(),
      retry: () => connections.retryMachine(machine.name),
    }))
  if (primary && hasConnectionNotice(primary))
    machines.unshift({
      name: 'primary',
      label: primary.label ?? primary.name,
      phase: primary.phase,
      lastError: primary.lastError,
      disabled: false,
      retry: () => connections.retryPrimary(),
    })
  if (!machines.length) return null
  return (
    <div className='flex shrink-0 flex-col gap-1 px-2 pt-2'>
      {machines.map((machine) => (
        <div
          key={machine.name}
          className={cn(
            'rounded-md border p-2 text-xs',
            machine.phase === 'blocked' || machine.phase === 'identity-drift'
              ? 'border-destructive/30 text-destructive'
              : 'border-warning/30 text-warning',
          )}
        >
          <div className='flex items-center gap-2'>
            <Phase phase={machine.phase} label={machine.label} />
            <span className='min-w-0 flex-1 truncate'>{machine.label}</span>
            <span>{machine.phase}</span>
          </div>
          {machine.lastError ? <p className='mt-1 break-words'>{machine.lastError}</p> : null}
          <Button
            size='sm'
            variant='ghost'
            disabled={machine.disabled}
            onClick={() => void machine.retry()}
          >
            {machine.phase === 'idle' ? 'Connect' : 'Retry now'}
          </Button>
        </div>
      ))}
    </div>
  )
}
