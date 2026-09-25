import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQuery } from '@tanstack/react-query'

import { gitKeys } from '@/lib/query-keys'
import { fetchStatus } from '@/features/git/utils/api'

export function useStatus(rootPath: string | null) {
  return useQuery({
    enabled: Boolean(rootPath),
    queryFn: ({ signal, client }) =>
      fetchStatus(rootPath ?? '', signal, clientForQueryClient(client)),
    queryKey: gitKeys.status(rootPath ?? ''),
    staleTime: 1000,
  })
}
