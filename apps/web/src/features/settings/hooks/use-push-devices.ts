import { useQuery } from '@tanstack/react-query'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { pushDevicesQueryOptions } from '@/features/settings/utils/push-api'

export function usePushDevices(enabled: boolean) {
  const owner = useSettingsOwner()
  return useQuery({ ...pushDevicesQueryOptions(), enabled }, owner)
}
