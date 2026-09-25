import { useQuery } from '@tanstack/react-query'

import { useSettingsOwner } from '@/features/settings/hooks/use-settings-owner'
import { pushThisDeviceQueryOptions } from '@/features/settings/utils/push-browser'

export function usePushThisDevice() {
  const owner = useSettingsOwner()
  return useQuery(pushThisDeviceQueryOptions(), owner)
}
