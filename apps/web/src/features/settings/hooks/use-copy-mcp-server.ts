import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId, ProviderMcpCopyBody } from '@workspace/contracts'
import { toast } from 'sonner'

import { copyMcpServer, settleMcpQueries } from '@/features/settings/utils/mcp-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { toastError } from '@/lib/toast-error'

/** The definition, secrets included, moves server-side; the page only names the target. */
export function useCopyMcpServer(providerInstanceId: ProviderInstanceId, name: string) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.mcp.copy(providerInstanceId, name),
      mutationFn: (input: { body: ProviderMcpCopyBody; targetLabel: string }) =>
        copyMcpServer(owner, providerInstanceId, name, input.body),
      onSuccess: async (_result, input) => {
        await settleMcpQueries(owner)
        toast.success(`Added ${name} to ${input.targetLabel}`)
      },
      onError: (error, input) => {
        toastError(`Could not add ${name} to ${input.targetLabel}`, {
          description: clientErrorDescription(toClientError(error)),
        })
      },
      retry: false,
    },
    owner,
  )
}
