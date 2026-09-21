import { useQueryClient } from '@tanstack/react-query'
import type { LogDashboardFilters, LogEventsResult, LogLiveStreamItem } from '@workspace/contracts'
import { useEffect, useMemo } from 'react'

import { logsKeys } from '@/features/logs/utils/query-keys'
import { subscribeLogEvents } from '@/features/logs/utils/api'
import { createLiveEventBatcher } from '@/features/logs/state/live-batcher'
import { logFilterQuery } from '@/features/logs/utils/filter-params'
import { mergeLiveLogItems } from '@/features/logs/state/live-cache'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

export function useLogLive(filters: LogDashboardFilters, enabled: boolean) {
  const queryClient = useQueryClient()
  // Manual memo: `queryFilters` is a useEffect dependency, and the compiler's cache is a
  // cache, not an identity guarantee — when it recomputes, the useEffect re-runs.
  const queryFilters = useMemo(() => logFilterQuery(filters), [filters])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    const batcher = createLiveEventBatcher<Extract<LogLiveStreamItem, { kind: 'event' }>>(
      (events) => {
        queryClient.setQueryData<LogEventsResult>(logsKeys.events(queryFilters), (current) =>
          mergeLiveLogItems(current, events),
        )
      },
    )

    void runLogLiveStream(
      filters,
      controller.signal,
      (item) => {
        if (item.kind !== 'event') return

        batcher.push(item)
      },
      clientForQueryClient(queryClient),
    )

    return () => {
      controller.abort()
      batcher.cancel()
    }
  }, [enabled, filters, queryClient, queryFilters])
}

async function runLogLiveStream(
  filters: LogDashboardFilters,
  signal: AbortSignal,
  onItem: (item: LogLiveStreamItem) => void,
  client: Client,
) {
  try {
    for await (const item of subscribeLogEvents(filters, signal, client)) {
      if (signal.aborted) return

      onItem(item)
    }
  } catch {
    // Live logging is opportunistic. History refresh still works if the stream drops.
  }
}
