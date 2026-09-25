import { sessionIdentityErrors } from '../provider/structured-errors'

/**
 * The blocked-on-you fold, shared by the decider guards, the in-memory
 * projector and the SQL projection so the three can never disagree on what
 * "waiting for you" means: a request is open from its `*.requested` activity
 * until a later activity resolves the same `requestId` (or reports the request
 * itself is dead). The counters the shell snapshot serves are this fold,
 * counted per kind.
 */
export type PendingRequestCounts = {
  readonly approvals: number
  readonly userInputs: number
}

type RequestActivity = {
  readonly kind: string
  readonly payload: unknown
}

type RequestKind = 'approval' | 'user-input'

export function pendingRequestCounts(activities: Iterable<RequestActivity>): PendingRequestCounts {
  const openRequestKinds = new Map<string, RequestKind>()

  for (const activity of activities) {
    foldActivity(openRequestKinds, activity)
  }

  let approvals = 0
  let userInputs = 0
  for (const kind of openRequestKinds.values()) {
    if (kind === 'approval') {
      approvals += 1
      continue
    }

    userInputs += 1
  }

  return { approvals, userInputs }
}

/**
 * The SQL projection folds a thread's whole activity history on every
 * request-relevant event, so it gates on this predicate instead of paying a
 * SELECT for every tool-call activity in a streaming turn.
 */
export function isPendingRequestActivityKind(kind: string) {
  return openedRequestKind(kind) !== null || isBlockingRequestCloseKind(kind)
}

/**
 * The `requestId` an activity payload carries, or null. Approval and user-input
 * activities all address their request through this one field, so the decider
 * lifts it into the event envelope and the fold correlates on it.
 */
export function activityRequestId(payload: unknown): string | null {
  const record = activityPayloadRecord(payload)
  if (typeof record?.requestId !== 'string') return null

  const requestId = record.requestId.trim()
  return requestId.length > 0 ? requestId : null
}

function foldActivity(openRequestKinds: Map<string, RequestKind>, activity: RequestActivity) {
  const requestId = activityRequestId(activity.payload)
  if (requestId === null) return

  const opened = openedRequestKind(activity.kind)
  if (opened) {
    openRequestKinds.set(requestId, opened)
    return
  }
  if (!isBlockingRequestClosed(activity.kind, activity.payload)) return

  openRequestKinds.delete(requestId)
}

const OPENED_REQUEST_KINDS = new Map<string, RequestKind>([
  ['approval.requested', 'approval'],
  ['user-input.requested', 'user-input'],
])

const BLOCKING_REQUEST_CLOSE_KINDS = new Set([
  'approval.resolved',
  'user-input.resolved',
  'provider.approval.respond.failed',
  'provider.user-input.respond.failed',
])

/**
 * The only kinds the fold reacts to — every other activity is a no-op for it.
 * The SQL projection filters its read on this list, so the filtered read and
 * the whole-history read produce the same counts by construction rather than by
 * two lists agreeing.
 */
export const PENDING_REQUEST_ACTIVITY_KINDS: readonly string[] = [
  ...OPENED_REQUEST_KINDS.keys(),
  ...BLOCKING_REQUEST_CLOSE_KINDS,
]

function openedRequestKind(kind: string) {
  return OPENED_REQUEST_KINDS.get(kind) ?? null
}

function isBlockingRequestCloseKind(kind: string) {
  return BLOCKING_REQUEST_CLOSE_KINDS.has(kind)
}

function isBlockingRequestClosed(kind: string, payload: unknown) {
  if (kind === 'approval.resolved' || kind === 'user-input.resolved') return true
  if (!isRespondFailureKind(kind)) return false

  return isDeadRequestFailureDetail(activityPayloadRecord(payload))
}

function isRespondFailureKind(kind: string) {
  return (
    kind === 'provider.approval.respond.failed' || kind === 'provider.user-input.respond.failed'
  )
}

/**
 * A respond failure clears the request only when the provider says the request is
 * gone. Any other failure leaves it open, because the user can still answer it.
 */
function isDeadRequestFailureDetail(payload: Record<string, unknown> | null) {
  return payload?.code === sessionIdentityErrors.REQUEST_GONE.code
}

function activityPayloadRecord(payload: unknown) {
  if (typeof payload !== 'object' || payload === null) return null

  return payload as Record<string, unknown>
}
