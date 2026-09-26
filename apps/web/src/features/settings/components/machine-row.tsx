import { errorStringField, type MachineDefinition } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { MachineErrorDetails } from '@/components/machine-error-details'
import { ServerUpdateButton } from '@/components/server-update-button'
import { connectionNoticeSummary } from '@/lib/environments/utils/connection-notice'
import { Phase } from '@/lib/environments/components/phase'
import { useState } from 'react'

import { MachineForm } from '@/components/machine-form'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { useWorkingMachines } from '@/lib/environments/hooks/use-working-machines'
import { InlineError } from '@/components/inline-error'
import { MachineValues } from '@/features/settings/components/machine-values'

export function MachineRow({
  name,
  machine,
  disabled,
}: {
  readonly name: string
  readonly machine: MachineDefinition
  readonly disabled: boolean
}) {
  const connections = useEnvironmentConnections()
  const state = connections.machines.find((entry) => entry.name === name)
  const phase = state?.phase ?? 'idle'
  const pending = phase === 'launching' || phase === 'connecting' || phase === 'reconnecting'
  const connected = phase === 'live' || pending
  const [editing, setEditing] = useState(false)
  const working = useWorkingMachines().has(name)
  const [actionError, setActionError] = useState<string | null>(null)
  const { removeMachine } = useSettingsActions()
  const run = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(
        errorStringField(error, 'message') ?? 'The machine action failed. Retry the connection.',
      )
    }
  }
  const remove = async () => {
    await connections.disconnectMachine(name)
    const submission = removeMachine(name)
    if (submission.kind === 'noop') return
    if ((await submission.settled) === 'acknowledged') return
    setActionError('The machine could not be removed. Retry after resolving the settings error.')
  }
  if (editing)
    return (
      <div className='bg-muted rounded-lg p-4'>
        <MachineForm
          name={name}
          machine={machine}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      </div>
    )

  const detail = `${name} · ${machine.kind === 'ssh' ? machine.target : machine.url}`

  return (
    <div className='bg-muted flex flex-col gap-2 rounded-lg p-3'>
      <div className='flex items-center gap-2' title={detail}>
        <Phase label={machine.label ?? name} phase={phase} />
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>{machine.label ?? name}</span>
        <span className='text-muted-foreground text-xs'>{phase}</span>
      </div>
      <MachineValues machine={machine} name={name} />
      {/* Always mounted: the reconnect loop clears and restores lastError on
          every retry, and a line that comes and goes shifts the whole page. */}
      <div className='flex h-6 items-center gap-1 text-xs'>
        {phase !== 'idle' && phase !== 'live' ? (
          <span role='status' className='text-warning'>
            {connectionNoticeSummary(phase, state?.lastError ?? null)}
          </span>
        ) : null}
        {state?.lastError ? (
          <MachineErrorDetails label={machine.label ?? name} error={state.lastError} />
        ) : null}
      </div>
      {actionError ? (
        <InlineError message={actionError} title={`Machine ${machine.label ?? name}`} />
      ) : null}
      <div className='flex flex-wrap items-center gap-1'>
        {connected ? (
          <Button
            size='sm'
            variant='secondary'
            disabled={working}
            onClick={() => void run(() => connections.disconnectMachine(name))}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size='sm'
            variant='secondary'
            disabled={working}
            onClick={() => void run(() => connections.connectMachine(name))}
          >
            Connect
          </Button>
        )}
        {phase !== 'idle' && phase !== 'live' ? (
          <Button
            size='sm'
            variant='ghost'
            disabled={working}
            onClick={() => void run(() => connections.retryMachine(name))}
          >
            Retry now
          </Button>
        ) : null}
        <ServerUpdateButton
          name={name}
          label={machine.label ?? name}
          error={state?.lastError ?? null}
          size='sm'
        />
        <Button
          size='sm'
          variant='ghost'
          disabled={disabled || working || connected}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
        <Button
          size='sm'
          variant='ghost'
          disabled={disabled || working}
          onClick={() => void run(remove)}
        >
          Remove
        </Button>
      </div>
    </div>
  )
}
