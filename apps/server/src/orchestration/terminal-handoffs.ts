import { eq } from 'drizzle-orm'
import * as v from 'valibot'
import {
  sessionIdSchema,
  providerInstanceIdSchema,
  worktreeIdSchema,
  terminalLeaseIdSchema,
  type SessionId,
} from '@workspace/contracts'
import { agentTerminalHandoffs } from '../db/schema'
import type { OrchestrationDatabase } from './event-store'

const handoffSchema = v.object({
  sessionId: sessionIdSchema,
  providerInstanceId: providerInstanceIdSchema,
  worktreeId: worktreeIdSchema,
  terminalLeaseId: terminalLeaseIdSchema,
  runtimeEpoch: v.string(),
  cwd: v.string(),
  startedAt: v.pipe(v.string(), v.isoTimestamp()),
  baseline: v.array(v.string()),
  phase: v.picklist(['active', 'history']),
})

export type TerminalHandoff = v.InferOutput<typeof handoffSchema>

export class TerminalHandoffs {
  private readonly database: OrchestrationDatabase

  constructor(database: OrchestrationDatabase) {
    this.database = database
  }

  pending() {
    return this.database.select().from(agentTerminalHandoffs).all().map(readHandoff)
  }

  get(sessionId: SessionId) {
    const row = this.database
      .select()
      .from(agentTerminalHandoffs)
      .where(eq(agentTerminalHandoffs.sessionId, sessionId))
      .get()
    return row ? readHandoff(row) : null
  }

  begin({ baseline, ...handoff }: TerminalHandoff) {
    this.database
      .insert(agentTerminalHandoffs)
      .values({ ...handoff, baselineJson: JSON.stringify(baseline) })
      .run()
  }

  exited(sessionId: SessionId) {
    this.database
      .update(agentTerminalHandoffs)
      .set({ phase: 'history' })
      .where(eq(agentTerminalHandoffs.sessionId, sessionId))
      .run()
  }

  complete(sessionId: SessionId) {
    this.database
      .delete(agentTerminalHandoffs)
      .where(eq(agentTerminalHandoffs.sessionId, sessionId))
      .run()
  }
}

function readHandoff({
  baselineJson,
  ...row
}: typeof agentTerminalHandoffs.$inferSelect): TerminalHandoff {
  return v.parse(handoffSchema, { ...row, baseline: JSON.parse(baselineJson) })
}
