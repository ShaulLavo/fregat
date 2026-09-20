import { unwrapEdenResponse } from '@/lib/eden-events'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import { terminalKillScope, terminalMutationKeys } from '@/features/terminal/utils/mutation-keys'
import { notifyMutationError } from '@/features/terminal/utils/notify-mutation-error'

// Closing an unmounted tab must still terminate its server-owned shell.
export function killTerminalSession({
  origin,
  rootPath,
  terminalId,
}: {
  origin: string
  rootPath: string
  terminalId: string
}) {
  const signal = environmentActivitySignal(origin)
  void runMutation(
    queryClientFor(origin),
    {
      mutationFn: async (_variables: void, { client }) => {
        const worktreeId = await fetchTerminalCheckout(client, rootPath)
        const response = await clientForQueryClient(client).terminal.kill.post(
          { terminalId, worktreeId },
          { fetch: { signal } },
        )
        unwrapEdenResponse(response, {
          requireData: true,
          emptyMessage: 'Terminal close returned no result.',
        })
      },
      mutationKey: terminalMutationKeys.kill(terminalId),
      onError: (error) => {
        if (!signal.aborted) notifyMutationError(error)
      },
      scope: { id: terminalKillScope(terminalId) },
    },
    undefined,
  ).catch(() => undefined)
}
