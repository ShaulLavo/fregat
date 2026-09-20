import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { runMutation } from '@/lib/mutations/run'
import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import { terminalKillScope, terminalMutationKeys } from '@/features/terminal/utils/mutation-keys'
import { notifyMutationError } from '@/features/terminal/utils/notify-mutation-error'

// For a tab with no mounted panel: the shell would otherwise run until the detach timeout.
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
        await clientForQueryClient(client).terminal.kill.post(
          { terminalId, worktreeId },
          { fetch: { signal } },
        )
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
