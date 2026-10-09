import { QueryClientProvider } from '@tanstack/react-query'

import { LocalPicker } from '@/features/onboarding/components/local-picker'
import type { ConfirmedMachine } from '@/lib/environments/utils/machines'
import { queryClientFor } from '@/lib/environments/state/query-clients'

/**
 * The local path's folder step, on the primary server's client. The entry picker keeps its
 * policy: the native chooser only where the server reports one on this desktop, the in-app
 * picker everywhere else.
 */
export function LocalFolder({
  machine,
  onCancel,
  onPick,
}: {
  readonly machine: ConfirmedMachine
  readonly onCancel: () => void
  readonly onPick: (machine: ConfirmedMachine, path: string) => void
}) {
  return (
    <QueryClientProvider client={queryClientFor(machine.origin)}>
      <LocalPicker machine={machine} onCancel={onCancel} onPick={onPick} />
    </QueryClientProvider>
  )
}
