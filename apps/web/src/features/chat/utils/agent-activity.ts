import { chatAgentSchema, chatAgentToolSchema } from '@workspace/contracts'
import * as v from 'valibot'

const agentActivitySchema = v.looseObject({
  agent: chatAgentSchema,
  description: v.optional(v.string()),
  summary: v.optional(v.string()),
  tool: v.optional(chatAgentToolSchema),
  usage: v.optional(
    v.object({
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }),
  ),
})

export function chatAgentActivity(payload: unknown) {
  const result = v.safeParse(agentActivitySchema, payload)
  return result.success ? result.output : null
}
