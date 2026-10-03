import { queryOptions } from '@tanstack/react-query'
import type { ProviderUsageHistory } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import type { UsageDays } from '@/features/settings/utils/usage'

// Local transcript collection runs independently; mounted views follow its cached report.
const USAGE_HISTORY_STALE_TIME_MS = 60_000

export function usageHistoryQueryOptions(days: UsageDays, utcOffsetMinutes: number) {
  return queryOptions({
    queryFn: ({ client }) =>
      fetchUsageHistory(clientForQueryClient(client), days, utcOffsetMinutes),
    queryKey: settingsQueryKeys.usageHistory(days, utcOffsetMinutes),
    staleTime: USAGE_HISTORY_STALE_TIME_MS,
    refetchInterval: USAGE_HISTORY_STALE_TIME_MS,
  })
}

async function fetchUsageHistory(client: Client, days: UsageDays, utcOffsetMinutes: number) {
  const response = await client.providers.usage.history.get({
    query: { days, utcOffsetMinutes },
  })
  if (response.error) throw createRpcError(response.error)

  return response.data as ProviderUsageHistory
}
