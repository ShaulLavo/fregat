import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'

import { InlineError } from '@/components/inline-error'
import { MachineForm } from '@/components/machine-form'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { connectionNoticeSummary } from '@/lib/environments/utils/connection-notice'
import { useConnectMachine } from '@/features/onboarding/hooks/use-connect-machine'

/** The remote path's first step: a saved machine, or a new one through the machine form. */
export function RemoteDialog({
  onBack,
  onMachine,
}: {
  readonly onBack: () => void
  readonly onMachine: (name: string) => void
}) {
  const { machines } = useEnvironmentConnections()
  // Decided once: saving the new machine must not swap its form, error and draft for the list.
  const [adding, setAdding] = useState(() => machines.length === 0)
  const connect = useConnectMachine()
  const failure = connect.error ? clientErrorDescription(toClientError(connect.error)) : null

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onBack()
      }}
    >
      <DialogContent
        className='max-h-[calc(100dvh-2rem)] gap-(--density-section-gap) overflow-y-auto overscroll-contain sm:max-w-2xl'
        data-first-workspace-remote=''
      >
        <DialogHeader>
          <DialogTitle>Connect a remote machine</DialogTitle>
          <DialogDescription>
            Fregat connects to its server there, then lists that machine’s folders.
          </DialogDescription>
        </DialogHeader>
        {adding ? (
          <MachineForm
            intent='connect'
            onCancel={machines.length > 0 ? () => setAdding(false) : onBack}
            onSaved={onMachine}
          />
        ) : (
          <div className='flex flex-col gap-1'>
            {machines.map((machine) => (
              <Button
                key={machine.name}
                className='min-w-0 justify-between'
                disabled={connect.isPending}
                title={machine.name}
                type='button'
                variant='ghost'
                onClick={() => {
                  if (machine.phase === 'live') return onMachine(machine.name)
                  connect.mutate(machine.name, { onSuccess: onMachine })
                }}
              >
                <span className='min-w-0 truncate'>{machine.config.label ?? machine.name}</span>
                {connect.isPending && connect.variables === machine.name ? <Spinner /> : null}
                <span className='text-muted-foreground shrink-0'>
                  {machine.phase === 'live'
                    ? 'Connected'
                    : connectionNoticeSummary(machine.phase, machine.lastError)}
                </span>
              </Button>
            ))}
            {failure ? <InlineError message={failure} title='Connect machine' /> : null}
            <div className='flex justify-between gap-(--density-control-gap) pt-2'>
              <Button type='button' variant='ghost' onClick={onBack}>
                Back
              </Button>
              <Button
                disabled={connect.isPending}
                type='button'
                variant='secondary'
                onClick={() => setAdding(true)}
              >
                Add machine
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
