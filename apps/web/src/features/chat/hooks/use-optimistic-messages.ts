import type { EnvironmentId, SessionId } from '@workspace/contracts'
import {} from 'react'
import { useStore } from 'zustand'

import {
  chatMessageIntents,
  createOptimisticMessagesForSessionSelector,
} from '@/features/chat/state/chat-message-intents'

export function useOptimisticMessages(environmentId: EnvironmentId, sessionId: SessionId | null) {
  // Stable identity is required: the selector memoizes on the queue's active list.
  const selector = createOptimisticMessagesForSessionSelector(
    sessionId ? { environmentId, sessionId } : null,
  )

  return useStore(chatMessageIntents, selector)
}
