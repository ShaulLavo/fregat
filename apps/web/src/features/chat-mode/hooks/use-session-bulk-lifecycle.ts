import { useShallow } from 'zustand/react/shallow'
import type { ScopedSessionRef } from '@workspace/contracts'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { sessionLifecyclePolicy } from '@/features/chat-mode/utils/session-lifecycle'

export function useSessionBulkLifecycle(refs: readonly ScopedSessionRef[]) {
  const entries = useEnvironmentsStore((state) => state.entries)
  return useChatProjectionStore(
    useShallow((projection) => {
      const policies = refs.map((ref) => {
        const slice = selectChatProjectionSlice(projection, ref.environmentId)
        const owner = Object.values(entries).find(
          (entry) => entry.environmentId === ref.environmentId,
        )
        return sessionLifecyclePolicy(
          slice.sessionById[ref.sessionId],
          owner,
          Object.values(slice.activityBySessionId[ref.sessionId] ?? {}),
        )
      })
      return {
        settlement: policies.some((policy) => policy.settlement),
        settleEnabled: policies.some((policy) => policy.settlement && !policy.settleBlocked),
        snooze: policies.some((policy) => policy.snooze),
        snoozeEnabled: policies.some((policy) => policy.snooze && !policy.snoozeBlocked),
      }
    }),
  )
}
