import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProviderInstanceId, SessionId } from '@workspace/contracts'
import { useEffect } from 'react'

import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import { providerUsageQueryOptions } from '@/features/chat/utils/provider-usage-query'
import { providerUsageKeys } from '@/features/chat/utils/query-keys'
import { accountUsageFor, usageRefetchIntervalMs } from '@/features/chat/utils/usage-meter'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'

/**
 * The plan windows of the account behind `providerInstanceId`. Providers report them
 * during a turn, so a running turn polls and a settled one refetches at once.
 */
export function useProviderUsage(
  providerInstanceId: ProviderInstanceId | null | undefined,
  sessionId: SessionId | null,
) {
  const queryClient = useQueryClient()
  const running = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.latestTurn?.state === 'running',
  )
  const settledAt = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.latestTurn?.completedAt ?? null,
  )
  const { data } = useQuery({
    ...providerUsageQueryOptions(),
    // A long turn can reach a limit halfway; the store answers from memory between probes.
    refetchInterval: (query) =>
      running
        ? usageRefetchIntervalMs(
            accountUsageFor(query.state.data, providerInstanceId)?.windows ?? [],
          )
        : false,
  })

  useEffect(() => {
    if (!settledAt) return

    // Joins a fetch already in flight, such as the query's own first read on mount.
    void queryClient.invalidateQueries(
      { queryKey: providerUsageKeys.all },
      { cancelRefetch: false },
    )
  }, [queryClient, settledAt])

  return accountUsageFor(data, providerInstanceId)
}
