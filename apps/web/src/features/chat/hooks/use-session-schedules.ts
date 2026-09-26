import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchSessionSchedules } from '@/features/chat/transport/session-schedules'
import { sessionScheduleKeys } from '@/features/chat/utils/query-keys'

/** Read while the list is open; the next fire times move with the clock. */
export function useSessionSchedules(ref: ScopedSessionRef, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: sessionScheduleKeys.list(ref.environmentId, ref.sessionId),
    queryFn: ({ signal }) => fetchSessionSchedules(ref, signal),
    refetchInterval: 30_000,
  })
}
