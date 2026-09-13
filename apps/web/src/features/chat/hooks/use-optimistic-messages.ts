import type { EnvironmentId, SessionId } from '@workspace/contracts'
import { useMemo } from 'react'
import { useStore } from 'zustand'

import {
  chatMessageIntents,
  createOptimisticMessagesForSessionSelector,
} from '@/features/chat/state/chat-message-intents'

export function useOptimisticMessages(environmentId: EnvironmentId, sessionId: SessionId | null) {
  // Stable identity is required: the selector memoizes on the queue's active list.
  const selector = useMemo(
    () =>
      createOptimisticMessagesForSessionSelector(sessionId ? { environmentId, sessionId } : null),
    [environmentId, sessionId],
  )

  return useStore(chatMessageIntents, selector)
}
