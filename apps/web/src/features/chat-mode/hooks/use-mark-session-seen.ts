import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import type { SessionId } from '@workspace/contracts'
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'

export function useMarkSessionSeen(sessionId: SessionId | null, visitedAt: string | null) {
  const environmentId = useEnvironmentId()
  const { mutate } = useMutation({
    mutationKey: chatModeMutationKeys.read(),
    mutationFn: async (visit: { sessionId: SessionId; visitedAt: string }) => {
      useSessionReadStore
        .getState()
        .markSeen({ environmentId, sessionId: visit.sessionId }, visit.visitedAt)
    },
  })
  useEffect(() => {
    if (!sessionId || !visitedAt) return
    function visit() {
      if (document.visibilityState !== 'visible' || !sessionId || !visitedAt) return
      mutate({ sessionId, visitedAt })
    }
    visit()
    document.addEventListener('visibilitychange', visit)
    return () => document.removeEventListener('visibilitychange', visit)
  }, [environmentId, visitedAt, sessionId, mutate])
}
