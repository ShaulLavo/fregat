import type { ChatAttachment, TurnId } from '@workspace/contracts'
import { createInternalError } from '../../observability/structured-errors'
import type { OrchestrationProjectedSession } from '../read-model'
import { sessionDomainErrors } from '../structured-errors'

export function forkMessages(source: OrchestrationProjectedSession, throughTurnId: TurnId) {
  const internal = { sessionId: source.id, turnId: throughTurnId }
  if (source.latestTurn?.turnId === throughTurnId && source.latestTurn.state === 'running')
    throw sessionDomainErrors.FORK_TURN_RUNNING({ internal })
  const lastIndex = source.messages.findLastIndex((message) => message.turnId === throughTurnId)
  if (lastIndex < 0) throw sessionDomainErrors.FORK_TURN_NOT_FOUND({ internal })
  return source.messages.slice(0, lastIndex + 1)
}

export function forkAttachment(attachment: ChatAttachment, copies: Record<string, ChatAttachment>) {
  const copy = copies[attachment.id]
  if (!copy) throw createInternalError(`Attachment ${attachment.name} has no prepared fork copy.`)
  return copy
}
