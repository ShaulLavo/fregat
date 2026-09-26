import type { EnvironmentId } from '@workspace/contracts'
import type { QueryClient } from '@tanstack/query-core'
import { createSessionEarlierPages } from '@workspace/client-core/chat/earlier-pages'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createChatPipelineScope } from '@/features/chat/utils/pipeline-logging'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
  type ChatProjectionStore,
} from './chat-projection-store'

type ChatProjectionStoreAccess = { getState: () => ChatProjectionStore }

export function createSessionEarlierPageLoader({
  transport,
  environmentId,
  queryClient,
  store = useChatProjectionStore,
}: {
  environmentId: EnvironmentId
  queryClient: QueryClient
  transport: Pick<ChatTransport, 'sessionDetailPage'>
  store?: ChatProjectionStoreAccess
}) {
  return createSessionEarlierPages({
    environmentId,
    queryClient,
    projection: () => selectChatProjectionSlice(store.getState(), environmentId),
    prepend: (page) => store.getState().prependSessionDetailPage(environmentId, page),
    read: async (input) => {
      const scope = createChatPipelineScope('chat.session_earlier_page.summary', {
        sessionId: input.sessionId,
      })
      try {
        const page = await transport.sessionDetailPage(input)
        scope.set({
          activityCount: page.activities.length,
          hasEarlier: page.hasEarlier,
          messageCount: page.messages.length,
          outcome: 'ok',
        })
        return page
      } catch (error) {
        scope.error(error)
        scope.set({ outcome: 'error' })
        throw error
      } finally {
        scope.end({})
      }
    },
  })
}
