import { useQuery } from '@tanstack/react-query'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { fetchTailnetHosts } from '@/utils/machine-client'

export function useTailnetHosts() {
  return useQuery(
    {
      queryKey: ['machines', 'tailnet-hosts', primaryServerOrigin()],
      queryFn: ({ signal }) => fetchTailnetHosts(signal),
      staleTime: 0,
      retry: false,
    },
    primaryQueryClient(),
  )
}
