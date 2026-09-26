import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { LogDashboardFilters } from '@workspace/contracts'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { fetchLogSummary } from '@workspace/client-core/logs/api'
import { logFilterQuery } from '@workspace/client-core/logs/filters'

export function useLogSummary(filters: LogDashboardFilters, enabled = true) {
  const queryFilters = logFilterQuery(filters)

  return useQuery({
    enabled,
    notifyOnChangeProps: ['data', 'isError', 'isFetching'],
    // A filter change keeps the last answer up until the new one lands.
    placeholderData: keepPreviousData,
    queryFn: ({ signal, client }) => fetchLogSummary(filters, signal, clientForQueryClient(client)),
    queryKey: logsKeys.summary(queryFilters),
    staleTime: 1_000,
  })
}
