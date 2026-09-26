import { useMutation } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import { toast } from 'sonner'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { updateProvider } from '@/features/settings/utils/provider-update-query'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { providerQueryKeys } from '@/lib/query-keys'
import { toastError } from '@/lib/toast-error'

export function useProviderUpdate(providerInstanceId: ProviderInstanceId, label: string) {
  const owner = useSettingsOwner()
  const mutationKey = settingsMutationKeys.providerUpdate(providerInstanceId)

  return useMutation(
    {
      mutationKey,
      mutationFn: () => updateProvider(providerInstanceId, clientForQueryClient(owner)),
      // A second click queues behind the first, and the server finds nothing left to do.
      scope: { id: mutationKey.join(':') },
      onSuccess: (result) => {
        owner.setQueryData(settingsQueryKeys.providerUpdate(providerInstanceId), result.advisory)
        void owner.invalidateQueries({ queryKey: providerQueryKeys.list() })
        const version = result.advisory.installedVersion
        if (result.outcome !== 'updated') return
        toast.success(version ? `Updated ${label} to ${version}` : `Updated ${label}`)
      },
      onError: (error) => {
        void owner.invalidateQueries({
          queryKey: settingsQueryKeys.providerUpdate(providerInstanceId),
        })
        toastError(`Could not update ${label}`, {
          description: clientErrorDescription(toClientError(error)),
        })
      },
    },
    owner,
  )
}
