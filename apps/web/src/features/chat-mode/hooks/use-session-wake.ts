import { useEffect, useState } from 'react'
import type { ScopedSessionRef } from '@workspace/contracts'
import { scopedSessionKey } from '@workspace/contracts'
import { unseenSessionWake } from '@workspace/client-core/chat/rail/unread'
import { useCoarseNow } from '@/features/chat/hooks/use-coarse-now'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'

export function useSessionWake(ref: ScopedSessionRef) {
  const nowMs = useCoarseNow()
  const [wakeNow, setWakeNow] = useState(0)
  const deadline = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, ref.environmentId).sessionById[ref.sessionId]?.snoozedUntil,
  )
  const seenAt = useSessionReadStore((state) => state.seenBySessionKey[scopedSessionKey(ref)])
  useEffect(() => {
    if (!deadline) return
    const remaining = Date.parse(deadline) - Date.now()
    if (!Number.isFinite(remaining)) return
    const timer = window.setTimeout(
      () => setWakeNow(Date.now()),
      Math.min(Math.max(remaining, 0) + 1, 2_147_483_647),
    )
    return () => window.clearTimeout(timer)
  }, [deadline, nowMs])
  return useChatProjectionStore((state) => {
    const session = selectChatProjectionSlice(state, ref.environmentId).sessionById[ref.sessionId]
    return session ? unseenSessionWake(session, seenAt, Math.max(nowMs, wakeNow)) : null
  })
}
