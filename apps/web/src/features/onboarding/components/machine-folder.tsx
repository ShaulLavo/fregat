import { QueryClientProvider } from '@tanstack/react-query'

import { DeferredFilePickerDialog } from '@/components/deferred-file-picker-dialog'
import { useConnectedMachines } from '@/hooks/use-connected-machines'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { ProgressDialog } from '@/features/onboarding/components/progress-dialog'
import { connectionFailure } from '@/features/onboarding/utils/connection-failure'

/**
 * The remote path's folder step. Folder reads wait for the machine's confirmed identity, then go
 * through that machine's own client, so the picker lists its files and nobody else's.
 */
export function MachineFolder({
  name,
  onBack,
  onPick,
}: {
  readonly name: string
  readonly onBack: () => void
  readonly onPick: (machine: ConfirmedMachine, path: string) => void
}) {
  const { machines } = useEnvironmentConnections()
  const confirmed = useConnectedMachines()
  const record = machines.find((machine) => machine.name === name)
  const label = record?.config.label ?? name
  const machine = confirmed.find(
    (entry) =>
      entry.kind !== 'primary' &&
      entry.environmentId === record?.environmentId &&
      entry.phase === 'live',
  )

  if (!machine) {
    const error = connectionFailure(record, label)
    return (
      <ProgressDialog
        detail={`Fregat lists the folders on ${label} once it confirms which machine answered.`}
        error={error}
        title={error ? `${label} is not connected` : `Connecting to ${label}`}
        onCancel={onBack}
      />
    )
  }
  return (
    <QueryClientProvider key={machine.environmentId} client={queryClientFor(machine.origin)}>
      <DeferredFilePickerDialog
        open
        mode='folder'
        value={null}
        onOpenChange={(open) => {
          if (!open) onBack()
        }}
        onPick={(entry) => onPick(machine, entry.path)}
      />
    </QueryClientProvider>
  )
}
