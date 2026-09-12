import * as v from 'valibot'

export const chatAgentSchema = v.object({
  threadId: v.string(),
  parentThreadId: v.optional(v.string()),
  path: v.optional(v.string()),
  nickname: v.optional(v.string()),
  role: v.optional(v.string()),
  model: v.optional(v.string()),
  effort: v.optional(v.string()),
  status: v.picklist(['running', 'waiting', 'idle', 'interrupted', 'failed', 'closed']),
})

export type ChatAgent = v.InferOutput<typeof chatAgentSchema>

export const chatAgentToolSchema = v.object({
  itemId: v.string(),
  itemType: v.string(),
  status: v.picklist(['inProgress', 'completed', 'failed', 'declined']),
  title: v.optional(v.string()),
  detail: v.optional(v.string()),
  data: v.optional(v.unknown()),
})

export type ChatAgentTool = v.InferOutput<typeof chatAgentToolSchema>
