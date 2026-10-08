import { useQuery } from '@tanstack/react-query'

import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { pairingStatusQueryOptions } from '@/lib/pairing/utils/api'

export function usePairingStatus() {
  return useQuery(pairingStatusQueryOptions(), useSettingsOwner())
}
