import type { ScopedSessionRef } from '@workspace/contracts'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { sessionLifecyclePolicy } from '@/features/chat-mode/utils/session-lifecycle'

export function currentSessionLifecyclePolicy(ref: ScopedSessionRef) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
  const owner = Object.values(useEnvironmentsStore.getState().entries).find(
    (entry) => entry.environmentId === ref.environmentId,
  )
  return sessionLifecyclePolicy(
    slice.sessionById[ref.sessionId],
    owner,
    Object.values(slice.activityBySessionId[ref.sessionId] ?? {}),
  )
}
