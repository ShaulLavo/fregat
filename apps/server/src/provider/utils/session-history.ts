import { sessionIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderHistoryMessage } from '../types'

export const sessionHistoryInputSchema = v.object({
  sessionId: sessionIdSchema,
  cwd: v.pipe(v.string(), v.minLength(1)),
})

export const historyMessagesSchema = v.array(
  v.object({
    sourceId: v.pipe(v.string(), v.minLength(1)),
    role: v.picklist(['user', 'assistant']),
    text: v.string(),
    createdAt: v.nullable(v.pipe(v.string(), v.isoTimestamp())),
  }),
)

const contentBlockSchema = v.looseObject({
  type: v.string(),
  text: v.optional(v.string()),
})

const messageBodySchema = v.looseObject({
  content: v.union([v.string(), v.array(contentBlockSchema)]),
})

export function claudeHistoryMessages(
  messages: readonly SessionMessage[],
): ProviderHistoryMessage[] {
  return messages.flatMap(claudeHistoryMessage)
}

function claudeHistoryMessage(message: SessionMessage): ProviderHistoryMessage[] {
  if (message.type !== 'user' && message.type !== 'assistant') return []
  const body = v.parse(messageBodySchema, message.message)
  const text =
    typeof body.content === 'string'
      ? body.content
      : body.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text ?? '')
          .join('\n\n')
  if (!text.trim()) return []
  return [{ sourceId: message.uuid, role: message.type, text, createdAt: null }]
}
