import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchSessionMcp } from '@/features/chat/transport/session-tools'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'

/** Server states change under the session (a server starts, a token expires), so each open re-reads. */
export function useSessionMcp(ref: ScopedSessionRef, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: sessionToolKeys.mcp(ref.environmentId, ref.sessionId),
    queryFn: ({ signal }) => fetchSessionMcp(ref, signal),
    staleTime: 0,
  })
}
