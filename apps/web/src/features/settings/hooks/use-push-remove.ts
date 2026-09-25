import { useMutation } from '@tanstack/react-query'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { removePushDevice, settlePushQueries } from '@/features/settings/utils/push-api'
import { unsubscribeThisDevice } from '@/features/settings/utils/push-browser'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

/** The server forgets the device first, so a failed browser unsubscribe never leaves it pushing. */
export function usePushRemove(deviceId: string, thisDevice: boolean) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.push.remove(deviceId),
      mutationFn: async () => {
        await removePushDevice(clientForQueryClient(owner), deviceId)
        if (thisDevice) await unsubscribeThisDevice()
      },
      onSettled: () => settlePushQueries(owner),
      retry: false,
    },
    owner,
  )
}
