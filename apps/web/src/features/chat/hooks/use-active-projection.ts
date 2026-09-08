import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import { type ChatProjectionSlice } from '@workspace/client-core/chat/types'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'

export function useActiveChatProjection<T>(selector: (slice: ChatProjectionSlice) => T): T {
  const environmentId = useEnvironmentId()
  return useChatProjectionStore((state) =>
    selector(selectChatProjectionSlice(state, environmentId)),
  )
}
