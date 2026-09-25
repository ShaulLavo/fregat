import * as v from 'valibot'
import {
  APPROVAL_ANSWER_SUBMITTED_KIND,
  eventIdSchema,
  isProviderTurnFailureActivity,
  type OrchestrationCommand,
  type SessionId,
  type TurnId,
} from '@workspace/contracts'
import {
  approvalRequestState,
  openApprovalRequests,
  type ApprovalRequestState,
  type OpenApprovalRequest,
} from './approval-requests'
import { event, one } from './event-factory'
import type { PendingOrchestrationEvent } from './event-store'
import { requireSession, settledTurnStateForSessionStatus } from './read-model'
import type { OrchestrationReadModel } from './read-model'
import { sessionDomainErrors } from './structured-errors'

type ApprovalRespondCommand = Extract<OrchestrationCommand, { type: 'session.approval.respond' }>

/** Every turn in the session, or one named turn. */
type EndedTurns = 'all' | TurnId

/**
 * One answer per request. A repeat of the recorded answer is a no-op, a different
 * one is refused, and a request whose turn ended never reaches the agent.
 */
export function approvalResponseEvents(
  command: ApprovalRespondCommand,
  model: OrchestrationReadModel,
  at: string,
): PendingOrchestrationEvent[] {
  const session = requireSession(model, command.sessionId)
  const state = approvalRequestState(session.activities, command.requestId)
  if (state.kind === 'ended') {
    throw sessionDomainErrors.APPROVAL_REQUEST_ENDED({
      internal: { requestId: command.requestId },
    })
  }
  if (state.kind === 'answering' || state.kind === 'decided') {
    return repeatedAnswer(command, state)
  }

  return [
    answerSubmitted(command, state, at),
    ...one(
      command,
      at,
      'session.approval-response-requested',
      {
        createdAt: at,
        decision: command.decision,
        requestId: command.requestId,
        sessionId: command.sessionId,
      },
      // The envelope carries the requestId too, so a log scan can correlate
      // the response with the request without unpacking the payload.
      { metadata: { requestId: command.requestId } },
    ),
  ]
}

/** An approval dies with its turn, so every turn end closes the ones still open. */
export function endedApprovalEvents(
  command: OrchestrationCommand,
  events: readonly PendingOrchestrationEvent[],
  model: OrchestrationReadModel,
  at: string,
): PendingOrchestrationEvent[] {
  const ended: PendingOrchestrationEvent[] = []
  const closed = new Set<string>()
  for (const pending of events) {
    const end = turnEnd(pending)
    if (end === null) continue
    const { sessionId, turns } = end
    const activities = model.sessions.get(sessionId)?.activities ?? []
    for (const request of openApprovalRequests(activities)) {
      if (closed.has(request.requestId)) continue
      if (turns !== 'all' && request.turnId !== turns) continue
      closed.add(request.requestId)
      ended.push(endedApproval(command, sessionId, request, at))
    }
  }

  return ended
}

function repeatedAnswer(
  command: ApprovalRespondCommand,
  state: Extract<ApprovalRequestState, { kind: 'answering' | 'decided' }>,
) {
  if (state.decision === command.decision) return []

  throw sessionDomainErrors.APPROVAL_ALREADY_DECIDED({
    internal: {
      recordedDecision: state.decision,
      requestId: command.requestId,
      requestState: state.kind,
    },
  })
}

function answerSubmitted(command: ApprovalRespondCommand, state: ApprovalRequestState, at: string) {
  return event(command, at, 'session.activity-appended', {
    sessionId: command.sessionId,
    activity: {
      id: v.parse(eventIdSchema, `approval-answer:${command.commandId}`),
      sessionId: command.sessionId,
      kind: APPROVAL_ANSWER_SUBMITTED_KIND,
      summary: 'Approval answer submitted',
      tone: 'info',
      turnId: state.kind === 'open' ? state.turnId : null,
      createdAt: at,
      payload: { decision: command.decision, requestId: command.requestId },
    },
  })
}

function turnEnd(
  pending: PendingOrchestrationEvent,
): { sessionId: SessionId; turns: EndedTurns } | null {
  switch (pending.type) {
    case 'session.turn-interrupt-requested':
    case 'session.runtime-recovered':
      return { sessionId: pending.payload.sessionId, turns: pending.payload.turnId ?? 'all' }
    case 'session.runtime-stop-requested':
      return { sessionId: pending.payload.sessionId, turns: 'all' }
    case 'session.runtime-set':
      if (!settledTurnStateForSessionStatus(pending.payload.runtime.status)) return null
      return { sessionId: pending.payload.sessionId, turns: 'all' }
    case 'session.activity-appended':
      return failedTurn(pending.payload.sessionId, pending.payload.activity)
    default:
      return null
  }
}

function failedTurn(sessionId: SessionId, activity: { kind: string; turnId: TurnId | null }) {
  if (!isProviderTurnFailureActivity(activity.kind)) return null
  if (activity.turnId === null) return null

  return { sessionId, turns: activity.turnId }
}

function endedApproval(
  command: OrchestrationCommand,
  sessionId: SessionId,
  request: OpenApprovalRequest,
  at: string,
) {
  return event(command, at, 'session.activity-appended', {
    sessionId,
    activity: {
      id: v.parse(eventIdSchema, endedApprovalActivityId(request.requestId)),
      sessionId,
      kind: 'approval.resolved',
      summary: 'Approval ended',
      tone: 'info',
      turnId: request.turnId,
      createdAt: at,
      payload: {
        requestId: request.requestId,
        requestKind: request.requestKind,
        requestType: request.requestType,
        resolution: 'ended',
      },
    },
  })
}

/** Shared with ingestion, so a harness that also reports the end upserts the same row. */
export function endedApprovalActivityId(requestId: string) {
  return `approval-ended:${requestId}`
}
