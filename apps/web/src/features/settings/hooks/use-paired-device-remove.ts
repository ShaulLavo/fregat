import { useMutation } from '@tanstack/react-query'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { settingsMutationKeys } from '@/features/settings/utils/mutation-keys'
import { removePairedDevice, settlePairedDevices } from '@/features/settings/utils/pairing-api'

export function usePairedDeviceRemove(deviceId: string) {
  const owner = useSettingsOwner()
  return useMutation(
    {
      mutationKey: settingsMutationKeys.pairing.remove(deviceId),
      mutationFn: () => removePairedDevice(clientForQueryClient(owner), deviceId),
      onSettled: () => settlePairedDevices(owner),
    },
    owner,
  )
}
