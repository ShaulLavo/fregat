import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type { SessionId } from '@workspace/contracts'

import { selectChatSessionHasEarlier } from '@workspace/client-core/chat/selectors'
import { useChatTransport } from '@/features/chat/hooks/use-chat-transport'
import {
  selectSessionEarlierPage,
  useSessionEarlierPageStore,
} from '../state/session-earlier-page-store'

/** Everything the timeline needs to offer, run and report one backwards page. */
export function useSessionEarlierPage(sessionId: SessionId | null | undefined) {
  const transport = useChatTransport()
  const hasEarlier = useActiveChatProjection((state) =>
    selectChatSessionHasEarlier(state, sessionId),
  )
  const { error, pending } = useSessionEarlierPageStore((state) =>
    selectSessionEarlierPage(
      state,
      sessionId ? { environmentId: transport.environmentId, sessionId } : null,
    ),
  )
  const loadEarlier = () => {
    if (!sessionId) return

    void transport.loadEarlierPage(sessionId)
  }

  return { error, hasEarlier, loadEarlier, pending }
}
