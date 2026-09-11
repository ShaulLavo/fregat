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
  type PendingRequestResponse,
} from '@/features/chat/providers/pending-requests-context'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'

type DispatchCommand = ChatTransport['dispatchCommand']
type RequestResponses = ReadonlyMap<ApprovalRequestId, PendingRequestResponse>
type SetResponses = (update: (current: RequestResponses) => RequestResponses) => void

const NO_ACTIVITIES: readonly OrchestrationSessionActivity[] = []
const NO_RESPONSES: RequestResponses = new Map()
const IDLE_RESPONSE: PendingRequestResponse = { kind: 'idle' }

/** The activity stream owns open requests; local state tracks their response dispatch. */
export function ChatPendingRequestsProvider({
  children,
  disabledReason = null,
  dispatchCommand,
  sessionId,
}: {
  readonly children: ReactNode
  readonly disabledReason?: string | null
  readonly dispatchCommand: DispatchCommand
  readonly sessionId: SessionId
}) {
  const activities = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.activities ?? NO_ACTIVITIES,
  )
  const [responses, setResponses] = useState<RequestResponses>(NO_RESPONSES)
  // Context value identity: these panels sit beside the composer, so a fresh
  // object on every composer render would repaint them for nothing.
  const value = useMemo<ChatPendingRequests>(
    () => ({
      disabledReason,
      responseState: (requestId) => responses.get(requestId) ?? IDLE_RESPONSE,
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
          setResponses,
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
          setResponses,
        }),
    }),
    [activities, disabledReason, dispatchCommand, responses, sessionId],
  )

  return <ChatPendingRequestsContext value={value}>{children}</ChatPendingRequestsContext>
}

async function dispatchPendingRequestResponse({
  command,
  context,
  dispatchCommand,
  requestId,
  setResponses,
}: {
  command: SessionApprovalRespondCommand | SessionUserInputRespondCommand
  context: Record<string, unknown>
  dispatchCommand: DispatchCommand
  requestId: ApprovalRequestId
  setResponses: SetResponses
}): Promise<boolean> {
  setResponses((current) => withResponse(current, requestId, { kind: 'submitting' }))
  const outcome = await dispatchChatCommand({
    action: 'chat.pending_request.respond.summary',
    command,
    context: { ...context, requestId },
    dispatchCommand,
  })
  const response: PendingRequestResponse = outcome.ok
    ? { kind: 'accepted' }
    : { kind: 'failed', message: outcome.message }
  setResponses((current) => withResponse(current, requestId, response))

  return outcome.ok
}

function withResponse(
  current: RequestResponses,
  requestId: ApprovalRequestId,
  response: PendingRequestResponse,
) {
  const next = new Map(current)
  next.set(requestId, response)

  return next
}
