import { useQuery } from '@tanstack/react-query'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { fetchSshHosts } from '@/utils/machine-client'

export function useSshHosts() {
  return useQuery(
    {
      queryKey: ['machines', 'ssh-hosts', primaryServerOrigin()],
      queryFn: ({ signal }) => fetchSshHosts(signal),
      staleTime: 0,
      retry: false,
    },
    primaryQueryClient(),
  )
}
