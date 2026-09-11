import type { OrchestrationLatestTurn, OrchestrationMessage, TurnId } from '@workspace/contracts'

import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

type ResponseMessage = Pick<OrchestrationMessage, 'createdAt' | 'role' | 'turnId'>

export function chatActiveResponseTurnIds({
  messages,
  entries,
  latestTurn,
}: {
  messages: readonly ResponseMessage[]
  entries: readonly ChatWorkLogEntry[]
  latestTurn: OrchestrationLatestTurn | null
}): ReadonlySet<TurnId> {
  const turnIds = new Set<TurnId>()
  if (latestTurn?.state !== 'running' || latestTurn.completedAt !== null) return turnIds

  turnIds.add(latestTurn.turnId)
  const orderedMessages = messages.toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const userIndex = orderedMessages.findLastIndex((message) => message.role === 'user')
  const userMessage = orderedMessages[userIndex]
  if (!userMessage) return turnIds

  // A provider restart has no new user message, so its earlier work is still this response.
  for (const message of orderedMessages.slice(userIndex + 1)) {
    if (message.role !== 'assistant' || !message.turnId) continue
    turnIds.add(message.turnId)
  }
  for (const entry of entries) {
    if (!entry.turnId || entry.createdAt <= userMessage.createdAt) continue
    turnIds.add(entry.turnId)
  }

  return turnIds
}
