import { nonEmptyText } from '@workspace/utils/strings'
import {
  APPROVAL_ANSWER_SUBMITTED_KIND,
  approvalRequestIdSchema,
  providerApprovalOptionSchema,
  DEFAULT_APPROVAL_OPTIONS,
  type ProviderApprovalOption,
  type ApprovalRequestId,
  type OrchestrationLatestTurn,
  type OrchestrationSessionActivity,
  type TurnId,
} from '@workspace/contracts'
import * as v from 'valibot'

export type PendingApprovalKind = 'command' | 'file-change' | 'file-read' | 'app-access'

export type PendingApproval = {
  readonly options: readonly ProviderApprovalOption[]
  /** The harness marked this ask risky: no choice may be one keystroke away. */
  readonly defaultToNo: boolean
  readonly createdAt: string
  /** The arguments the harness asked about, as `[name, text]` pairs. */
  readonly args: readonly (readonly [string, string])[]
  readonly detail: string | null
  readonly requestId: ApprovalRequestId
  readonly requestKind: PendingApprovalKind | null
  readonly requestType: string | null
  readonly turnId: TurnId | null
  /** An answer the server admitted, from this window or another, that the agent has not resolved. */
  readonly submittedDecision: string | null
}

/**
 * The server only fills `requestKind` for request types it recognises, and
 * other providers send the raw type alone, so the client repeats the mapping
 * rather than rendering an unlabelled approval.
 */
const APPROVAL_KIND_BY_REQUEST_TYPE: Record<string, PendingApprovalKind> = {
  mcp_elicitation_approval: 'app-access',
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
  args: v.optional(v.fallback(v.record(v.string(), v.string()), {})),
  options: v.optional(v.array(providerApprovalOptionSchema)),
  defaultToNo: v.nullish(v.boolean()),
  detail: v.nullish(v.string()),
  requestId: approvalRequestIdSchema,
  requestKind: v.nullish(v.string()),
  requestType: v.nullish(v.string()),
})

type ApprovalPayload = v.InferOutput<typeof approvalPayloadSchema>

const submittedAnswerSchema = v.object({ decision: v.string(), requestId: approvalRequestIdSchema })

/**
 * Requested minus resolved, oldest first. Deriving from the activity stream
 * instead of the `projection_pending_approvals` table lets the panel answer a
 * request the moment its activity lands, with no second round trip. A request
 * dies with its turn, so a settled latest turn closes its approvals too.
 */
export function derivePendingApprovals(
  activities: readonly OrchestrationSessionActivity[],
  latestTurn: Pick<OrchestrationLatestTurn, 'state' | 'turnId'> | null = null,
): PendingApproval[] {
  const open = new Map<ApprovalRequestId, PendingApproval>()

  for (const activity of orderedSessionActivities(activities)) {
    if (activity.kind === APPROVAL_ANSWER_SUBMITTED_KIND) {
      markSubmitted(open, activity.payload)
      continue
    }
    if (activity.kind === 'provider.approval.respond.failed') {
      markFailed(open, activity.payload)
      continue
    }
    if (!isApprovalActivity(activity.kind)) continue

    const parsed = v.safeParse(approvalPayloadSchema, activity.payload)
    if (!parsed.success) continue

    if (activity.kind === 'approval.resolved') {
      open.delete(parsed.output.requestId)
      continue
    }

    open.set(parsed.output.requestId, pendingApproval(activity, parsed.output))
  }

  return [...open.values()].filter((approval) => !endedWithTurn(approval, latestTurn))
}

function markFailed(open: Map<ApprovalRequestId, PendingApproval>, payload: unknown) {
  const parsed = v.safeParse(
    v.object({
      requestId: approvalRequestIdSchema,
      code: v.optional(v.string()),
    }),
    payload,
  )
  if (!parsed.success) return
  const { requestId, code } = parsed.output
  const approval = open.get(requestId)
  if (!approval) return
  if (code === 'provider.REQUEST_GONE') {
    open.delete(requestId)
    return
  }
  open.set(requestId, { ...approval, submittedDecision: null })
}

function markSubmitted(open: Map<ApprovalRequestId, PendingApproval>, payload: unknown) {
  const parsed = v.safeParse(submittedAnswerSchema, payload)
  if (!parsed.success) return
  const approval = open.get(parsed.output.requestId)
  if (!approval) return

  open.set(parsed.output.requestId, { ...approval, submittedDecision: parsed.output.decision })
}

function endedWithTurn(
  approval: PendingApproval,
  latestTurn: Pick<OrchestrationLatestTurn, 'state' | 'turnId'> | null,
) {
  if (!latestTurn || latestTurn.state === 'running') return false

  return approval.turnId === latestTurn.turnId
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
  return activities.toSorted(compareActivityOrder)
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
    options: payload.options ?? DEFAULT_APPROVAL_OPTIONS,
    defaultToNo: payload.defaultToNo === true,
    createdAt: activity.createdAt,
    args: Object.entries(payload.args ?? {}),
    detail: nonEmptyText(payload.detail),
    requestId: payload.requestId,
    requestKind: approvalKind(payload.requestKind, payload.requestType),
    requestType: nonEmptyText(payload.requestType),
    turnId: activity.turnId,
    submittedDecision: null,
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
  return (
    value === 'command' ||
    value === 'file-change' ||
    value === 'file-read' ||
    value === 'app-access'
  )
}
