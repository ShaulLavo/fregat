import { isChatSessionBusy } from '@workspace/client-core/chat/session-busy'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { errorNumberField, errorStringField } from '@workspace/contracts'
import { rpcErrorPayload } from '@workspace/client-core/transport/rpc-error'
import type { ChatTransport } from '../transport/chat-transport'
import type { ChatInputSubmitPayload, ChatInputSubmitResult } from '../utils/composed-message'
import { latestCompletedToolActivityId } from '../utils/follow-up-policy'
import { correctionUnavailableReason } from '../utils/composer-state'
import { useChatInputDraftStore, type ChatInputDraftTarget } from './chat-input-draft-store'
import { useFollowUpStore } from './follow-up-store'
import { releaseUnusedDraftAttachments } from './stash-transfer'
import { messageSubmission, submitMessage } from './submit-message'

type SendFollowUpInput = {
  transport: ChatTransport
  session: ChatSession
  target: ChatInputDraftTarget
  followUpBehavior: 'queue' | 'steer'
  input:
    | { kind: 'draft'; payload: ChatInputSubmitPayload; alternate: boolean }
    | { kind: 'queued'; id: string }
}

export async function sendFollowUp({
  transport,
  session,
  target,
  followUpBehavior,
  input,
}: SendFollowUpInput): Promise<ChatInputSubmitResult> {
  const ref = { environmentId: transport.environmentId, sessionId: session.id }
  const busy = isChatSessionBusy(session)
  const toolId = latestCompletedToolActivityId(session.activities)
  const store = useFollowUpStore.getState()
  if (input.kind === 'queued') return sendQueuedFollowUp({ transport, session, id: input.id })
  if (busy && (followUpBehavior === 'queue') !== input.alternate) {
    const draft = useChatInputDraftStore.getState().getDraft(target)
    store.enqueue(ref, {
      id: crypto.randomUUID(),
      target,
      payload: input.payload,
      content: {
        prompt: input.payload.text,
        attachments: draft.attachments,
        terminalContexts: draft.terminalContexts,
      },
      afterToolActivityId: toolId,
      held: false,
      submission: null,
    })
    return 'queued'
  }
  if (busy && correctionUnavailableReason(session)) return 'rejected'
  await submitMessage(transport, messageSubmission(session, input.payload))
  return 'sent'
}

async function sendQueuedFollowUp({
  transport,
  session,
  id,
}: Pick<SendFollowUpInput, 'transport' | 'session'> & {
  id: string
}): Promise<ChatInputSubmitResult> {
  if (session.pendingApprovalCount || session.pendingUserInputCount) return 'rejected'
  if (isChatSessionBusy(session) && correctionUnavailableReason(session)) return 'rejected'
  const ref = { environmentId: transport.environmentId, sessionId: session.id }
  const store = useFollowUpStore.getState()
  const message = store.take(ref, id, latestCompletedToolActivityId(session.activities))
  if (!message) return 'rejected'
  const submission = message.submission ?? messageSubmission(session, message.payload)
  try {
    await submitMessage(transport, submission)
  } catch (error) {
    // Retry the same receipt: a dropped response does not mean the server rejected the message.
    const payload = rpcErrorPayload(error)
    const rejected =
      errorNumberField(payload, 'status') === 409 &&
      errorStringField(payload, 'code') === 'orchestration.STEER_TURN_NOT_ACTIVE'
    store.hold(ref, { ...message, submission: rejected ? null : submission })
    throw error
  }
  await releaseUnusedDraftAttachments(ref.environmentId, message.content.attachments)
  return 'sent'
}
