import { createSteerSubmission, createTurnSubmission } from '@workspace/client-core/chat/commands'
import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import type { ChatSession } from '@workspace/client-core/chat/types'
import type { ChatInputSubmitPayload } from '../utils/composed-message'
import type { ChatTransport } from '../transport/chat-transport'
import { replayAfterDispatch } from '../utils/command-dispatch'
import { syncSessionProjectionAfterDispatch } from '../utils/command-sync'
import { placeChatMessage } from './place-chat-message'
import type { MessageSubmission } from './follow-up-store'

export function messageSubmission(
  session: ChatSession,
  payload: ChatInputSubmitPayload,
): MessageSubmission {
  const input = { ...payload, createdAt: new Date().toISOString(), sessionId: session.id }
  if (isChatSessionBusy(session) && session.latestTurn)
    return createSteerSubmission({ ...input, turnId: session.latestTurn.turnId })
  return createTurnSubmission(input)
}

export async function submitMessage(transport: ChatTransport, submission: MessageSubmission) {
  const outcome = await placeChatMessage({
    action: 'chat.command.dispatch.summary',
    command: submission.command,
    dispatchCommand: transport.dispatchCommand,
    placement: {
      environmentId: transport.environmentId,
      commandId: submission.command.commandId,
      message: submission.optimisticMessage,
    },
  })
  if (!outcome.ok) throw outcome.error
  await syncSessionProjectionAfterDispatch({
    transport,
    replayAfterSequence: replayAfterDispatch(submission.command, outcome.result),
    sessionId: submission.command.sessionId,
  })
}
