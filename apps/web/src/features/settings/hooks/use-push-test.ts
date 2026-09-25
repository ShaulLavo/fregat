import { useMutation } from '@tanstack/react-query'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { sendPushTest, settlePushQueries } from '@/features/settings/utils/push-api'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function usePushTest(deviceId: string) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.push.test(deviceId),
      mutationFn: () => sendPushTest(clientForQueryClient(owner), deviceId),
      onSettled: () => settlePushQueries(owner),
      retry: false,
    },
    owner,
  )
}
