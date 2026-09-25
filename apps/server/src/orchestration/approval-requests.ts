import {
  APPROVAL_ANSWER_SUBMITTED_KIND,
  type OrchestrationSessionActivity,
  type TurnId,
} from '@workspace/contracts'
import { sessionIdentityErrors } from '../provider/structured-errors'
import { activityRequestId } from './pending-requests'

/**
 * Where one approval request stands, folded over the session's activities.
 * `answering` is an answer the server admitted that the agent has not resolved yet.
 */
export type ApprovalRequestState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'open'; readonly turnId: TurnId | null }
  | { readonly kind: 'answering'; readonly decision: string; readonly turnId: TurnId | null }
  | { readonly kind: 'decided'; readonly decision: string }
  | { readonly kind: 'ended' }

export type OpenApprovalRequest = {
  readonly requestId: string
  readonly requestKind: unknown
  readonly requestType: unknown
  readonly turnId: TurnId | null
}

export function approvalRequestState(
  activities: readonly OrchestrationSessionActivity[],
  requestId: string,
): ApprovalRequestState {
  let state: ApprovalRequestState = { kind: 'unknown' }
  for (const activity of activities) {
    if (activityRequestId(activity.payload) !== requestId) continue
    state = nextApprovalState(state, activity)
  }

  return state
}

/** Requests the agent may still be holding: open, or answered but not yet resolved. */
export function openApprovalRequests(
  activities: readonly OrchestrationSessionActivity[],
): OpenApprovalRequest[] {
  const open = new Map<string, OpenApprovalRequest>()
  for (const activity of activities) {
    const requestId = activityRequestId(activity.payload)
    if (requestId === null) continue
    if (activity.kind === 'approval.requested') {
      open.set(requestId, openRequest(requestId, activity))
      continue
    }
    if (closesApproval(activity)) open.delete(requestId)
  }

  return [...open.values()]
}

function nextApprovalState(
  state: ApprovalRequestState,
  activity: OrchestrationSessionActivity,
): ApprovalRequestState {
  const payload = payloadRecord(activity.payload)
  if (activity.kind === 'approval.requested') return { kind: 'open', turnId: activity.turnId }
  if (activity.kind === APPROVAL_ANSWER_SUBMITTED_KIND) {
    return { kind: 'answering', decision: String(payload.decision), turnId: activity.turnId }
  }
  if (activity.kind === 'approval.resolved') return resolvedState(payload)
  if (activity.kind !== 'provider.approval.respond.failed') return state
  if (payload.code === sessionIdentityErrors.REQUEST_GONE.code) return { kind: 'ended' }
  // A transient failure leaves the request answerable again.
  if (state.kind === 'answering') return { kind: 'open', turnId: state.turnId }

  return state
}

function resolvedState(payload: Record<string, unknown>): ApprovalRequestState {
  if (typeof payload.decision !== 'string') return { kind: 'ended' }
  if (payload.resolution === 'ended' || payload.resolution === 'stale') return { kind: 'ended' }

  return { kind: 'decided', decision: payload.decision }
}

function closesApproval(activity: OrchestrationSessionActivity) {
  if (activity.kind === 'approval.resolved') return true
  if (activity.kind !== 'provider.approval.respond.failed') return false

  return payloadRecord(activity.payload).code === sessionIdentityErrors.REQUEST_GONE.code
}

function openRequest(requestId: string, activity: OrchestrationSessionActivity) {
  const payload = payloadRecord(activity.payload)
  return {
    requestId,
    requestKind: payload.requestKind,
    requestType: payload.requestType,
    turnId: activity.turnId,
  }
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return {}

  return payload as Record<string, unknown>
}
