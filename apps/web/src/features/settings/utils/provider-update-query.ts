import { queryOptions } from '@tanstack/react-query'
import type {
  ProviderInstanceId,
  ProviderUpdateAdvisory,
  ProviderUpdateResult,
} from '@workspace/contracts'

import { settingsQueryKeys } from '@/features/settings/utils/query-keys'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/** The server re-reads the published version at most hourly; the CLI version is local. */
const UPDATE_STALE_TIME_MS = 10 * 60_000

export function providerUpdateQueryOptions(providerInstanceId: ProviderInstanceId) {
  return queryOptions({
    queryFn: async ({ client }) => {
      const response = await clientForQueryClient(client)
        .providers({ providerInstanceId })
        .update.get()
      if (response.error) throw createRpcError(response.error)
      return response.data as ProviderUpdateAdvisory
    },
    queryKey: settingsQueryKeys.providerUpdate(providerInstanceId),
    refetchOnWindowFocus: false,
    staleTime: UPDATE_STALE_TIME_MS,
  })
}

export async function updateProvider(providerInstanceId: ProviderInstanceId, client: Client) {
  const response = await client.providers({ providerInstanceId }).update.post()
  if (response.error) throw createRpcError(response.error)
  return response.data as ProviderUpdateResult
}
