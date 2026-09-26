import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { SessionId } from '@workspace/contracts'

import { selectChatSessionHasEarlier } from '@workspace/client-core/chat/selectors'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import { useSyncExternalStore } from 'react'
import { errorMessage } from '@/lib/error-message'

/** Everything the timeline needs to offer, run and report one backwards page. */
export function useSessionEarlierPage(sessionId: SessionId | null | undefined) {
  const transport = useChatTransport()
  const hasEarlier = useActiveChatProjection((state) =>
    selectChatSessionHasEarlier(state, sessionId),
  )
  const observer = transport.earlierPageObserver(sessionId ?? null)
  const result = useSyncExternalStore(
    observer.subscribe,
    () => observer.getCurrentResult(),
    () => observer.getCurrentResult(),
  )
  const pending = result.isFetching
  const error = result.error
    ? errorMessage(result.error, 'Earlier messages could not be loaded.')
    : null
  const loadEarlier = () => {
    if (!sessionId) return

    void transport.loadEarlierPage(sessionId)
  }

  return { error, hasEarlier, loadEarlier, pending }
}
