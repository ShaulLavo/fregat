import { machineKeys } from '@/features/environments/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { fetchTailnetHosts } from '@/lib/environments/machine-client'

export function useTailnetHosts() {
  return useQuery(
    {
      queryKey: machineKeys.tailnetHosts(primaryServerOrigin()),
      queryFn: ({ signal }) => fetchTailnetHosts(signal),
      staleTime: 0,
      retry: false,
    },
    primaryQueryClient(),
  )
}
