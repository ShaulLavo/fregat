import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { useQuery } from '@tanstack/react-query'
import type { LogDashboardFilters } from '@workspace/contracts'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { fetchLogSummary } from '@/features/logs/utils/api'
import { logFilterQuery } from '@/features/logs/utils/filter-params'

export function useLogSummary(filters: LogDashboardFilters, enabled = true) {
  const queryFilters = logFilterQuery(filters)

  return useQuery({
    enabled,
    notifyOnChangeProps: ['data', 'isError', 'isFetching'],
    queryFn: ({ signal, client }) => fetchLogSummary(filters, signal, clientForQueryClient(client)),
    queryKey: logsKeys.summary(queryFilters),
    staleTime: 1_000,
  })
}
