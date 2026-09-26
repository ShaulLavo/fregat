import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchSessionSchedules } from '@/features/chat/transport/session-schedules'
import { sessionScheduleKeys } from '@/features/chat/utils/query-keys'

/**
 * Read while the list is open or the session sleeps: the shell's wake time is fixed at the last
 * session event, and a recurring schedule's next fire moves on without one.
 */
export function useSessionSchedules(ref: ScopedSessionRef, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: sessionScheduleKeys.list(ref.environmentId, ref.sessionId),
    queryFn: ({ signal }) => fetchSessionSchedules(ref, signal),
    refetchInterval: 60_000,
  })
}
