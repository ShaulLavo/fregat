import { useNavigation } from '@/hooks/use-navigation'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { FormDialog } from '@/features/environments/components/form-dialog'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { useWorkingMachines } from '@/lib/environments/hooks/use-working-machines'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { errorMessage } from '@/lib/error-message'
import { clientErrorDescription } from '@/lib/client-error-taxonomy'
import { connectionNoticeSummary } from '@/lib/environments/utils/connection-notice'
import { InlineError } from '@/components/inline-error'
import { ServerUpdateButton } from '@/components/server-update-button'

export function PickerDialog({
  mode,
  onClose,
}: {
  readonly mode: 'switch' | 'connect' | 'disconnect'
  readonly onClose: () => void
}) {
  const navigation = useNavigation()
  const connections = useEnvironmentConnections()
  const entries = useEnvironmentsStore((state) => state.entries)
  const [error, setError] = useState<string | null>(null)
  const [failedName, setFailedName] = useState<string | null>(null)
  const [adding, setAdding] = useState(mode === 'connect' && connections.machines.length === 0)
  const working = useWorkingMachines()
  const title = {
    switch: 'Switch machine',
    connect: 'Connect machine',
    disconnect: 'Disconnect machine',
  }[mode]
  const machines = connections.machines.filter((machine) =>
    mode === 'connect' ? machine.phase !== 'live' : machine.environmentId !== null,
  )
  const primary = Object.values(entries).find((entry) => entry.kind === 'primary')
  const connecting = mode === 'connect'
  const showForm = connecting && (adding || connections.machines.length === 0)
  // A failed machine's message follows its state, so an update's outcome replaces the connect's.
  const failedError = connections.machines.find((entry) => entry.name === failedName)?.lastError
  const message = error ?? (failedError ? clientErrorDescription(failedError) : null)
  async function choose(name: string) {
    setError(null)
    setFailedName(null)
    try {
      if (connecting) {
        const result = await connections.connectMachine(name)
        if (result === 'cancelled') return
        if (result === 'failed') {
          const failure = connections.store
            .getState()
            .machines.find((entry) => entry.name === name)?.lastError
          if (failure) return setFailedName(name)
          return setError(`Cannot connect to ${name}. Retry the connection.`)
        }
      }
      if (mode === 'disconnect') await connections.disconnectMachine(name)
      const machine = connections.store.getState().machines.find((entry) => entry.name === name)
      if (mode === 'switch' && machine?.environmentId)
        void navigation.openEnvironment(machine.environmentId)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause, 'The machine action failed.'))
    }
  }
  async function trust(name: string) {
    setError(null)
    setFailedName(null)
    const result = await connections.trustMachine(name)
    if (result === 'connected') return onClose()
    if (result === 'failed') setFailedName(name)
  }
  if (showForm)
    return (
      <FormDialog
        intent='connect'
        onCancel={() => {
          if (connections.machines.length === 0) return onClose()
          setAdding(false)
        }}
        onSaved={onClose}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {mode === 'switch' && primary?.environmentId ? (
          <Button
            variant='ghost'
            onClick={() => {
              void navigation.openEnvironment(primary.environmentId!)
              onClose()
            }}
          >
            {primary.label ?? 'Local machine'}
          </Button>
        ) : null}
        {machines.map((machine) => (
          <div key={machine.name} className='flex min-w-0 items-center gap-1'>
            <Button
              variant='ghost'
              className='min-w-0 flex-1 justify-between'
              title={machine.name}
              disabled={working.size > 0}
              onClick={() => void choose(machine.name)}
            >
              <span className='min-w-0 truncate'>{machine.config.label ?? machine.name}</span>
              {working.has(machine.name) ? <Spinner /> : null}
              <span className='text-muted-foreground shrink-0'>
                {machine.lastError
                  ? connectionNoticeSummary(machine.phase, machine.lastError)
                  : machine.phase}
              </span>
            </Button>
            {connecting && machine.phase === 'identity-drift' ? (
              <Button
                size='sm'
                variant='secondary'
                disabled={working.size > 0}
                onClick={() => void trust(machine.name)}
              >
                Trust replacement
              </Button>
            ) : null}
            {connecting ? (
              <ServerUpdateButton
                name={machine.name}
                label={machine.config.label ?? machine.name}
                error={machine.lastError}
                size='sm'
                onUpdated={onClose}
              />
            ) : null}
          </div>
        ))}
        {connecting ? (
          <Button variant='secondary' disabled={working.size > 0} onClick={() => setAdding(true)}>
            Add machine
          </Button>
        ) : null}
        {mode === 'disconnect' && machines.length === 0 ? (
          <p className='text-muted-foreground text-sm'>No connected machines to disconnect.</p>
        ) : null}
        {message ? <InlineError message={message} onHandOff={onClose} title={title} /> : null}
      </DialogContent>
    </Dialog>
  )
}
