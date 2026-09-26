import { useQuery, type QueryClient } from '@tanstack/react-query'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

import { fetchSettings } from '@/features/settings/utils/api'
import {
  beginSettingsSnapshotRead,
  observeInitialSettingsSnapshot,
} from '@/features/settings/state/snapshot-admission'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

/** The confirmed document exactly as the server last acknowledged it. */
export function useSettingsDocument(owner?: QueryClient) {
  const settingsOwner = useSettingsOwner()
  return useQuery(
    {
      queryFn: async ({ signal, client: queryClient }) => {
        const token = beginSettingsSnapshotRead(queryClient)
        const snapshot = await fetchSettings(signal, clientForQueryClient(queryClient))
        return observeInitialSettingsSnapshot(queryClient, snapshot, token)
      },
      queryKey: settingsKeys.document(),
      staleTime: Number.POSITIVE_INFINITY,
    },
    owner ?? settingsOwner,
  )
}
