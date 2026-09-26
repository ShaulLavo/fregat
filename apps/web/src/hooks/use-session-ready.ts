import { useEffect } from 'react'
import type { SessionId } from '@workspace/contracts'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  selectSessionDetailSync,
  useSessionDetailSyncStore,
} from '@/features/chat/state/session-detail-sync-store'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'

/** Starts the selected conversation's stream before either host replaces its shown conversation. */
export function useSessionReady(transport: ChatTransport, sessionId: SessionId | null) {
  const detailSynced = useChatProjectionStore(
    (state) =>
      sessionId !== null &&
      selectChatProjectionSlice(state, transport.environmentId).sessionById[sessionId]
        ?.detailSynced === true,
  )
  const blocked = useSessionDetailSyncStore(
    (state) =>
      selectSessionDetailSync(
        state,
        sessionId ? { environmentId: transport.environmentId, sessionId } : null,
      ).status === 'blocked',
  )
  useEffect(() => {
    if (!sessionId || transport.closed) return
    return transport.retainSessionDetail(sessionId)
  }, [transport, sessionId])
  // A refused stream must reveal its own connection notice so a hold cannot hide the failure.
  return sessionId === null || detailSynced || blocked || transport.closed
}
