import { useShallow } from 'zustand/react/shallow'
import type { ScopedSessionRef } from '@workspace/contracts'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { sessionTitlePolicy } from '@/features/chat-mode/utils/session-title'

export function useSessionTitleSelection(refs: readonly ScopedSessionRef[]) {
  const entries = useEnvironmentsStore((state) => state.entries)
  return useChatProjectionStore(
    useShallow((state) => {
      let supported = 0
      let eligible = 0
      for (const ref of refs) {
        const owner = Object.values(entries).find(
          (entry) => entry.environmentId === ref.environmentId,
        )
        const session = selectChatProjectionSlice(state, ref.environmentId).sessionById[
          ref.sessionId
        ]
        const policy = sessionTitlePolicy(session, owner)
        if (!policy.supported) continue
        supported++
        if (!policy.pending) eligible++
      }
      return { supported, eligible }
    }),
  )
}
