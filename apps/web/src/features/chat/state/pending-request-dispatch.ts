import { mutationOptions } from '@tanstack/react-query'
import type {
  ApprovalRequestId,
  SessionApprovalRespondCommand,
  SessionUserInputRespondCommand,
  SessionUserInputDismissCommand,
  SessionId,
} from '@workspace/contracts'
import type { ChatTransport } from '../transport/chat-transport'
import { dispatchChatCommand, replayAfterDispatch } from '../utils/command-dispatch'
import { syncSessionProjectionAfterDispatch } from '../utils/command-sync'
import { chatMutationKeys } from '../utils/mutation-keys'

export type PendingRequestDispatch = {
  readonly command:
    | SessionApprovalRespondCommand
    | SessionUserInputRespondCommand
    | SessionUserInputDismissCommand
  readonly context: Record<string, unknown>
  readonly requestId: ApprovalRequestId
}

export function pendingRequestMutationOptions(transport: ChatTransport, sessionId: SessionId) {
  return mutationOptions({
    mutationKey: chatMutationKeys.pendingRequestResponse(transport.environmentId, sessionId),
    scope: { id: `pending-request-response:${transport.environmentId}:${sessionId}` },
    mutationFn: (input: PendingRequestDispatch) => dispatchResponse(input, transport),
  })
}

async function dispatchResponse(input: PendingRequestDispatch, transport: ChatTransport) {
  const outcome = await dispatchChatCommand({
    action: 'chat.pending_request.respond.summary',
    command: input.command,
    context: { ...input.context, requestId: input.requestId },
    dispatchCommand: transport.dispatchCommand,
  })
  if (!outcome.ok) throw outcome.error
  await syncSessionProjectionAfterDispatch({
    transport,
    replayAfterSequence: replayAfterDispatch(input.command, outcome.result),
    sessionId: input.command.sessionId,
  })

  return outcome.result
}
