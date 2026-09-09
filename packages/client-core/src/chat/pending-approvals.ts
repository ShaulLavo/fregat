import {
  approvalRequestIdSchema,
  type ApprovalRequestId,
  type OrchestrationSessionActivity,
  type TurnId,
} from '@workspace/contracts'
import * as v from 'valibot'

export type PendingApprovalKind = 'command' | 'file-change' | 'file-read'

export type PendingApproval = {
  readonly createdAt: string
  readonly detail: string | null
  readonly requestId: ApprovalRequestId
  readonly requestKind: PendingApprovalKind | null
  readonly requestType: string | null
  readonly turnId: TurnId | null
}

/**
 * The server only fills `requestKind` for request types it recognises, and
 * other providers send the raw type alone, so the client repeats the mapping
 * rather than rendering an unlabelled approval.
 */
const APPROVAL_KIND_BY_REQUEST_TYPE: Record<string, PendingApprovalKind> = {
  apply_patch_approval: 'file-change',
  command_execution_approval: 'command',
  dynamic_tool_call: 'command',
  exec_command_approval: 'command',
  file_change_approval: 'file-change',
  file_read_approval: 'file-read',
}

/**
 * `payload` is `unknown` on the wire. A provider that sends a shape we do not
 * know must lose its own entry, never break the composer, so every field is
 * parsed and a failed parse drops the activity.
 */
const approvalPayloadSchema = v.object({
  detail: v.nullish(v.string()),
  requestId: approvalRequestIdSchema,
  requestKind: v.nullish(v.string()),
  requestType: v.nullish(v.string()),
})

type ApprovalPayload = v.InferOutput<typeof approvalPayloadSchema>

/**
 * Requested minus resolved, oldest first. Deriving from the activity stream
 * instead of the `projection_pending_approvals` table lets the panel answer a
 * request the moment its activity lands, with no second round trip.
 */
export function derivePendingApprovals(
  activities: readonly OrchestrationSessionActivity[],
): PendingApproval[] {
  const open = new Map<ApprovalRequestId, PendingApproval>()

  for (const activity of orderedSessionActivities(activities)) {
    if (!isApprovalActivity(activity.kind)) continue

    const parsed = v.safeParse(approvalPayloadSchema, activity.payload)
    if (!parsed.success) continue

    if (activity.kind === 'approval.resolved') {
      open.delete(parsed.output.requestId)
      continue
    }

    open.set(parsed.output.requestId, pendingApproval(activity, parsed.output))
  }

  return [...open.values()]
}

/**
 * Oldest first. `sequence` is optional on the contract, so it only decides the
 * order when both activities carry one; `createdAt` is the fallback and the
 * caller's array order breaks the remaining ties, which keeps repeated
 * derivations over the same input identical.
 */
export function orderedSessionActivities(
  activities: readonly OrchestrationSessionActivity[],
): OrchestrationSessionActivity[] {
  return [...activities].sort(compareActivityOrder)
}

function compareActivityOrder(
  left: OrchestrationSessionActivity,
  right: OrchestrationSessionActivity,
) {
  const bySequence = compareSequence(left.sequence, right.sequence)
  if (bySequence !== 0) return bySequence

  return left.createdAt.localeCompare(right.createdAt)
}

function compareSequence(left: number | undefined, right: number | undefined) {
  if (left === undefined) return 0
  if (right === undefined) return 0

  return left - right
}

function isApprovalActivity(kind: string) {
  return kind === 'approval.requested' || kind === 'approval.resolved'
}

function pendingApproval(
  activity: OrchestrationSessionActivity,
  payload: ApprovalPayload,
): PendingApproval {
  return {
    createdAt: activity.createdAt,
    detail: nonEmptyText(payload.detail),
    requestId: payload.requestId,
    requestKind: approvalKind(payload.requestKind, payload.requestType),
    requestType: nonEmptyText(payload.requestType),
    turnId: activity.turnId,
  }
}

function approvalKind(
  requestKind: string | null | undefined,
  requestType: string | null | undefined,
) {
  if (isApprovalKind(requestKind)) return requestKind
  if (!requestType) return null

  return APPROVAL_KIND_BY_REQUEST_TYPE[requestType] ?? null
}

function isApprovalKind(value: string | null | undefined): value is PendingApprovalKind {
  return value === 'command' || value === 'file-change' || value === 'file-read'
}

function nonEmptyText(value: string | null | undefined) {
  const text = value?.trim()

  return text ? text : null
}
