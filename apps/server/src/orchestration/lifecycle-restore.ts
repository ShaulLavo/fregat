import * as v from 'valibot'
import {
  sessionLifecycleStateSchema,
  isProviderTurnFailureActivity,
  isSessionLifecycleCommand,
  type OrchestrationCommand,
  type OrchestrationCommandReceipt,
  type OrchestrationEvent,
  type SessionLifecycleResult,
} from '@workspace/contracts'
import type { OrchestrationReadModel } from './read-model'
import { requireSession } from './read-model'
import { requireSettleable, requireSnoozable } from './command-invariants'
import { sessionDomainErrors } from './structured-errors'
import { one } from './event-factory'

const lifecycleEvents = new Set<OrchestrationEvent['type']>([
  'session.archived',
  'session.unarchived',
  'session.settled',
  'session.unsettled',
  'session.snoozed',
  'session.unsnoozed',
  'session.pinned',
  'session.unpinned',
  'session.pin-reordered',
  'session.active-reordered',
  'session.lifecycle-restored',
  'session.deleted',
  'session.turn-start-requested',
])

export function changesLifecycleRevision(event: OrchestrationEvent) {
  if (event.type !== 'session.activity-appended') return lifecycleEvents.has(event.type)
  const kind = event.payload.activity.kind
  return (
    kind === 'approval.requested' ||
    kind === 'user-input.requested' ||
    kind === 'runtime.error' ||
    isProviderTurnFailureActivity(kind)
  )
}

export function lifecycleResult(
  command: OrchestrationCommand,
  model: OrchestrationReadModel,
): SessionLifecycleResult | null {
  if (!('sessionId' in command)) return null
  if (!isSessionLifecycleCommand(command.type)) return null
  const session = requireSession(model, command.sessionId)
  return {
    kind: 'session.lifecycle',
    commandId: command.commandId,
    sessionId: session.id,
    beforeRevision: session.lifecycleRevision,
    before: v.parse(sessionLifecycleStateSchema, session),
  }
}

export function restoreLifecycle(
  command: Extract<OrchestrationCommand, { type: 'session.lifecycle.restore' }>,
  model: OrchestrationReadModel,
  at: string,
  receipt: OrchestrationCommandReceipt | null | undefined,
) {
  const session = requireSession(model, command.sessionId)
  if (session.lifecycleRevision !== command.expectedRevision)
    throw sessionDomainErrors.LIFECYCLE_CONFLICT({
      internal: {
        sessionId: session.id,
        expectedRevision: command.expectedRevision,
        actualRevision: session.lifecycleRevision,
      },
    })
  if (
    !receipt ||
    receipt.status !== 'accepted' ||
    !receipt.result ||
    !('kind' in receipt.result) ||
    receipt.result.sessionId !== session.id
  )
    throw sessionDomainErrors.LIFECYCLE_RESTORE_UNAVAILABLE({
      internal: { sessionId: session.id, restoreCommandId: command.restoreCommandId },
    })
  const state = { ...receipt.result.before }
  if (state.settledOverride === 'settled') requireSettleable(session, command.type, at, false)
  if (state.snoozedUntil && Date.parse(state.snoozedUntil) <= Date.parse(at)) {
    state.snoozedUntil = null
    state.snoozedAt = null
  }
  if (state.snoozedUntil) requireSnoozable(session, command.type, at)
  return one(command, at, 'session.lifecycle-restored', {
    sessionId: session.id,
    expectedRevision: command.expectedRevision,
    state,
    updatedAt: at,
  })
}
