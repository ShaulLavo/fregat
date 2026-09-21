import { useMemo } from 'react'
import type { EnvironmentId, SessionId } from '@workspace/contracts'
import { useStore } from 'zustand'

import {
  chatMessageIntents,
  createOptimisticMessagesForSessionSelector,
} from '@/features/chat/state/chat-message-intents'

export function useOptimisticMessages(environmentId: EnvironmentId, sessionId: SessionId | null) {
  // Stable identity is required: the selector memoizes on the queue's active list.
  // Manual memo: the store keys on this selector's identity, and the compiler's cache is a cache, not an identity
  // guarantee — a recompute hands it a cold value every render.
  const selector = useMemo(
    () =>
      createOptimisticMessagesForSessionSelector(sessionId ? { environmentId, sessionId } : null),
    [environmentId, sessionId],
  )

  return useStore(chatMessageIntents, selector)
}
