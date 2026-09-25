import type { ChatSession } from '@workspace/client-core/chat/types'

import type { ChatInputSubmitPayload } from '@/features/chat/utils/composed-message'

/** D2: a fixed prompt, sent at once. */
export const CARRY_ON_PROMPT = 'Continue from where you stopped.'

type RetrySession = Pick<
  ChatSession,
  'interactionMode' | 'latestTurn' | 'messages' | 'modelSelection' | 'runtimeMode'
>

export function carryOnPayload(session: RetrySession): ChatInputSubmitPayload {
  return { ...retrySettings(session), attachments: [], terminalContexts: [], text: CARRY_ON_PROMPT }
}

/** The stopped turn's own message and attachments, or null when there is none to send. */
export function tryAgainPayload(session: RetrySession): ChatInputSubmitPayload | null {
  const turnId = session.latestTurn?.turnId
  if (!turnId) return null
  const message = session.messages.findLast(
    (entry) => entry.role === 'user' && entry.turnId === turnId,
  )
  if (!message) return null

  return {
    ...retrySettings(session),
    attachments: [...(message.attachments ?? [])],
    terminalContexts: [],
    text: message.text,
  }
}

function retrySettings(session: RetrySession) {
  return {
    interactionMode: session.interactionMode,
    modelSelection: session.modelSelection,
    runtimeMode: session.runtimeMode,
  }
}
