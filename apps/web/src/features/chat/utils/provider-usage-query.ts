import { queryOptions } from '@tanstack/react-query'
import type {
  ProviderUsageResult,
  ProviderUsageSessionTotal,
  ScopedSessionRef,
} from '@workspace/contracts'

import { environmentClientFor, type Client } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'
import { providerUsageKeys } from '@/features/chat/utils/query-keys'

// Windows move by the turn, and a finished turn refetches on its own.
const PROVIDER_USAGE_STALE_TIME_MS = 60_000

export function providerUsageQueryOptions() {
  return queryOptions({
    queryFn: ({ client }) => fetchProviderUsage(clientForQueryClient(client)),
    queryKey: providerUsageKeys.all,
    staleTime: PROVIDER_USAGE_STALE_TIME_MS,
  })
}

async function fetchProviderUsage(client: Client) {
  const response = await client.providers.usage.get()
  if (response.error) throw createRpcError(response.error)

  return response.data as ProviderUsageResult
}

/** Refreshed with the meter: a settled turn invalidates every key under `providerUsageKeys.all`. */
export function sessionUsageTotalQueryOptions(ref: ScopedSessionRef, enabled: boolean) {
  return queryOptions({
    enabled,
    queryFn: () => fetchSessionUsageTotal(ref),
    queryKey: providerUsageKeys.session(ref.environmentId, ref.sessionId),
    staleTime: PROVIDER_USAGE_STALE_TIME_MS,
  })
}

async function fetchSessionUsageTotal(ref: ScopedSessionRef) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(ref.environmentId))
  const response = await client.providers.usage.sessions({ sessionId: ref.sessionId }).get()
  if (response.error) throw createRpcError(response.error)

  return response.data as ProviderUsageSessionTotal
}
