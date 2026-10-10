import { queryOptions, type QueryClient } from '@tanstack/react-query'

import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { attachmentQueryKeys } from './query-keys'

const LOCALITY_STALE_MS = 5 * 60_000

/**
 * True when this device verifiably is the machine `queryClient` talks to: the native-chooser
 * policy's verified local-desktop capability. The picker policy loads with the answer, so a
 * composer that never asks does not carry it.
 */
export function machineLocalOptions(queryClient: QueryClient) {
  return queryOptions({
    queryKey: attachmentQueryKeys.machineLocal(),
    retry: false,
    staleTime: LOCALITY_STALE_MS,
    queryFn: async () => {
      const { nativePickerCapabilitiesOptions } = await import('@/components/utils/native-picker')
      const capabilities = await queryClient.query(
        nativePickerCapabilitiesOptions(clientForQueryClient(queryClient)),
      )
      return capabilities?.nativePicker === true
    },
  })
}
