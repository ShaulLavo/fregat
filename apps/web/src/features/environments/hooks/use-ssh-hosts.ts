import { machineKeys } from '@/features/environments/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
import { primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { fetchSshHosts } from '@/lib/environments/machine-client'

export function useSshHosts() {
  return useQuery(
    {
      queryKey: machineKeys.sshHosts(primaryServerOrigin()),
      queryFn: ({ signal }) => fetchSshHosts(signal),
      staleTime: 0,
      retry: false,
    },
    primaryQueryClient(),
  )
}
