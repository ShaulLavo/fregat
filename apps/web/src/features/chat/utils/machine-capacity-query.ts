import { queryOptions } from '@tanstack/react-query'
import type { EnvironmentId } from '@workspace/contracts'
import { requireEdenData } from '@workspace/client-core/transport/eden'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { machineCapacityKeys } from './query-keys'

export function machineCapacityQueryOptions(environmentId: EnvironmentId, origin: string) {
  return queryOptions({
    queryKey: machineCapacityKeys.resources(environmentId, origin),
    queryFn: async ({ signal }) =>
      requireEdenData(
        await clientForQueryClient(queryClientFor(origin)).machines.resources.get({
          fetch: { signal },
        }),
      ),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
