import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { sendPushTest, settlePushQueries } from '@/features/settings/utils/push-api'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { toClientError } from '@/lib/client-error-taxonomy'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function usePushTest(deviceId: string) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.push.test(deviceId),
      mutationFn: () => sendPushTest(clientForQueryClient(owner), deviceId),
      onError: (error) => {
        // The server removed the expired device, so its row and inline error leave with it.
        const failure = toClientError(error)
        if (failure.code !== 'push.SUBSCRIPTION_EXPIRED') return
        toast.error(failure.message, { description: failure.fix })
      },
      onSettled: () => settlePushQueries(owner),
      retry: false,
    },
    owner,
  )
}
