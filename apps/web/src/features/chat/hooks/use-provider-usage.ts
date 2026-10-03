import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProviderInstanceId, SessionId } from '@workspace/contracts'
import { useEffect } from 'react'

import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { providerUsageQueryOptions } from '@/lib/provider-usage'
import { providerUsageKeys } from '@/features/chat/utils/query-keys'
import { accountsUsageFor } from '@/lib/provider-usage'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'

// The mapped account group follows bounded cache reads even while the composer is idle.
export function useProviderUsage(
  providerInstanceId: ProviderInstanceId | null | undefined,
  sessionId: SessionId | null,
) {
  const queryClient = useQueryClient()
  const settledAt = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.latestTurn?.completedAt ?? null,
  )
  const { data, dataUpdatedAt } = useQuery(providerUsageQueryOptions())

  useEffect(() => {
    if (!settledAt) return

    // Joins a fetch already in flight, such as the query's own first read on mount.
    void queryClient.invalidateQueries(
      { queryKey: providerUsageKeys.all },
      { cancelRefetch: false },
    )
  }, [queryClient, settledAt])

  return { accounts: accountsUsageFor(data, providerInstanceId), receivedAtMs: dataUpdatedAt }
}
