import type { OrchestrationLatestTurn, OrchestrationMessage, TurnId } from '@workspace/contracts'

import type { OptimisticChatMessage } from '@/features/chat/state/chat-message-intents'
import { chatActiveResponseTurnIds } from '@/features/chat/utils/active-response'
import { formatChatElapsed } from '@/features/chat/utils/formatters'
import { stoppedTurnLabel, turnStoppedShort } from '@/features/chat/utils/turn-end-label'

export type ChatTimelineMessage = OrchestrationMessage | OptimisticChatMessage

export type ChatMessageTimelineMetadata = {
  assistantStreaming: boolean
  assistantTurnInProgress: boolean
  completionSummary: string | null
  durationEnd: string
  durationStart: string
  /** The last answer of a turn that stopped short. */
  incomplete: boolean
  showAssistantCopyButton: boolean
  showCompletionDivider: boolean
}

export function chatMessageTimelineMetadata({
  latestTurn,
  messages,
  showCompletionSummary = true,
  activeResponseTurnIds = chatActiveResponseTurnIds({ messages, entries: [], latestTurn }),
}: {
  latestTurn: OrchestrationLatestTurn | null
  messages: readonly ChatTimelineMessage[]
  showCompletionSummary?: boolean
  activeResponseTurnIds?: ReadonlySet<TurnId>
}) {
  const orderedMessages = messages.toSorted(compareMessagesByCreatedAt)
  const durationStartByMessageId = computeMessageDurationStart(orderedMessages)
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(orderedMessages)
  const completionSummary =
    showCompletionSummary && latestTurn?.startedAt && latestTurn.completedAt
      ? formatCompletionSummary(latestTurn)
      : null
  const completionDividerMessageId = completionSummary
    ? deriveCompletionDividerMessageId(orderedMessages, latestTurn)
    : null
  const stoppedTurnId = turnStoppedShort(latestTurn) ? (latestTurn?.turnId ?? null) : null
  const metadataByMessageId = new Map<string, ChatMessageTimelineMetadata>()

  for (const message of messages) {
    const assistantTurnInProgress = isAssistantTurnInProgress(message, activeResponseTurnIds)
    metadataByMessageId.set(message.id, {
      assistantStreaming: isAssistantMessageStreaming(message, latestTurn),
      assistantTurnInProgress,
      completionSummary,
      durationEnd: durationEndForMessage(message, latestTurn, completionDividerMessageId),
      durationStart: durationStartByMessageId.get(message.id) ?? message.createdAt,
      incomplete:
        stoppedTurnId !== null &&
        message.turnId === stoppedTurnId &&
        terminalAssistantMessageIds.has(message.id),
      showAssistantCopyButton:
        message.role === 'assistant' && terminalAssistantMessageIds.has(message.id),
      showCompletionDivider:
        message.role === 'assistant' && completionDividerMessageId === message.id,
    })
  }

  return metadataByMessageId
}

export function fallbackChatMessageTimelineMetadata(
  message: ChatTimelineMessage,
): ChatMessageTimelineMetadata {
  return {
    assistantStreaming: message.streaming,
    assistantTurnInProgress: false,
    completionSummary: null,
    durationEnd: message.updatedAt,
    durationStart: message.createdAt,
    incomplete: false,
    showAssistantCopyButton: false,
    showCompletionDivider: false,
  }
}

/**
 * Only the message that ends a response carries the turn's chrome. Every
 * assistant chunk showing its own timestamp turned a single answer into a
 * column of clocks, so the timestamp is gated on the same terminal-message set
 * the copy button already uses.
 */
export function resolveAssistantMessageChromeState({
  showCopyButton,
  streaming,
  text,
}: {
  showCopyButton: boolean
  streaming: boolean
  text: string | null
}) {
  const copyText = text?.trim() ? text : null

  return {
    copyText,
    copyVisible: showCopyButton && copyText !== null && !streaming,
    metaVisible: showCopyButton && !streaming,
  }
}

function computeMessageDurationStart(messages: readonly ChatTimelineMessage[]) {
  const result = new Map<string, string>()
  let lastBoundary: string | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      lastBoundary = message.createdAt
    }
    result.set(message.id, lastBoundary ?? message.createdAt)
    if (message.role === 'assistant' && !message.streaming) {
      lastBoundary = assistantCompletionBoundary(message)
    }
  }

  return result
}

function assistantCompletionBoundary(message: ChatTimelineMessage) {
  const completedAt = (message as { completedAt?: unknown }).completedAt
  if (typeof completedAt === 'string') return completedAt

  return message.updatedAt
}

function deriveTerminalAssistantMessageIds(messages: readonly ChatTimelineMessage[]) {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>()
  let unkeyedResponseIndex = 0

  for (const message of messages) {
    if (message.role === 'user') {
      unkeyedResponseIndex += 1
      continue
    }
    if (message.role !== 'assistant') continue

    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${unkeyedResponseIndex}`
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id)
  }

  return new Set(lastAssistantMessageIdByResponseKey.values())
}

function deriveCompletionDividerMessageId(
  messages: readonly ChatTimelineMessage[],
  latestTurn: OrchestrationLatestTurn | null,
) {
  if (!latestTurn?.startedAt) return null
  if (!latestTurn.completedAt) return null

  if (latestTurn.assistantMessageId) {
    const exactMatch = messages.find(
      (message) => message.role === 'assistant' && message.id === latestTurn.assistantMessageId,
    )
    if (exactMatch) return exactMatch.id
  }

  const turnStartedAt = Date.parse(latestTurn.startedAt)
  const turnCompletedAt = Date.parse(latestTurn.completedAt)
  if (Number.isNaN(turnStartedAt)) return null
  if (Number.isNaN(turnCompletedAt)) return null

  let inRangeMatch: string | null = null
  let fallbackMatch: string | null = null
  for (const message of messages) {
    if (message.role !== 'assistant') continue

    const messageAt = Date.parse(message.createdAt)
    if (Number.isNaN(messageAt)) continue
    if (messageAt < turnStartedAt) continue

    fallbackMatch = message.id
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = message.id
    }
  }

  return inRangeMatch ?? fallbackMatch
}

function isAssistantTurnInProgress(
  message: ChatTimelineMessage,
  activeResponseTurnIds: ReadonlySet<TurnId>,
) {
  if (message.role !== 'assistant') return false
  if (!message.turnId) return false

  return activeResponseTurnIds.has(message.turnId)
}

function isAssistantMessageStreaming(
  message: ChatTimelineMessage,
  latestTurn: OrchestrationLatestTurn | null,
) {
  if (message.role !== 'assistant') return message.streaming
  if (!message.streaming) return false
  if (!message.turnId) return true

  return (
    latestTurn?.turnId === message.turnId &&
    latestTurn.state === 'running' &&
    latestTurn.completedAt === null
  )
}

function durationEndForMessage(
  message: ChatTimelineMessage,
  latestTurn: OrchestrationLatestTurn | null,
  completionDividerMessageId: string | null,
) {
  if (message.role !== 'assistant') return message.updatedAt
  if (message.id === completionDividerMessageId && latestTurn?.completedAt) {
    return latestTurn.completedAt
  }

  return assistantCompletionBoundary(message)
}

export function compareMessagesByCreatedAt(left: ChatTimelineMessage, right: ChatTimelineMessage) {
  return left.createdAt.localeCompare(right.createdAt)
}

function formatCompletionSummary(turn: OrchestrationLatestTurn) {
  if (!turn.completedAt) return null
  const elapsed = formatChatElapsed(turn.startedAt ?? turn.requestedAt, turn.completedAt)
  if (!elapsed) return null

  return stoppedTurnLabel(turn, elapsed) ?? `Worked for ${elapsed}`
}
