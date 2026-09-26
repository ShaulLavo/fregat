import { useQuery } from '@tanstack/react-query'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { pushDevicesQueryOptions } from '@/features/settings/utils/push-api'

/** Off while another service worker owns the page: the demo's mock backend has no push routes. */
export function usePushDevices(enabled: boolean) {
  const owner = useSettingsOwner()
  return useQuery({ ...pushDevicesQueryOptions(), enabled }, owner)
}
