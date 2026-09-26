import { useQuery } from '@tanstack/react-query'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { pairedDevicesQueryOptions } from '@/features/settings/utils/pairing-api'

export function usePairedDevices() {
  return useQuery(pairedDevicesQueryOptions(), useSettingsOwner())
}
