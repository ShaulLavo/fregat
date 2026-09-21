import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import type {
  ApprovalRequestId,
  CommandId,
  OrchestrationSessionActivity,
  SessionApprovalRespondCommand,
  SessionId,
  SessionUserInputRespondCommand,
  SessionUserInputDismissCommand,
} from '@workspace/contracts'
import { useState, type ReactNode } from 'react'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  createApprovalRespondCommand,
  createUserInputRespondCommand,
  createUserInputDismissCommand,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand, replayAfterDispatch } from '@/features/chat/utils/command-dispatch'
import { scheduleSessionProjectionSyncAfterDispatch } from '@/features/chat/utils/command-sync'
import {
  ChatPendingRequestsContext,
  type ChatPendingRequests,
  type PendingRequestResponse,
} from '@/features/chat/providers/pending-requests-context'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'
import { pendingRequestError } from '@/features/chat/utils/pending-request-error'

type RequestResponses = ReadonlyMap<
  ApprovalRequestId,
  { commandId: CommandId; response: PendingRequestResponse }
>
type SetResponses = (update: (current: RequestResponses) => RequestResponses) => void

const NO_ACTIVITIES: readonly OrchestrationSessionActivity[] = []
const NO_RESPONSES: RequestResponses = new Map()
const IDLE_RESPONSE: PendingRequestResponse = { kind: 'idle' }

/** The activity stream owns open requests; local state tracks their response dispatch. */
export function ChatPendingRequestsProvider({
  children,
  disabledReason = null,
  transport,
  sessionId,
}: {
  readonly children: ReactNode
  readonly disabledReason?: string | null
  readonly transport: ChatTransport
  readonly sessionId: SessionId
}) {
  const activities = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.activities ?? NO_ACTIVITIES,
  )
  const retainedQuestions = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.pendingMessageQuestions ?? NO_ACTIVITIES,
  )
  const [responses, setResponses] = useState<RequestResponses>(NO_RESPONSES)
  // Context value identity: these panels sit beside the composer, so a fresh
  // object on every composer render would repaint them for nothing.
  const value: ChatPendingRequests = {
    sessionId,
    disabledReason,
    responseState: (requestId) => {
      const pending = responses.get(requestId)
      if (!pending) return IDLE_RESPONSE
      const failure = pendingRequestError(activities, pending.commandId)
      return failure ? { kind: 'failed', message: failure } : pending.response
    },
    pendingApprovals: derivePendingApprovals(activities),
    pendingUserInputs: derivePendingUserInputs(activities, retainedQuestions),
    dismissUserInput: (requestId) =>
      dispatchPendingRequestResponse({
        command: createUserInputDismissCommand({ requestId, sessionId }),
        context: {},
        requestId,
        setResponses,
        transport,
      }),
    respondToApproval: (requestId, decision) =>
      dispatchPendingRequestResponse({
        command: createApprovalRespondCommand({
          decision,
          requestId,
          sessionId,
        }),
        context: { decision },
        requestId,
        setResponses,
        transport,
      }),
    respondToUserInput: (requestId, answers, attachmentsByQuestionId) =>
      dispatchPendingRequestResponse({
        command: createUserInputRespondCommand({
          answers,
          attachmentsByQuestionId,
          requestId,
          sessionId,
        }),
        // Count only: an answer can be a credential the provider asked for.
        context: { answerCount: Object.keys(answers).length },
        requestId,
        setResponses,
        transport,
      }),
  }

  return <ChatPendingRequestsContext value={value}>{children}</ChatPendingRequestsContext>
}

async function dispatchPendingRequestResponse({
  command,
  context,
  requestId,
  setResponses,
  transport,
}: {
  command:
    | SessionApprovalRespondCommand
    | SessionUserInputRespondCommand
    | SessionUserInputDismissCommand
  context: Record<string, unknown>
  requestId: ApprovalRequestId
  setResponses: SetResponses
  transport: ChatTransport
}): Promise<boolean> {
  setResponses((current) =>
    withResponse(current, requestId, command.commandId, { kind: 'submitting' }),
  )
  const outcome = await dispatchChatCommand({
    action: 'chat.pending_request.respond.summary',
    command,
    context: { ...context, requestId },
    dispatchCommand: transport.dispatchCommand,
    onAccepted: (result) => {
      scheduleSessionProjectionSyncAfterDispatch({
        transport,
        replayAfterSequence: replayAfterDispatch(command, result),
        sessionId: command.sessionId,
      })
    },
  })
  const response: PendingRequestResponse = outcome.ok
    ? { kind: 'accepted' }
    : { kind: 'failed', message: outcome.message }
  setResponses((current) => withResponse(current, requestId, command.commandId, response))

  return outcome.ok
}

function withResponse(
  current: RequestResponses,
  requestId: ApprovalRequestId,
  commandId: CommandId,
  response: PendingRequestResponse,
) {
  const next = new Map(current)
  next.set(requestId, { commandId, response })

  return next
}
