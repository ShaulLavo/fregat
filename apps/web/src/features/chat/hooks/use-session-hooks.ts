import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import { fetchSessionHooks } from '@/features/chat/transport/session-tools'
import { sessionToolKeys } from '@/features/chat/utils/query-keys'

export function useSessionHooks(ref: ScopedSessionRef, enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: sessionToolKeys.hooks(ref.environmentId, ref.sessionId),
    queryFn: ({ signal }) => fetchSessionHooks(ref, signal),
    staleTime: 0,
  })
}
