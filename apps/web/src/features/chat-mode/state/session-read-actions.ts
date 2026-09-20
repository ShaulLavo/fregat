import type { ScopedSessionRef } from '@workspace/contracts'
import { sessionCompletedAt, sessionWokeAt } from '@workspace/client-core/chat/rail/unread'
import { sessionSummary } from '@/features/chat-mode/state/removal'
import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'

export function updateSessionRead(ref: ScopedSessionRef, action: 'unread' | 'wake') {
  const session = sessionSummary(ref)
  if (!session) return
  const reads = useSessionReadStore.getState()
  if (action === 'unread') {
    reads.markUnread(ref, sessionCompletedAt(session))
    return
  }
  const wokeAt = sessionWokeAt(session, Date.now())
  if (wokeAt) reads.markSeen(ref, wokeAt)
}
