import type { Client } from '@/lib/client'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { registerTerminalCheckout } from '@/features/terminal/state/register-checkout'

// For a tab with no mounted panel: the shell would otherwise run until the detach timeout.
export function killTerminalSession({
  client,
  origin,
  rootPath,
  terminalId,
}: {
  client: Client
  origin: string
  rootPath: string
  terminalId: string
}) {
  const signal = environmentActivitySignal(origin)
  void registerTerminalCheckout({ client, origin, rootPath, signal })
    .then((worktreeId) => client.terminal.kill.post({ terminalId, worktreeId }))
    .catch((error: unknown) => {
      if (signal.aborted) return

      reportError(toClientError(error))
    })
}
