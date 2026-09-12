import { defineErrorCatalog } from 'evlog'
import { isValidOrderKey } from '@workspace/contracts'
import { orchestrationErrors } from '../observability'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from './read-model'

/**
 * Arranged-order refusals. Shared by every list that sorts on a fractional key
 * (the pinned session block, the project list) so one malformed key is refused
 * the same way everywhere instead of being persisted and corrupting the sort.
 */
export const orderKeyErrors = defineErrorCatalog('orchestration', {
  ORDER_KEY_INVALID: {
    status: 400,
    message: ({ orderKey }: { orderKey: string }) => `Order key is malformed: ${orderKey}`,
    why: 'The list sorts by plain string comparison, so a key outside the a-z alphabet — or one ending in the minimum digit, which leaves no room to insert before it — silently corrupts the arranged order for every client.',
    fix: 'Mint the key with orderKeyBetween instead of hand-writing it.',
  },
})

/**
 * Refusals specific to the settle / snooze / pin lifecycle. They share the
 * `orchestration` prefix with the aggregate-level catalog so the client keeps
 * one namespace to branch on.
 */
export const sessionLifecycleErrors = defineErrorCatalog('orchestration', {
  SESSION_BLOCKING_REQUEST: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has an open approval or user-input request and cannot handle ${commandType}`,
    why: 'An open request is the agent waiting on the user; parking the session would hide the very question it is asking.',
    fix: 'Answer or dismiss the pending request, then retry.',
  },
  SESSION_NOT_PINNED: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) => `Session is not pinned: ${sessionId}`,
    why: 'Only a pinned session holds a slot in the arranged order, so there is nothing to reorder.',
    fix: 'Pin the session first, or drop the reorder — a raced reorder after an unpin must not resurrect the pin.',
  },
  SESSION_QUEUED_TURN_START: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has a queued turn start and cannot handle ${commandType}`,
    why: 'A user message no turn has adopted yet is work in flight with no session and no pending flags to show for it.',
    fix: 'Wait for the turn to start (or fail), then retry.',
  },
  SESSION_RUNTIME_ACTIVE: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has an active session and cannot handle ${commandType}`,
    why: 'The provider session is starting or running, so the session is working — settling it would park live work.',
    fix: 'Stop or interrupt the session first, or wait for the turn to finish.',
  },
  SESSION_SNOOZE_NOT_FUTURE: {
    status: 400,
    message: ({ snoozedUntil, sessionId }: { snoozedUntil: string; sessionId: string }) =>
      `Session ${sessionId} snooze wake time ${snoozedUntil} is not in the future`,
    why: 'A wake time already past would leave the session carrying snooze state it can never be woken out of.',
    fix: 'Send an ISO timestamp strictly after the current server time.',
  },
})

export function requireSessionNotDeleted(model: OrchestrationReadModel, sessionId: string) {
  const session = model.sessions.get(sessionId)
  if (!session || session.deletedAt) throw orchestrationErrors.SESSION_NOT_FOUND({ sessionId })
  return session
}

export function requireSessionNotArchived(
  model: OrchestrationReadModel,
  sessionId: string,
  commandType: string,
) {
  const session = requireSessionNotDeleted(model, sessionId)
  if (session.archivedAt) throw orchestrationErrors.SESSION_ARCHIVED({ commandType, sessionId })
  return session
}

export function requireSessionArchived(model: OrchestrationReadModel, sessionId: string) {
  const session = requireSessionNotDeleted(model, sessionId)
  if (!session.archivedAt) throw orchestrationErrors.SESSION_NOT_ARCHIVED({ sessionId })
  return session
}

export function requireSessionAbsent(model: OrchestrationReadModel, sessionId: string) {
  if (model.sessions.has(sessionId)) throw orchestrationErrors.SESSION_ALREADY_EXISTS({ sessionId })
}

export function requireProject(model: OrchestrationReadModel, projectId: string) {
  const project = model.projects.get(projectId)
  if (!project || project.deletedAt) throw orchestrationErrors.PROJECT_NOT_FOUND({ projectId })
  return project
}

export function requireActionableSourcePlan(
  model: OrchestrationReadModel,
  source: { readonly sessionId: string } | undefined,
) {
  if (!source) return
  const session = requireSessionNotDeleted(model, source.sessionId)
  if (session.hasActionableProposedPlan) return
  throw orchestrationErrors.SOURCE_PLAN_NOT_ACTIONABLE({ planSessionId: source.sessionId })
}

export function requireValidOrderKey(orderKey: string) {
  if (isValidOrderKey(orderKey)) return
  throw orderKeyErrors.ORDER_KEY_INVALID({ orderKey })
}

export function requireSettleable(
  session: OrchestrationProjectedSession,
  commandType: string,
  _at: string,
) {
  const sessionId = session.id
  if (hasOpenBlockingRequest(session))
    throw sessionLifecycleErrors.SESSION_BLOCKING_REQUEST({ commandType, sessionId })
  if (hasQueuedTurnStart(session))
    throw sessionLifecycleErrors.SESSION_QUEUED_TURN_START({ commandType, sessionId })
  if (isSessionAlive(session) || session.latestTurn?.state === 'running') {
    throw sessionLifecycleErrors.SESSION_RUNTIME_ACTIVE({ commandType, sessionId })
  }
}

export function requireSnoozable(
  session: OrchestrationProjectedSession,
  commandType: string,
  at: string,
) {
  requireSettleable(session, commandType, at)
}

export function requireFutureWakeTime(sessionId: string, snoozedUntil: string, at: string) {
  if (Date.parse(snoozedUntil) > Date.parse(at)) return
  throw sessionLifecycleErrors.SESSION_SNOOZE_NOT_FUTURE({ snoozedUntil, sessionId })
}

export function requirePinned(session: OrchestrationProjectedSession) {
  if (session.pinnedAt) return
  throw sessionLifecycleErrors.SESSION_NOT_PINNED({ sessionId: session.id })
}

export function hasOpenBlockingRequest(session: OrchestrationProjectedSession) {
  return session.pendingApprovalCount + session.pendingUserInputCount > 0
}

export function hasQueuedTurnStart(session: OrchestrationProjectedSession) {
  const state = session.latestTurn?.providerStartState
  return state === 'queued' || state === 'claimed' || state === 'adopted'
}

export function isSessionAlive(session: OrchestrationProjectedSession) {
  const status = session.runtime?.status
  return status === 'starting' || status === 'running' || status === 'waiting'
}

export function liveProjectSessions(model: OrchestrationReadModel, projectId: string) {
  return Array.from(model.sessions.values()).filter(
    (session) =>
      model.worktrees.get(session.worktreeId)?.projectId === projectId && !session.deletedAt,
  )
}
