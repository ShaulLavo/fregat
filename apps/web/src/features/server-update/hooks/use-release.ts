import { useQuery } from '@tanstack/react-query'

import { serverUpdateQueryKeys } from '@/features/server-update/utils/query-keys'
import { useSettingValue } from '@/hooks/use-setting-value'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientForQueryClient, primaryQueryClient } from '@/lib/environments/state/query-clients'

export function useRelease() {
  const queryClient = primaryQueryClient()
  const interval = useSettingValue('developer.clientUpdateCheckSeconds')
  return useQuery(
    {
      queryKey: serverUpdateQueryKeys.release(),
      queryFn: async () =>
        unwrapEdenResponse(await clientForQueryClient(queryClient).release.get(), {
          requireData: true,
        }),
      staleTime: 0,
      refetchInterval: interval * 1000,
      refetchOnWindowFocus: 'always',
    },
    queryClient,
  )
}
