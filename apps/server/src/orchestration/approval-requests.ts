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

export const APPROVAL_ACTIVITY_KINDS = [
  'approval.requested',
  APPROVAL_ANSWER_SUBMITTED_KIND,
  'approval.resolved',
  'provider.approval.respond.failed',
]

export type ApprovalRequests = Map<
  string,
  {
    state: ApprovalRequestState
    request: OpenApprovalRequest
  }
>

export function applyApprovalActivity(
  requests: ApprovalRequests,
  activity: OrchestrationSessionActivity,
) {
  if (!APPROVAL_ACTIVITY_KINDS.includes(activity.kind)) return
  const requestId = activityRequestId(activity.payload)
  if (requestId === null) return
  const previous = requests.get(requestId)
  requests.set(requestId, {
    state: nextApprovalState(previous?.state ?? { kind: 'unknown' }, activity),
    request: previous?.request ?? openRequest(requestId, activity),
  })
}

/** Open and admitted answers both need closing when their turn ends. */
export function openApprovalRequests(requests: ApprovalRequests): OpenApprovalRequest[] {
  return [...requests.values()]
    .filter(({ state }) => state.kind === 'open' || state.kind === 'answering')
    .map(({ request }) => request)
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
