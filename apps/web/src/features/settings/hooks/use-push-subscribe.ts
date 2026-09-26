import { useMutation } from '@tanstack/react-query'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import {
  pushDevicesQueryOptions,
  registerPushDevice,
  settlePushQueries,
} from '@/features/settings/utils/push-api'
import { requestPushPermission, subscribeThisDevice } from '@/features/settings/utils/push-browser'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function usePushSubscribe() {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.push.subscribe,
      mutationFn: async () => {
        // First, while the click still counts as a user gesture.
        await requestPushPermission()
        // `static` reuses cached devices, as ensureQueryData did, and fetches only on a miss.
        const { publicKey, devices } = await owner.query({
          ...pushDevicesQueryOptions(),
          staleTime: 'static',
        })
        const registration = await subscribeThisDevice(
          publicKey,
          devices.map((device) => device.id),
        )
        return registerPushDevice(clientForQueryClient(owner), registration)
      },
      onSettled: () => settlePushQueries(owner),
      retry: false,
    },
    owner,
  )
}
