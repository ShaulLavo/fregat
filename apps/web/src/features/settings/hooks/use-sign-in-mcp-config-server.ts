import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'

import { signInMcpServer } from '@/features/settings/utils/mcp-query'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { toastError } from '@/lib/toast-error'

/** Starts the harness's sign-in on the machine that owns the settings; the page link comes back. */
export function useSignInMcpConfigServer(
  providerInstanceId: ProviderInstanceId,
  name: string,
  folder: string | null,
) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.mcp.signIn(providerInstanceId, name),
      mutationFn: () => signInMcpServer(owner, providerInstanceId, name, folder),
      onError: (error) =>
        toastError(`Could not start the sign-in to ${name}`, {
          description: clientErrorDescription(toClientError(error)),
        }),
      retry: false,
    },
    owner,
  )
}
