import { pendingMessageQuestions } from './message-questions'
import { requireSession as requireSessionNotDeleted } from './read-model'
import { defineErrorCatalog } from 'evlog'
import { isValidOrderKey } from '@workspace/contracts'
import { orchestrationErrors } from '../observability'
import { sessionDomainErrors } from './structured-errors'
import type { OrchestrationProjectedSession, OrchestrationReadModel } from './read-model'

/**
 * Arranged-order refusals. Shared by every list that sorts on a fractional key
 * (the pinned session block, the project list) so one malformed key is refused
 * the same way everywhere instead of being persisted and corrupting the sort.
 */
const orderKeyErrors = defineErrorCatalog('orchestration', {
  ORDER_KEY_INVALID: {
    status: 400,
    message: ({ orderKey }: { orderKey: string }) => `Order key is malformed: ${orderKey}`,
    why: 'The list sorts by plain string comparison, so a key outside the a-z alphabet — or one ending in the minimum digit, which leaves no room to insert before it — silently corrupts the arranged order for every client.',
    fix: 'Mint the key with orderKeyBetween.',
  },
})

/**
 * Refusals specific to the settle / snooze / pin lifecycle. They share the
 * `orchestration` prefix with the aggregate-level catalog so the client keeps
 * one namespace to branch on.
 */
const sessionLifecycleErrors = defineErrorCatalog('orchestration', {
  SESSION_NOT_SETTLED: {
    status: 409,
    message: 'The session is no longer settled.',
    why: 'New activity started in the session before it could be put to rest.',
    fix: 'Nothing to do. The session is active again.',
  },
  SESSION_BLOCKING_REQUEST: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has an open approval or user-input request and cannot handle ${commandType}`,
    why: 'The agent is waiting for your answer, and putting the session away would hide its question.',
    fix: 'Answer or dismiss the request, then try again.',
  },
  SESSION_NOT_ACTIVE: {
    status: 409,
    message: 'Only unpinned, unsettled sessions can be reordered in the active shelf.',
    why: 'The session moved to another shelf before this reorder was accepted.',
    fix: 'Refresh the session list and reorder it on its current shelf.',
  },
  SESSION_NOT_PINNED: {
    status: 409,
    message: ({ sessionId }: { sessionId: string }) => `Session is not pinned: ${sessionId}`,
    why: 'Only a pinned session holds a slot in the arranged order, so there is nothing to reorder.',
    fix: 'Pin the session first, then move it.',
  },
  SESSION_QUEUED_TURN_START: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has a queued turn start and cannot handle ${commandType}`,
    why: 'A message you sent has not started its turn yet.',
    fix: 'Wait for the turn to start or fail, then try again.',
  },
  SESSION_RUNTIME_ACTIVE: {
    status: 409,
    message: ({ commandType, sessionId }: { commandType: string; sessionId: string }) =>
      `Session ${sessionId} has an active session and cannot handle ${commandType}`,
    why: 'The agent is starting or working, and putting the session away would hide live work.',
    fix: 'Stop the session first, or wait for the turn to finish.',
  },
  SESSION_SNOOZE_NOT_FUTURE: {
    status: 400,
    message: ({ snoozedUntil, sessionId }: { snoozedUntil: string; sessionId: string }) =>
      `Session ${sessionId} snooze wake time ${snoozedUntil} is not in the future`,
    why: 'A snooze that ends in the past would never wake the session.',
    fix: 'Pick a wake time in the future.',
  },
})

export function requireSessionNotArchived(
  model: OrchestrationReadModel,
  sessionId: string,
  commandType: string,
) {
  const session = requireSessionNotDeleted(model, sessionId)
  if (session.archivedAt)
    throw orchestrationErrors.SESSION_ARCHIVED({
      commandType,
      sessionId,
      internal: { archivedAt: session.archivedAt },
    })
  return session
}

export function requireSessionArchived(model: OrchestrationReadModel, sessionId: string) {
  const session = requireSessionNotDeleted(model, sessionId)
  if (!session.archivedAt)
    throw orchestrationErrors.SESSION_NOT_ARCHIVED({
      sessionId,
      internal: { settledOverride: session.settledOverride, pinnedAt: session.pinnedAt },
    })
  return session
}

export function requireSessionAbsent(model: OrchestrationReadModel, sessionId: string) {
  if (model.sessions.has(sessionId))
    throw orchestrationErrors.SESSION_ALREADY_EXISTS({
      sessionId,
      internal: { deletedAt: model.sessions.get(sessionId)?.deletedAt ?? null },
    })
}

export function requireActionableSourcePlan(
  model: OrchestrationReadModel,
  source: { readonly sessionId: string; readonly planId: string },
  targetWorktreeId: string | undefined,
  plan: { planId: string; implementedAt: string | null } | null,
) {
  const session = requireSessionNotDeleted(model, source.sessionId)
  if (
    !plan ||
    plan.planId !== source.planId ||
    plan.implementedAt !== null ||
    !session.hasActionableProposedPlan
  ) {
    throw orchestrationErrors.SOURCE_PLAN_NOT_ACTIONABLE({
      planSessionId: source.sessionId,
      internal: {
        implementedAt: plan?.implementedAt ?? null,
        hasActionableProposedPlan: session.hasActionableProposedPlan,
        planFound: Boolean(plan),
      },
    })
  }
  const sourceWorktree = model.worktrees.get(session.worktreeId)
  const targetWorktree = targetWorktreeId ? model.worktrees.get(targetWorktreeId) : undefined
  if (!sourceWorktree || !targetWorktree || sourceWorktree.projectId !== targetWorktree.projectId) {
    throw sessionDomainErrors.SOURCE_PLAN_PROJECT_MISMATCH({
      internal: {
        sourceProjectId: sourceWorktree?.projectId ?? null,
        targetProjectId: targetWorktree?.projectId ?? null,
        targetWorktreeId: targetWorktreeId ?? null,
      },
    })
  }
}

export function requireValidOrderKey(orderKey: string) {
  if (isValidOrderKey(orderKey)) return
  throw orderKeyErrors.ORDER_KEY_INVALID({ orderKey, internal: { length: orderKey.length } })
}

/** Why a session cannot be settled now, or null. The throwing guard and the sweep share it. */
export function settleBlocker(
  session: OrchestrationProjectedSession,
  dismissMessageQuestions = false,
) {
  const optional = dismissMessageQuestions ? pendingMessageQuestions(session.activities).length : 0
  if (session.pendingApprovalCount > 0 || session.pendingUserInputCount > optional)
    return 'blocking-request' as const
  if (hasQueuedTurnStart(session)) return 'queued-turn' as const
  if (isSessionAlive(session) || session.latestTurn?.state === 'running')
    return 'runtime-active' as const
  return null
}

export function requireSettleable(
  session: OrchestrationProjectedSession,
  commandType: string,
  _at: string,
  dismissMessageQuestions = false,
) {
  const sessionId = session.id
  const blocker = settleBlocker(session, dismissMessageQuestions)
  if (blocker === 'blocking-request')
    throw sessionLifecycleErrors.SESSION_BLOCKING_REQUEST({
      commandType,
      sessionId,
      internal: {
        pendingApprovalCount: session.pendingApprovalCount,
        pendingUserInputCount: session.pendingUserInputCount,
        dismissibleQuestions: dismissMessageQuestions
          ? pendingMessageQuestions(session.activities).length
          : 0,
      },
    })
  if (blocker === 'queued-turn')
    throw sessionLifecycleErrors.SESSION_QUEUED_TURN_START({
      commandType,
      sessionId,
      internal: { latestTurnState: session.latestTurn?.state ?? null },
    })
  if (blocker === 'runtime-active')
    throw sessionLifecycleErrors.SESSION_RUNTIME_ACTIVE({
      commandType,
      sessionId,
      internal: {
        alive: isSessionAlive(session),
        latestTurnState: session.latestTurn?.state ?? null,
        runtimeStatus: session.runtime?.status ?? null,
      },
    })
}

export function requireSnoozable(
  session: OrchestrationProjectedSession,
  commandType: string,
  _at: string,
) {
  const sessionId = session.id
  if (hasOpenBlockingRequest(session))
    throw sessionLifecycleErrors.SESSION_BLOCKING_REQUEST({
      commandType,
      sessionId,
      internal: {
        pendingApprovalCount: session.pendingApprovalCount,
        pendingUserInputCount: session.pendingUserInputCount,
      },
    })
  if (hasQueuedTurnStart(session))
    throw sessionLifecycleErrors.SESSION_QUEUED_TURN_START({
      commandType,
      sessionId,
      internal: { latestTurnState: session.latestTurn?.state ?? null },
    })
}

export function requireSettled(session: OrchestrationProjectedSession) {
  if (session.settledOverride !== 'settled')
    throw sessionLifecycleErrors.SESSION_NOT_SETTLED({
      internal: { sessionId: session.id, settledOverride: session.settledOverride },
    })
}

export function requireFutureWakeTime(sessionId: string, snoozedUntil: string, at: string) {
  if (Date.parse(snoozedUntil) > Date.parse(at)) return
  throw sessionLifecycleErrors.SESSION_SNOOZE_NOT_FUTURE({
    snoozedUntil,
    sessionId,
    internal: { at, behindByMs: Date.parse(at) - Date.parse(snoozedUntil) },
  })
}

export function requireActiveOrderable(session: OrchestrationProjectedSession) {
  if (!session.pinnedAt && session.settledOverride !== 'settled') return
  throw sessionLifecycleErrors.SESSION_NOT_ACTIVE({
    internal: {
      sessionId: session.id,
      pinnedAt: session.pinnedAt,
      settledOverride: session.settledOverride,
    },
  })
}

export function requirePinned(session: OrchestrationProjectedSession) {
  if (session.pinnedAt) return
  throw sessionLifecycleErrors.SESSION_NOT_PINNED({
    sessionId: session.id,
    internal: { settledOverride: session.settledOverride },
  })
}

function hasOpenBlockingRequest(session: OrchestrationProjectedSession) {
  return session.pendingApprovalCount + session.pendingUserInputCount > 0
}

/** Whether the session's agent may be writing files now, or is about to start. */
export function sessionMayWrite(session: OrchestrationProjectedSession) {
  const status = session.runtime?.status
  return (
    hasQueuedTurnStart(session) ||
    session.latestTurn?.state === 'running' ||
    status === 'starting' ||
    status === 'running'
  )
}

function hasQueuedTurnStart(session: OrchestrationProjectedSession) {
  const state = session.latestTurn?.providerStartState
  return (
    state === 'queued' ||
    state === 'claimed' ||
    (state === 'adopted' &&
      (session.runtime?.status !== 'running' ||
        session.runtime.activeTurnId !== session.latestTurn?.turnId))
  )
}

function isSessionAlive(session: OrchestrationProjectedSession) {
  const status = session.runtime?.status
  return status === 'starting' || status === 'running' || status === 'waiting'
}

export function liveProjectSessions(model: OrchestrationReadModel, projectId: string) {
  return Array.from(model.sessions.values()).filter(
    (session) =>
      model.worktrees.get(session.worktreeId)?.projectId === projectId && !session.deletedAt,
  )
}
