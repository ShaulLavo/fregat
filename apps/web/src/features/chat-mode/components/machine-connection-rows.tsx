import { MachineConnectionNotice } from '@/features/chat-mode/components/machine-connection-notice'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { isDesktop } from '@/lib/platform/bridge'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'

export function MachineConnectionRows() {
  const connections = useEnvironmentConnections()
  const entries = useEnvironmentsStore((state) => state.entries)
  const activeOrigin = useEnvironmentsStore((state) => state.activeOrigin)
  const activeEnvironment = entries[activeOrigin]?.environmentId
  const primary = entries[primaryServerOrigin()]
  const machines = connections.machines
    .filter(
      (machine) =>
        (machine.origin === activeOrigin ||
          (activeEnvironment != null && machine.environmentId === activeEnvironment)) &&
        ((machine.phase === 'idle' && machine.environmentId !== null) ||
          hasConnectionNotice({
            ...machine,
            connectedAt: machine.origin ? (entries[machine.origin]?.connectedAt ?? null) : null,
          })),
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
    <div className='flex shrink-0 flex-col gap-1 px-2 pt-2 empty:hidden'>
      {machines.map((machine) => (
        <MachineConnectionNotice
          key={machine.name}
          id={machine.name}
          label={machine.label}
          phase={machine.phase}
          error={machine.lastError}
          disabled={machine.disabled}
          retry={machine.retry}
        />
      ))}
    </div>
  )
}
