import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type {
  ApprovalRequestId,
  OrchestrationSessionActivity,
  SessionApprovalRespondCommand,
  SessionId,
  SessionUserInputRespondCommand,
} from '@workspace/contracts'
import { useMemo, useState, type ReactNode } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createApprovalRespondCommand,
  createUserInputRespondCommand,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand } from '@/features/chat/utils/command-dispatch'
import {
  ChatPendingRequestsContext,
  type ChatPendingRequests,
} from '@/features/chat/providers/pending-requests-context'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'

type DispatchCommand = ChatTransport['dispatchCommand']
type RespondingRequestIds = ReadonlySet<ApprovalRequestId>
type SetResponding = (update: (current: RespondingRequestIds) => RespondingRequestIds) => void

const NO_ACTIVITIES: readonly OrchestrationSessionActivity[] = []
const NONE_RESPONDING: RespondingRequestIds = new Set()

/**
 * Owns the session's blocking requests: it derives the open approvals and user
 * input prompts straight from the activity stream, so a request becomes
 * answerable the moment its activity lands, and it turns the two answers into
 * dispatched commands.
 *
 * The dispatch seam arrives as a prop rather than being reached for, which
 * keeps the panels renderable against any `ChatTransport` — including the
 * real in-process one under test.
 */
export function ChatPendingRequestsProvider({
  children,
  dispatchCommand,
  sessionId,
}: {
  readonly children: ReactNode
  readonly dispatchCommand: DispatchCommand
  readonly sessionId: SessionId
}) {
  const activities = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.activities ?? NO_ACTIVITIES,
  )
  const [responding, setResponding] = useState<RespondingRequestIds>(NONE_RESPONDING)
  // Context value identity: these panels sit beside the composer, so a fresh
  // object on every composer render would repaint them for nothing.
  const value = useMemo<ChatPendingRequests>(
    () => ({
      isResponding: (requestId) => responding.has(requestId),
      pendingApprovals: derivePendingApprovals(activities),
      pendingUserInputs: derivePendingUserInputs(activities),
      respondToApproval: (requestId, decision) =>
        dispatchPendingRequestResponse({
          command: createApprovalRespondCommand({
            decision,
            requestId,
            sessionId,
          }),
          context: { decision },
          dispatchCommand,
          requestId,
          setResponding,
        }),
      respondToUserInput: (requestId, answers) =>
        dispatchPendingRequestResponse({
          command: createUserInputRespondCommand({
            answers,
            requestId,
            sessionId,
          }),
          // Count only: an answer can be a credential the provider asked for.
          context: { answerCount: Object.keys(answers).length },
          dispatchCommand,
          requestId,
          setResponding,
        }),
    }),
    [activities, dispatchCommand, responding, sessionId],
  )

  return <ChatPendingRequestsContext value={value}>{children}</ChatPendingRequestsContext>
}

async function dispatchPendingRequestResponse({
  command,
  context,
  dispatchCommand,
  requestId,
  setResponding,
}: {
  command: SessionApprovalRespondCommand | SessionUserInputRespondCommand
  context: Record<string, unknown>
  dispatchCommand: DispatchCommand
  requestId: ApprovalRequestId
  setResponding: SetResponding
}): Promise<boolean> {
  setResponding((current) => withRequestId(current, requestId))
  const outcome = await dispatchChatCommand({
    action: 'chat.pending_request.respond.summary',
    command,
    context: { ...context, requestId },
    dispatchCommand,
    // A dropped command leaves the agent blocked, so the row has to come back
    // enabled. A success stays disabled until the resolved activity drops it.
    onFailed: () => setResponding((current) => withoutRequestId(current, requestId)),
  })

  return outcome.ok
}

function withRequestId(current: RespondingRequestIds, requestId: ApprovalRequestId) {
  const next = new Set(current)
  next.add(requestId)

  return next
}

function withoutRequestId(current: RespondingRequestIds, requestId: ApprovalRequestId) {
  if (!current.has(requestId)) return current

  const next = new Set(current)
  next.delete(requestId)

  return next
}
