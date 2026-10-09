import { usePickEntry } from '@/components/use-pick-entry'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'

/** Inside the primary server's query client, so the picker asks that server. */
export function LocalPicker({
  machine,
  onCancel,
  onPick,
}: {
  readonly machine: ConfirmedMachine
  readonly onCancel: () => void
  readonly onPick: (machine: ConfirmedMachine, path: string) => void
}) {
  return usePickEntry({
    open: true,
    value: null,
    onOpenChange: (open) => {
      if (!open) onCancel()
    },
    onPick: (entry) => onPick(machine, entry.path),
  })
}
