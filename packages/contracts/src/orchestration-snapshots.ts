import { sessionTitleEntries } from './session-titles'
import * as v from 'valibot'
import {
  commandIdSchema,
  projectIdSchema,
  worktreeIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from './chat-ids'
import {
  isoDateTimeSchema,
  nonNegativeIntegerSchema,
  orchestrationCheckpointSummarySchema,
  orchestrationLatestTurnSchema,
  orchestrationMessageSchema,
  orchestrationProjectSchema,
  orchestrationWorktreeSchema,
  orchestrationProposedPlanSchema,
  sessionRuntimeStateSchema,
  orchestrationSessionActivitySchema,
  orchestrationSessionSchema,
  orchestrationSessionLifecycleEntries,
  sessionAttentionEntries,
  sessionOriginSchema,
  trimmedNonEmptyStringSchema,
} from './chat-model'
import { orchestrationEventSchema, orchestrationAggregateKindSchema } from './orchestration-events'
import {
  interactionModeSchema,
  modelSelectionSchema,
  runtimeModeSchema,
} from './orchestration-runtime'

export const orchestrationProjectShellSchema = v.omit(orchestrationProjectSchema, ['deletedAt'])
/** Carries `retiredAt` so a retired worktree reads `worktreeCreationCapability` the same on client and server. */
export const orchestrationWorktreeShellSchema = orchestrationWorktreeSchema

/**
 * The kernel of a plan, sized for a rail row: which step the session is on and
 * how far the plan got. The steps themselves stay in the timeline — "step 3 of
 * 7: running tests" needs three fields, not the plan, and the shell is read for
 * every session on every delta.
 *
 * `turnId` is the honesty gate. A plan belongs to the turn that wrote it, so a
 * reader can refuse to narrate it once a newer turn is running; null when the
 * provider reported the plan outside any turn.
 */
export const orchestrationSessionPlanProgressSchema = v.object({
  turnId: v.nullable(turnIdSchema),
  step: trimmedNonEmptyStringSchema,
  completedSteps: nonNegativeIntegerSchema,
  totalSteps: nonNegativeIntegerSchema,
})

export const orchestrationSessionShellSchema = v.object({
  ...sessionTitleEntries,
  backgroundLiveness: v.optional(v.nullable(v.picklist(['working', 'monitoring']))),
  id: sessionIdSchema,
  worktreeId: worktreeIdSchema,
  origin: sessionOriginSchema,
  ...sessionAttentionEntries,
  ...orchestrationSessionLifecycleEntries,
  title: trimmedNonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  runtimeMode: runtimeModeSchema,
  interactionMode: interactionModeSchema,
  latestTurn: v.nullable(orchestrationLatestTurnSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: v.nullable(isoDateTimeSchema),
  runtime: v.nullable(sessionRuntimeStateSchema),
  latestUserMessageAt: v.nullable(isoDateTimeSchema),
  pendingApprovalCount: nonNegativeIntegerSchema,
  pendingUserInputCount: nonNegativeIntegerSchema,
  hasActionableProposedPlan: v.boolean(),
  /**
   * Absent and null both mean "nothing to narrate": no plan, a withdrawn one, or
   * one whose every step is done. Optional rather than defaulted because the
   * shell has more than one producer — only the delta row reader projects the
   * column today, and a producer that says nothing must not be readable as a
   * producer that said "no plan".
   */
  planProgress: v.optional(v.nullable(orchestrationSessionPlanProgressSchema)),
})

export const orchestrationShellSnapshotSchema = v.object({
  snapshotSequence: nonNegativeIntegerSchema,
  projects: v.array(orchestrationProjectShellSchema),
  worktrees: v.array(orchestrationWorktreeShellSchema),
  sessions: v.array(orchestrationSessionShellSchema),
  updatedAt: isoDateTimeSchema,
})

/**
 * How many messages and how many activities one session-detail window carries.
 * A session is unbounded, so the detail snapshot ships only its tail — a 5,000
 * message session must open as fast as a 5 message one. Everything older stays
 * reachable through `sessionDetailPage`.
 */
export const ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE = 200

/** Ceiling on a client-chosen page size: the page read is client-reachable. */
export const ORCHESTRATION_SESSION_DETAIL_MAX_PAGE_SIZE = 1_000

/**
 * Keyset boundary for one backwards walk: the oldest row the caller already
 * holds, as `(createdAt, id)`.
 *
 * Deliberately derived from row content instead of an opaque server-minted
 * token. The caller can always rebuild the boundary from what it is currently
 * holding, so trimming a client cache, a reconnect that replaces the window, or
 * a revert that rewrites projection rows can never strand history behind a
 * stale cursor — which is the only way "capped" stops meaning "unreachable".
 */
export const orchestrationSessionDetailAnchorSchema = v.object({
  id: trimmedNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
})

/**
 * `null` on a boundary means "hold nothing of this kind yet", which reads the
 * newest rows — the same slice the detail snapshot's window carries.
 */
export const orchestrationSessionDetailPageInputSchema = v.object({
  sessionId: sessionIdSchema,
  beforeMessage: v.nullish(orchestrationSessionDetailAnchorSchema, null),
  beforeActivity: v.nullish(orchestrationSessionDetailAnchorSchema, null),
  limit: v.optional(
    v.pipe(
      nonNegativeIntegerSchema,
      v.minValue(1),
      v.maxValue(ORCHESTRATION_SESSION_DETAIL_MAX_PAGE_SIZE),
    ),
    ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE,
  ),
})

/** Rows are oldest-first, so a caller prepends the page as it arrives. */
export const orchestrationSessionDetailPageSchema = v.object({
  sessionId: sessionIdSchema,
  snapshotSequence: nonNegativeIntegerSchema,
  messages: v.array(orchestrationMessageSchema),
  activities: v.array(orchestrationSessionActivitySchema),
  /** False only once both walks have reached the start of the session. */
  hasEarlier: v.boolean(),
})

/**
 * Plans and checkpoints ride on the snapshot rather than on the session: they
 * are history, and the engine's in-memory session deliberately keeps only the
 * live tail. A cold reload gets them here; live updates arrive as events.
 *
 * `session.messages` and `session.activities` are the newest
 * `ORCHESTRATION_SESSION_DETAIL_PAGE_SIZE` rows, not the whole session.
 */
export const orchestrationSessionDetailSnapshotSchema = v.object({
  snapshotSequence: nonNegativeIntegerSchema,
  session: orchestrationSessionSchema,
  proposedPlans: v.array(orchestrationProposedPlanSchema),
  checkpoints: v.array(orchestrationCheckpointSummarySchema),
})

export const orchestrationShellStreamItemSchema = v.variant('kind', [
  v.object({
    kind: v.literal('snapshot'),
    snapshot: orchestrationShellSnapshotSchema,
  }),
  v.object({
    kind: v.literal('project-upserted'),
    sequence: nonNegativeIntegerSchema,
    project: orchestrationProjectShellSchema,
  }),
  v.object({
    kind: v.literal('project-removed'),
    sequence: nonNegativeIntegerSchema,
    projectId: projectIdSchema,
  }),
  v.object({
    kind: v.literal('worktree-upserted'),
    sequence: nonNegativeIntegerSchema,
    worktree: orchestrationWorktreeShellSchema,
  }),
  v.object({
    kind: v.literal('worktree-removed'),
    sequence: nonNegativeIntegerSchema,
    worktreeId: worktreeIdSchema,
  }),
  v.object({
    kind: v.literal('session-upserted'),
    sequence: nonNegativeIntegerSchema,
    session: orchestrationSessionShellSchema,
  }),
  v.object({
    kind: v.literal('session-removed'),
    sequence: nonNegativeIntegerSchema,
    sessionId: sessionIdSchema,
  }),
])

export const orchestrationSessionStreamItemSchema = v.variant('kind', [
  v.object({
    kind: v.literal('snapshot'),
    snapshot: orchestrationSessionDetailSnapshotSchema,
  }),
  v.object({
    kind: v.literal('event'),
    event: orchestrationEventSchema,
  }),
])

export const orchestrationReplayEventsInputSchema = v.object({
  afterSequence: nonNegativeIntegerSchema,
  aggregateKind: v.optional(orchestrationAggregateKindSchema),
  aggregateId: v.optional(v.union([projectIdSchema, worktreeIdSchema, sessionIdSchema])),
  sessionId: v.optional(sessionIdSchema),
})

export const orchestrationReplayEventsResultSchema = v.object({
  events: v.array(orchestrationEventSchema),
})

export const orchestrationGetTurnDiffInputSchema = v.object({
  sessionId: sessionIdSchema,
  fromTurnCount: nonNegativeIntegerSchema,
  toTurnCount: nonNegativeIntegerSchema,
  /**
   * Display diffs ignore whitespace-only hunks (they are noise to a reader);
   * stat counting does not (they are real changes). Absent means git's default:
   * whitespace counts.
   */
  ignoreWhitespace: v.optional(v.boolean()),
})

export const orchestrationGetFullSessionDiffInputSchema = v.object({
  sessionId: sessionIdSchema,
  toTurnCount: nonNegativeIntegerSchema,
  ignoreWhitespace: v.optional(v.boolean()),
})

export const orchestrationCommandReceiptStatusSchema = v.picklist(['accepted', 'rejected'])

export const projectRegistrationResultSchema = v.object({
  projectId: projectIdSchema,
  worktreeId: worktreeIdSchema,
  disposition: v.picklist([
    'created-project',
    'registered-worktree',
    'existing-worktree',
    'revived-project',
  ]),
})

const commandReceiptEntries = {
  commandId: commandIdSchema,
  commandType: trimmedNonEmptyStringSchema,
  aggregateKind: orchestrationAggregateKindSchema,
  aggregateId: v.union([projectIdSchema, worktreeIdSchema, sessionIdSchema]),
  acceptedAt: isoDateTimeSchema,
  intentFingerprint: trimmedNonEmptyStringSchema,
} as const

export const orchestrationCommandReceiptSchema = v.pipe(
  v.variant('status', [
    v.object({
      ...commandReceiptEntries,
      status: v.literal('accepted'),
      resultSequence: nonNegativeIntegerSchema,
      result: v.nullable(projectRegistrationResultSchema),
      error: v.null(),
    }),
    v.object({
      ...commandReceiptEntries,
      status: v.literal('rejected'),
      resultSequence: v.null(),
      result: v.null(),
      error: trimmedNonEmptyStringSchema,
    }),
  ]),
  v.check((receipt) => {
    if (receipt.status === 'rejected') return true
    const isRegistration =
      receipt.commandType === 'project.create' || receipt.commandType === 'project.revive'
    return isRegistration === (receipt.result !== null)
  }, 'Accepted registration receipts require their typed result; other commands have no result'),
)

export type OrchestrationSessionDetailAnchor = v.InferOutput<
  typeof orchestrationSessionDetailAnchorSchema
>
/** Input side: boundaries and `limit` are the caller's to omit. */
export type OrchestrationSessionDetailPageInput = v.InferInput<
  typeof orchestrationSessionDetailPageInputSchema
>
export type OrchestrationSessionDetailPage = v.InferOutput<
  typeof orchestrationSessionDetailPageSchema
>
export type OrchestrationProjectShell = v.InferOutput<typeof orchestrationProjectShellSchema>
export type OrchestrationWorktreeShell = v.InferOutput<typeof orchestrationWorktreeShellSchema>
export type ProjectRegistrationResult = v.InferOutput<typeof projectRegistrationResultSchema>
export type OrchestrationSessionPlanProgress = v.InferOutput<
  typeof orchestrationSessionPlanProgressSchema
>
export type OrchestrationSessionShell = v.InferOutput<typeof orchestrationSessionShellSchema>
export type OrchestrationShellSnapshot = v.InferOutput<typeof orchestrationShellSnapshotSchema>
export type OrchestrationSessionDetailSnapshot = v.InferOutput<
  typeof orchestrationSessionDetailSnapshotSchema
>
export type OrchestrationShellStreamItem = v.InferOutput<typeof orchestrationShellStreamItemSchema>
export type OrchestrationSessionStreamItem = v.InferOutput<
  typeof orchestrationSessionStreamItemSchema
>
export type OrchestrationReplayEventsInput = v.InferOutput<
  typeof orchestrationReplayEventsInputSchema
>
export type OrchestrationReplayEventsResult = v.InferOutput<
  typeof orchestrationReplayEventsResultSchema
>
export type OrchestrationGetTurnDiffInput = v.InferOutput<
  typeof orchestrationGetTurnDiffInputSchema
>
export type OrchestrationGetFullSessionDiffInput = v.InferOutput<
  typeof orchestrationGetFullSessionDiffInputSchema
>
export type OrchestrationCommandReceipt = v.InferOutput<typeof orchestrationCommandReceiptSchema>
