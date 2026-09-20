import { providerQueryKeys } from '@/lib/query-keys'
import { queryOptions } from '@tanstack/react-query'
import type { ProviderListResult } from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

const PROVIDER_LIST_STALE_TIME_MS = 60_000
const PROVIDER_LIST_GC_TIME_MS = 30 * 60_000

export function providerListQueryOptions() {
  return queryOptions({
    gcTime: PROVIDER_LIST_GC_TIME_MS,
    queryFn: ({ client }) => fetchProviders(clientForQueryClient(client)),
    queryKey: providerQueryKeys.list(),
    refetchOnWindowFocus: false,
    staleTime: PROVIDER_LIST_STALE_TIME_MS,
  })
}

async function fetchProviders(client: Client) {
  const response = await client.providers.get()
  if (response.error) throw createRpcError(response.error)

  return response.data as ProviderListResult
}
