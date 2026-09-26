import { QueryClientProvider, useIsMutating } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { createChatSessionSelector } from '@workspace/client-core/chat/selectors'

import { useComposerConnection } from '@/features/chat/hooks/use-composer-connection'
import { useSessionComposer } from '@/features/chat/hooks/use-session-composer'
import { subscribeTransports, transportFor } from '@/features/chat/state/active-transports'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { queuedSessions, useFollowUpStore } from '@/features/chat/state/follow-up-store'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

/**
 * Sends each session's queued follow-ups at their boundary, whether or not the session is open.
 * An open composer drains the same queue; a head is taken once, so the two never send it twice.
 */
export function QueuedFollowUpSenders() {
  const sessions = useFollowUpStore(useShallow(queuedSessions))
  return sessions.map((ref) => (
    <QueuedFollowUpSender key={scopedSessionKey(ref)} sessionRef={ref} />
  ))
}

/** Under the session machine's query client: settings, providers and availability are its own. */
function QueuedFollowUpSender({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const transport = useSyncExternalStore(subscribeTransports, () =>
    transportFor(sessionRef.environmentId),
  )
  const origin = useEnvironmentsStore(
    (state) =>
      Object.values(state.entries).find((entry) => entry.environmentId === sessionRef.environmentId)
        ?.origin,
  )
  if (!transport || transport.closed || !origin) return null

  return (
    <QueryClientProvider client={queryClientFor(origin)}>
      <FollowUpDrain sessionRef={sessionRef} transport={transport} />
    </QueryClientProvider>
  )
}

function FollowUpDrain({
  sessionRef,
  transport,
}: {
  readonly sessionRef: ScopedSessionRef
  readonly transport: ChatTransport
}) {
  // Manual memo: the store keys on this selector's identity.
  const selector = useMemo(
    () => createChatSessionSelector(sessionRef.sessionId),
    [sessionRef.sessionId],
  )
  const session = useChatProjectionStore((state) =>
    selector(selectChatProjectionSlice(state, sessionRef.environmentId)),
  )
  const currentDetail = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, sessionRef.environmentId).sessionDetailSequenceById[
        sessionRef.sessionId
      ] !== undefined,
  )
  const head = useFollowUpStore((state) => state.queues[scopedSessionKey(sessionRef)]?.[0])
  const connection = useComposerConnection(transport, sessionRef.sessionId)
  const rewinding =
    useIsMutating({
      mutationKey: chatMutationKeys.rewind(sessionRef.environmentId, sessionRef.sessionId),
    }) > 0

  // Tool boundaries arrive in the session detail, which is kept subscribed while work is queued.
  useEffect(
    () => transport.retainSessionDetail(sessionRef.sessionId),
    [sessionRef.sessionId, transport],
  )

  useSessionComposer({
    blocked: connection.kind !== 'live' || !currentDetail || rewinding || !head,
    session,
    target: head?.target ?? {
      draftKey: sessionRef.sessionId,
      environmentId: sessionRef.environmentId,
      rootPath: '',
    },
    transport,
  })
  return null
}
