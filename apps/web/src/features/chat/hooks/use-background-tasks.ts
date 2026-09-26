import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchBackgroundTasks } from '@/features/chat/transport/background-tasks'
import { backgroundTaskKeys } from '@/features/chat/utils/query-keys'

/** The roster only lives in the provider process, so it is re-read while the list is open. */
const ROSTER_REFRESH_MS = 3_000

export function useBackgroundTasks(ref: ScopedSessionRef, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: backgroundTaskKeys.roster(ref.environmentId, ref.sessionId),
    queryFn: ({ signal }) => fetchBackgroundTasks(ref, signal),
    refetchInterval: ROSTER_REFRESH_MS,
  })
}
