import type { sessionWokeAt } from '../../packages/client-core/src/chat/rail/unread'
import * as v from 'valibot'
import { turnIdSchema, sessionIdSchema } from '../../packages/contracts/src/chat-ids'

type WakeSource = Parameters<typeof sessionWokeAt>[0]
const snoozedAt = '2026-09-20T10:00:00.000Z'
const snoozedUntil = '2026-09-20T12:00:00.000Z'
const times = [null, 'invalid', '2026-09-20T09:00:00.000Z', snoozedAt, '2026-09-20T11:00:00.000Z']
const sources: WakeSource[] = []
for (const completedAt of times) {
  for (const state of ['completed', 'interrupted', 'error'] as const) {
    sources.push({
      snoozedAt,
      snoozedUntil,
      archivedAt: null,
      settledOverride: null,
      latestTurn: {
        completedAt,
        state,
        turnId: v.parse(turnIdSchema, 'wake-turn'),
        requestedAt: snoozedAt,
        startedAt: snoozedAt,
        assistantMessageId: null,
        providerStartState: 'settled',
        providerStartGeneration: 1,
        providerStartSequence: 1,
        runtimeEpoch: 'wake-epoch',
      },
      runtime: null,
      pendingApprovalCount: 0,
      pendingUserInputCount: 0,
    })
  }
}
for (const updatedAt of times.filter((time): time is string => time !== null)) {
  for (const status of ['error', 'running', 'ready', 'waiting'] as const) {
    for (const pending of ['none', 'approval', 'input'] as const) {
      sources.push({
        snoozedAt,
        snoozedUntil,
        archivedAt: null,
        settledOverride: null,
        latestTurn: null,
        runtime: {
          status,
          updatedAt,
          sessionId: v.parse(sessionIdSchema, '00000000-0000-4000-8000-000000000001'),
          providerName: 'codex',
          providerBindingHandle: null,
          providerConversationMarker: null,
          providerResumeCursor: null,
          runtimeEpoch: 'wake-epoch',
          runtimeMode: 'full-access',
          activeTurnId: null,
          lastError: null,
        },
        pendingApprovalCount: pending === 'approval' ? 1 : 0,
        pendingUserInputCount: pending === 'input' ? 1 : 0,
      })
    }
  }
}
export const wakeCases = sources.flatMap((session) =>
  [
    Date.parse('2026-09-20T11:30:00Z'),
    Date.parse(snoozedUntil),
    Date.parse('2026-09-20T13:00:00Z'),
  ].map((now) => ({ session, now })),
)

/** The shape upstream's snooze predicates take, mapped from one of our rail sessions. */
export function upstreamSnoozeInput(session: (typeof wakeCases)[number]['session']) {
  return {
    snoozedAt: session.snoozedAt,
    snoozedUntil: session.snoozedUntil,
    latestTurn: session.latestTurn,
    session: session.runtime,
    hasPendingApprovals: session.pendingApprovalCount > 0,
    hasPendingUserInput: session.pendingUserInputCount > 0,
  }
}
