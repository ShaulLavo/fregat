import type { ChatSession } from '@workspace/client-core/chat/types'
import { commandIdSchema, type SessionTurnInterruptCommand } from '@workspace/contracts'
import * as v from 'valibot'

const interruptFailureSchema = v.object({
  commandId: commandIdSchema,
  detail: v.optional(v.string()),
})

export function sessionStopFailure(
  session: ChatSession | undefined,
  command: SessionTurnInterruptCommand | null,
): string | null {
  if (!session || !command || session.id !== command.sessionId) return null

  for (const activity of session.activities) {
    if (activity.kind !== 'provider.turn.interrupt.failed') continue

    const parsed = v.safeParse(interruptFailureSchema, activity.payload)
    if (!parsed.success || parsed.output.commandId !== command.commandId) continue

    return parsed.output.detail ?? activity.summary
  }

  return null
}
