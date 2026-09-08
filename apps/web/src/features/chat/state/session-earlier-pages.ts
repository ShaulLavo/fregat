import type { EnvironmentId, SessionId } from '@workspace/contracts'

import { errorMessage } from '@/lib/error-message'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createChatPipelineScope } from '@/features/chat/utils/pipeline-logging'
import {
  chatSessionEarlierPageInput,
  selectChatSessionHasEarlier,
} from '@workspace/client-core/chat/selectors'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
  type ChatProjectionStore,
} from './chat-projection-store'
import { useSessionEarlierPageStore } from './session-earlier-page-store'

type ChatProjectionStoreAccess = {
  getState: () => ChatProjectionStore
}

export type SessionEarlierPageLoader = {
  load: (sessionId: SessionId) => Promise<boolean>
  dispose(): void
}

/**
 * Walks a session backwards one page at a time.
 *
 * The boundary is read imperatively at request time rather than captured when
 * the affordance rendered: a live append or a reconnect between the click and
 * the request must not make the walk skip rows or re-fetch the same page.
 */
export function createSessionEarlierPageLoader({
  transport,
  environmentId,
  store = useChatProjectionStore,
}: {
  environmentId: EnvironmentId
  transport: Pick<ChatTransport, 'sessionDetailPage'>
  store?: ChatProjectionStoreAccess
}): SessionEarlierPageLoader {
  let disposed = false
  const inFlight = new Map<SessionId, Promise<boolean>>()

  async function loadPage(sessionId: SessionId) {
    const scope = createChatPipelineScope('chat.session_earlier_page.summary', { sessionId })
    const pageStore = useSessionEarlierPageStore.getState()
    pageStore.setSessionEarlierPage({ environmentId, sessionId }, { error: null, pending: true })

    try {
      const page = await transport.sessionDetailPage(
        chatSessionEarlierPageInput(
          selectChatProjectionSlice(store.getState(), environmentId),
          sessionId,
        ),
      )
      if (disposed) return false
      store.getState().prependSessionDetailPage(environmentId, page)
      scope.set({
        activityCount: page.activities.length,
        hasEarlier: page.hasEarlier,
        messageCount: page.messages.length,
        outcome: 'ok',
      })
      useSessionEarlierPageStore
        .getState()
        .setSessionEarlierPage({ environmentId, sessionId }, { error: null, pending: false })

      return true
    } catch (error) {
      if (disposed) return false
      const message = errorMessage(error, 'Earlier messages could not be loaded.')
      scope.error(error)
      scope.set({ outcome: 'error' })
      useSessionEarlierPageStore
        .getState()
        .setSessionEarlierPage({ environmentId, sessionId }, { error: message, pending: false })

      return false
    } finally {
      scope.end({})
      inFlight.delete(sessionId)
    }
  }

  return {
    dispose: () => {
      disposed = true
      for (const sessionId of inFlight.keys()) {
        useSessionEarlierPageStore.getState().clearSessionEarlierPage({ environmentId, sessionId })
      }
      inFlight.clear()
    },
    load: (sessionId) => {
      if (disposed) return Promise.resolve(false)
      // Exhausted sessions answer without a round trip: the affordance can lag a
      // frame behind the last page, and a double-click must not cost two scans.
      if (
        !selectChatSessionHasEarlier(
          selectChatProjectionSlice(store.getState(), environmentId),
          sessionId,
        )
      )
        return Promise.resolve(false)

      const existing = inFlight.get(sessionId)
      if (existing) return existing

      const request = loadPage(sessionId)
      inFlight.set(sessionId, request)

      return request
    },
  }
}
