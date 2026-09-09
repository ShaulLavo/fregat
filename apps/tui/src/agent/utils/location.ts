import * as v from 'valibot'
import { projectIdSchema, sessionIdSchema, worktreeIdSchema } from '@workspace/contracts'
import type { KeyValueStorage } from '@workspace/client-core/storage'
import type { AgentLocation } from '@/agent/utils/target'

const locationSchema = v.object({
  kind: v.literal('agent'),
  projectId: v.nullable(projectIdSchema),
  sessionId: v.nullable(sessionIdSchema),
  worktreeId: v.optional(v.nullable(worktreeIdSchema)),
})

export function rememberedAgent(storage: KeyValueStorage): AgentLocation | null {
  const value = storage.getItem('agent:last')
  if (!value) return null
  try {
    const result = v.safeParse(locationSchema, JSON.parse(value))
    return result.success ? result.output : null
  } catch {
    return null
  }
}

export function rememberAgent(storage: KeyValueStorage, location: AgentLocation) {
  storage.setItem('agent:last', JSON.stringify(location))
}
