import { useMutation } from '@tanstack/react-query'
import { fetchTerminalCheckout } from '@/features/terminal/state/register-checkout'
import { terminalMutationKeys } from '@/features/terminal/utils/mutation-keys'
import { notifyMutationError } from '@/features/terminal/utils/notify-mutation-error'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { unwrapEdenResponse } from '@/lib/eden-events'

export function useTerminalActions({
  rootPath,
  terminalId,
}: {
  rootPath: string
  terminalId: string
}) {
  return useMutation({
    mutationKey: terminalMutationKeys.control(terminalId),
    scope: { id: `terminal:${rootPath}:${terminalId}` },
    mutationFn: async (operation: 'clear' | 'restart', { client }) => {
      const worktreeId = await fetchTerminalCheckout(client, rootPath)
      // PTY viewers receive confirmed controls over their existing streaming transport.
      const terminal = clientForQueryClient(client).terminal
      const response =
        operation === 'clear'
          ? await terminal.clear.post({ worktreeId, terminalId })
          : await terminal.restart.post({ worktreeId, terminalId })
      return unwrapEdenResponse<unknown>(response, {
        requireData: true,
        emptyMessage: 'Terminal action returned no result.',
      })
    },
    onError: notifyMutationError,
  })
}
