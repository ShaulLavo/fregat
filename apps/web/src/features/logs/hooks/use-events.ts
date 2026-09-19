import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { LogDashboardFilters } from '@workspace/contracts'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { fetchLogEvents } from '@/features/logs/utils/api'
import { logFilterQuery } from '@/features/logs/utils/filter-params'

export function useLogEvents(filters: LogDashboardFilters, enabled = true) {
  const queryFilters = logFilterQuery(filters)

  return useQuery({
    enabled,
    notifyOnChangeProps: ['data', 'isError'],
    // A filter change keeps the last answer up until the new one lands.
    placeholderData: keepPreviousData,
    queryFn: ({ signal, client }) => fetchLogEvents(filters, signal, clientForQueryClient(client)),
    queryKey: logsKeys.events(queryFilters),
    staleTime: 1_000,
  })
}
