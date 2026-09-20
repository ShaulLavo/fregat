import type { OrchestrationCommand, SessionId } from '@workspace/contracts'
import { event } from './event-factory'
import type { OrchestrationProjectedSession } from './read-model'

export function settlementActivityEvents(
  command: OrchestrationCommand & { sessionId: SessionId },
  session: OrchestrationProjectedSession | undefined,
  at: string,
) {
  if (session?.settledOverride == null) return []
  return [
    event(command, at, 'session.unsettled', {
      reason: 'activity',
      sessionId: command.sessionId,
      updatedAt: at,
    }),
  ]
}

export function userEngagementEvents(
  command: OrchestrationCommand & { sessionId: SessionId },
  session: OrchestrationProjectedSession | undefined,
  at: string,
) {
  const events = settlementActivityEvents(command, session, at)
  if (session?.snoozedUntil == null) return events
  return [
    ...events,
    event(command, at, 'session.unsnoozed', {
      reason: 'activity',
      sessionId: command.sessionId,
      updatedAt: at,
    }),
  ]
}
