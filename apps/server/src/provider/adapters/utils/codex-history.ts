import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import type { ProviderDiscoveredSession, ProviderHistoryMessage } from '../../types'
import type { V2ThreadListResponse__Thread } from '../codex-protocol'
import { V2ThreadReadResponse__UserInputSchema } from '../codex-protocol'

const historyItemSchema = v.variant('type', [
  v.object({
    type: v.literal('userMessage'),
    id: v.string(),
    content: v.array(V2ThreadReadResponse__UserInputSchema),
  }),
  v.object({ type: v.literal('agentMessage'), id: v.string(), text: v.string() }),
])
const itemKindSchema = v.object({ type: v.string() })
const historyTurnSchema = v.object({
  id: v.string(),
  startedAt: v.nullish(v.number()),
  completedAt: v.nullish(v.number()),
  items: v.pipe(
    v.array(v.unknown()),
    v.transform((items) => items.filter(isConversationItem)),
    v.array(historyItemSchema),
  ),
})

export const codexHistoryResponseSchema = v.object({
  thread: v.object({
    id: sessionIdSchema,
    cwd: v.string(),
    turns: v.array(historyTurnSchema),
  }),
})

function isConversationItem(item: unknown) {
  const { type } = v.parse(itemKindSchema, item)
  return type === 'userMessage' || type === 'agentMessage'
}

export function codexDiscoveredSession(
  thread: V2ThreadListResponse__Thread,
): ProviderDiscoveredSession {
  return {
    sessionId: v.parse(sessionIdSchema, thread.id),
    cwd: thread.cwd,
    title: thread.name?.trim() || thread.preview.trim() || 'Codex session',
    sourceUpdatedAt: new Date(thread.updatedAt * 1_000).toISOString(),
    gitBranch: thread.gitInfo?.branch ?? null,
  }
}

export function codexHistoryMessages(
  thread: v.InferOutput<typeof codexHistoryResponseSchema>['thread'],
): ProviderHistoryMessage[] {
  return thread.turns.flatMap((turn) => turn.items.flatMap((item) => historyMessage(item, turn)))
}

function historyMessage(
  item: v.InferOutput<typeof historyItemSchema>,
  turn: v.InferOutput<typeof historyTurnSchema>,
): ProviderHistoryMessage[] {
  const text =
    item.type === 'agentMessage'
      ? item.text
      : item.content
          .flatMap((content) => (content.type === 'text' ? [content.text] : []))
          .join('\n\n')
  if (!text.trim()) return []
  const timestamp =
    item.type === 'agentMessage' ? (turn.completedAt ?? turn.startedAt) : turn.startedAt
  return [
    {
      sourceId: `${turn.id}:${item.id}`,
      role: item.type === 'agentMessage' ? 'assistant' : 'user',
      text,
      createdAt: timestamp == null ? null : new Date(timestamp * 1_000).toISOString(),
    },
  ]
}
