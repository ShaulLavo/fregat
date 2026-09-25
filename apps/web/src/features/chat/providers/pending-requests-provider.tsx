import { useMutation, useMutationState } from '@tanstack/react-query'
import type {
  ApprovalRequestId,
  OrchestrationSessionActivity,
  SessionApprovalRespondCommand,
  SessionId,
  SessionUserInputRespondCommand,
  SessionUserInputDismissCommand,
} from '@workspace/contracts'
import type { ReactNode } from 'react'

import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
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
} from '@/features/chat/providers/pending-requests-context'
import { selectChatSessionById } from '@workspace/client-core/chat/selectors'
import { derivePendingApprovals } from '@workspace/client-core/chat/pending-approvals'
import { derivePendingUserInputs } from '@workspace/client-core/chat/pending-user-input'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import {
  pendingRequestResponse,
  type PendingRequestMutation,
} from '@/features/chat/utils/pending-request-response'
import { errorMessage } from '@/lib/error-message'

type PendingRequestDispatch = {
  readonly command:
    | SessionApprovalRespondCommand
    | SessionUserInputRespondCommand
    | SessionUserInputDismissCommand
  readonly context: Record<string, unknown>
  readonly requestId: ApprovalRequestId
}

const NO_ACTIVITIES: readonly OrchestrationSessionActivity[] = []

/** The activity stream owns open requests; response mutations own their dispatch. */
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
  const latestTurn = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.latestTurn ?? null,
  )
  const retainedQuestions = useActiveChatProjection(
    (state) => selectChatSessionById(state, sessionId)?.pendingMessageQuestions ?? NO_ACTIVITIES,
  )
  const mutationKey = chatMutationKeys.pendingRequestResponse(transport.environmentId, sessionId)
  // One scope per session: a second click queues behind the first, and the
  // server's admission then sees the request already answered.
  const mutation = useMutation({
    mutationKey,
    scope: { id: `pending-request-response:${transport.environmentId}:${sessionId}` },
    mutationFn: (input: PendingRequestDispatch) => dispatchResponse(input, transport),
  })
  const mutations = useMutationState<PendingRequestMutation>({
    filters: { mutationKey },
    select: (entry) => {
      const variables = entry.state.variables as PendingRequestDispatch | undefined
      return {
        commandId: variables?.command.commandId,
        errorMessage: entry.state.error
          ? errorMessage(entry.state.error, 'The response was not sent.')
          : null,
        requestId: variables?.requestId,
        status: entry.state.status,
      }
    },
  })
  const pendingApprovals = derivePendingApprovals(activities, latestTurn)
  const respond = (input: PendingRequestDispatch) =>
    mutation.mutateAsync(input).then(
      () => true,
      () => false,
    )
  const value: ChatPendingRequests = {
    sessionId,
    disabledReason,
    responseState: (requestId) =>
      pendingRequestResponse({
        activities,
        mutations,
        requestId,
        submittedElsewhere: pendingApprovals.some(
          (approval) => approval.requestId === requestId && approval.submittedDecision !== null,
        ),
      }),
    pendingApprovals,
    pendingUserInputs: derivePendingUserInputs(activities, retainedQuestions),
    dismissUserInput: (requestId) =>
      respond({
        command: createUserInputDismissCommand({ requestId, sessionId }),
        context: {},
        requestId,
      }),
    respondToApproval: (requestId, decision) =>
      respond({
        command: createApprovalRespondCommand({ decision, requestId, sessionId }),
        context: { decision },
        requestId,
      }),
    respondToUserInput: (requestId, answers, attachmentsByQuestionId) =>
      respond({
        command: createUserInputRespondCommand({
          answers,
          attachmentsByQuestionId,
          requestId,
          sessionId,
        }),
        // Count only: an answer can be a credential the provider asked for.
        context: { answerCount: Object.keys(answers).length },
        requestId,
      }),
  }

  return <ChatPendingRequestsContext value={value}>{children}</ChatPendingRequestsContext>
}

async function dispatchResponse(input: PendingRequestDispatch, transport: ChatTransport) {
  const outcome = await dispatchChatCommand({
    action: 'chat.pending_request.respond.summary',
    command: input.command,
    context: { ...input.context, requestId: input.requestId },
    dispatchCommand: transport.dispatchCommand,
    onAccepted: (result) => {
      scheduleSessionProjectionSyncAfterDispatch({
        transport,
        replayAfterSequence: replayAfterDispatch(input.command, result),
        sessionId: input.command.sessionId,
      })
    },
  })
  if (!outcome.ok) throw outcome.error

  return outcome.result
}
