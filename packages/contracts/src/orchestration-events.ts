import { WORKTREE_EVENT_PAYLOADS } from './worktree-lifecycle'
import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  commandIdSchema,
  eventIdSchema,
  messageIdSchema,
  projectIdSchema,
  proposedPlanIdSchema,
  worktreeIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from './chat-ids'
import {
  chatAttachmentsSchema,
  importedSessionMessageSchema,
  isoDateTimeSchema,
  nonNegativeIntegerSchema,
  orchestrationCheckpointFileSchema,
  orchestrationCheckpointStatusSchema,
  orchestrationMessageRoleSchema,
  orchestrationProjectScriptSchema,
  orchestrationProposedPlanSchema,
  sessionRuntimeStateSchema,
  repositoryIdentitySchema,
  repositoryKindSchema,
  sessionOriginSchema,
  sessionDeletionStateSchema,
  worktreeRegistrationEntries,
  orchestrationSessionActivitySchema,
  orderKeySchema,
  sourceProposedPlanReferenceSchema,
  sessionLifecycleReasonSchema,
  trimmedNonEmptyStringSchema,
} from './chat-model'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  interactionModeSchema,
  modelSelectionSchema,
  providerApprovalDecisionSchema,
  providerUserInputAnswersSchema,
  runtimeModeSchema,
} from './orchestration-runtime'

export const orchestrationAggregateKindSchema = v.picklist(['project', 'worktree', 'session'])
export const orchestrationActorKindSchema = v.picklist(['client', 'server', 'provider'])

export const projectCreatedPayloadSchema = v.object({
  projectId: projectIdSchema,
  title: trimmedNonEmptyStringSchema,
  repositoryKey: trimmedNonEmptyStringSchema,
  repositoryKind: repositoryKindSchema,
  repositoryIdentity: repositoryIdentitySchema,
  defaultModelSelection: v.nullable(modelSelectionSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const projectMetaUpdatedPayloadSchema = v.object({
  projectId: projectIdSchema,
  title: v.optional(trimmedNonEmptyStringSchema),
  defaultModelSelection: v.optional(v.nullable(modelSelectionSchema)),
  // Absent means "unchanged", an empty array means "the user removed them all".
  // Collapsing the two would make clearing the list impossible.
  scripts: v.optional(v.array(orchestrationProjectScriptSchema)),
  updatedAt: isoDateTimeSchema,
})

/**
 * A reorder carries no `updatedAt`: arranging the list is a view placement, not
 * an edit of the project, and bumping the row's timestamp would churn every
 * ordering that reads `updatedAt`. Re-sending the same key is therefore a
 * natural no-op.
 */
export const projectReorderedPayloadSchema = v.object({
  projectId: projectIdSchema,
  orderKey: orderKeySchema,
})

export const projectDeletedPayloadSchema = v.object({
  projectId: projectIdSchema,
  deletedAt: isoDateTimeSchema,
})

export const projectRevivedPayloadSchema = projectCreatedPayloadSchema
export const worktreeRegisteredPayloadSchema = v.object(worktreeRegistrationEntries)
export const worktreeRevivedPayloadSchema = worktreeRegisteredPayloadSchema
export const worktreeRetiredPayloadSchema = v.object({
  worktreeId: worktreeIdSchema,
  retiredAt: isoDateTimeSchema,
})
export const worktreeMetaUpdatedPayloadSchema = v.object({
  worktreeId: worktreeIdSchema,
  branch: v.nullable(trimmedNonEmptyStringSchema),
  updatedAt: isoDateTimeSchema,
})

export const sessionCreatedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  worktreeId: worktreeIdSchema,
  origin: sessionOriginSchema,
  title: trimmedNonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionMetaUpdatedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  title: v.optional(trimmedNonEmptyStringSchema),
  modelSelection: v.optional(modelSelectionSchema),
  updatedAt: isoDateTimeSchema,
})

export const sessionDeletedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  deletedAt: isoDateTimeSchema,
})

export const sessionArchivedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  archivedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionUnarchivedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionSettledPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  settledAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  acknowledgedFailureThroughSequence: v.nullable(nonNegativeIntegerSchema),
})

export const sessionUnsettledPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  reason: sessionLifecycleReasonSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionSnoozedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  snoozedUntil: isoDateTimeSchema,
  snoozedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionUnsnoozedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  reason: sessionLifecycleReasonSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionPinnedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  pinnedAt: isoDateTimeSchema,
  // Absent when re-pinning an already-pinned session — the key the user already
  // placed wins over a raced duplicate — and when the pin carried no slot.
  pinOrderKey: v.optional(orderKeySchema),
  updatedAt: isoDateTimeSchema,
})

export const sessionUnpinnedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionPinReorderedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  orderKey: orderKeySchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionRuntimeModeSetPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  runtimeMode: runtimeModeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionInteractionModeSetPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
  updatedAt: isoDateTimeSchema,
})

export const sessionMessageSentPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  role: orchestrationMessageRoleSchema,
  text: v.string(),
  attachments: v.optional(chatAttachmentsSchema, []),
  turnId: v.nullable(turnIdSchema),
  streaming: v.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionTurnStartRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  messageId: messageIdSchema,
  modelSelection: v.optional(modelSelectionSchema),
  titleSeed: v.optional(trimmedNonEmptyStringSchema),
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
  sourceProposedPlan: v.optional(sourceProposedPlanReferenceSchema),
  createdAt: isoDateTimeSchema,
})

export const sessionTurnInterruptRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnId: v.optional(turnIdSchema),
  createdAt: isoDateTimeSchema,
})

export const sessionRuntimeStopRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionRuntimeSetPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  runtime: sessionRuntimeStateSchema,
})

export const sessionActivityAppendedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  activity: orchestrationSessionActivitySchema,
})

export const sessionProposedPlanUpsertedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  proposedPlan: orchestrationProposedPlanSchema,
})

export const sessionProposedPlanImplementedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  planId: proposedPlanIdSchema,
  implementationSessionId: sessionIdSchema,
  implementedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const sessionTurnDiffCompletedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  checkpointTurnCount: nonNegativeIntegerSchema,
  checkpointRef: trimmedNonEmptyStringSchema,
  status: orchestrationCheckpointStatusSchema,
  files: v.array(orchestrationCheckpointFileSchema),
  assistantMessageId: v.nullable(messageIdSchema),
  completedAt: isoDateTimeSchema,
})

export const sessionCheckpointRevertRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnCount: nonNegativeIntegerSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionRevertedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnCount: nonNegativeIntegerSchema,
  revertedAt: isoDateTimeSchema,
})

export const sessionApprovalResponseRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  requestId: approvalRequestIdSchema,
  decision: providerApprovalDecisionSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionUserInputResponseRequestedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  requestId: approvalRequestIdSchema,
  answers: providerUserInputAnswersSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionProviderStartPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  generation: nonNegativeIntegerSchema,
  runtimeEpoch: trimmedNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionRuntimeRecoveredPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  turnId: v.optional(turnIdSchema),
  observedSequence: nonNegativeIntegerSchema,
  runtimeEpoch: trimmedNonEmptyStringSchema,
  message: trimmedNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionDeletionUpdatedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  deletion: sessionDeletionStateSchema,
})

export const sessionDiscoveryMetadataUpdatedPayloadSchema = v.object({
  sessionId: sessionIdSchema,
  title: trimmedNonEmptyStringSchema,
  sourceUpdatedAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const orchestrationEventMetadataSchema = v.object({
  historyRevision: v.optional(trimmedNonEmptyStringSchema),
  providerTurnId: v.optional(trimmedNonEmptyStringSchema),
  providerItemId: v.optional(trimmedNonEmptyStringSchema),
  adapterKey: v.optional(trimmedNonEmptyStringSchema),
  requestId: v.optional(approvalRequestIdSchema),
  ingestedAt: v.optional(isoDateTimeSchema),
})

const eventBaseSchema = {
  sequence: nonNegativeIntegerSchema,
  eventId: eventIdSchema,
  aggregateKind: orchestrationAggregateKindSchema,
  aggregateId: v.union([projectIdSchema, worktreeIdSchema, sessionIdSchema]),
  occurredAt: isoDateTimeSchema,
  commandId: v.nullable(commandIdSchema),
  causationEventId: v.nullable(eventIdSchema),
  correlationId: v.nullable(commandIdSchema),
  actorKind: orchestrationActorKindSchema,
  metadata: orchestrationEventMetadataSchema,
} as const

/**
 * The event catalog: one row per orchestration event, mapping the wire `type` to
 * the schema its `payload` must satisfy.
 *
 * This record is the only hand-written list. The parser variant below and the
 * `OrchestrationEventType` union are both derived from it, so an event cannot
 * half-exist — there is no state where a type is nameable but unparseable, or
 * parseable but absent from the union. Adding an event is a payload schema plus
 * one row here.
 *
 * The order below is the order the catalog has always been read in (project
 * lifecycle, session lifecycle, then turn traffic). valibot dispatches on the
 * discriminator, not on position, so the order is documentation — but do not
 * alphabetise it.
 */
export const ORCHESTRATION_EVENT_PAYLOADS = {
  'project.created': projectCreatedPayloadSchema,
  'project.revived': projectRevivedPayloadSchema,
  'project.meta-updated': projectMetaUpdatedPayloadSchema,
  'project.reordered': projectReorderedPayloadSchema,
  'project.deleted': projectDeletedPayloadSchema,
  'worktree.registered': worktreeRegisteredPayloadSchema,
  'worktree.revived': worktreeRevivedPayloadSchema,
  'worktree.retired': worktreeRetiredPayloadSchema,
  'worktree.meta-updated': worktreeMetaUpdatedPayloadSchema,
  ...WORKTREE_EVENT_PAYLOADS,
  'session.created': sessionCreatedPayloadSchema,
  'session.meta-updated': sessionMetaUpdatedPayloadSchema,
  'session.deleted': sessionDeletedPayloadSchema,
  'session.archived': sessionArchivedPayloadSchema,
  'session.unarchived': sessionUnarchivedPayloadSchema,
  'session.settled': sessionSettledPayloadSchema,
  'session.unsettled': sessionUnsettledPayloadSchema,
  'session.snoozed': sessionSnoozedPayloadSchema,
  'session.unsnoozed': sessionUnsnoozedPayloadSchema,
  'session.pinned': sessionPinnedPayloadSchema,
  'session.unpinned': sessionUnpinnedPayloadSchema,
  'session.pin-reordered': sessionPinReorderedPayloadSchema,
  'session.runtime-mode-set': sessionRuntimeModeSetPayloadSchema,
  'session.interaction-mode-set': sessionInteractionModeSetPayloadSchema,
  'session.message-sent': sessionMessageSentPayloadSchema,
  'session.history-imported': v.object({
    sessionId: sessionIdSchema,
    messages: v.array(importedSessionMessageSchema),
    sourceUpdatedAt: isoDateTimeSchema,
  }),
  'session.turn-start-requested': sessionTurnStartRequestedPayloadSchema,
  'session.turn-interrupt-requested': sessionTurnInterruptRequestedPayloadSchema,
  'session.runtime-stop-requested': sessionRuntimeStopRequestedPayloadSchema,
  'session.runtime-set': sessionRuntimeSetPayloadSchema,
  'session.activity-appended': sessionActivityAppendedPayloadSchema,
  'session.proposed-plan-upserted': sessionProposedPlanUpsertedPayloadSchema,
  'session.proposed-plan-implemented': sessionProposedPlanImplementedPayloadSchema,
  'session.turn-diff-completed': sessionTurnDiffCompletedPayloadSchema,
  'session.checkpoint-revert-requested': sessionCheckpointRevertRequestedPayloadSchema,
  'session.reverted': sessionRevertedPayloadSchema,
  'session.approval-response-requested': sessionApprovalResponseRequestedPayloadSchema,
  'session.user-input-response-requested': sessionUserInputResponseRequestedPayloadSchema,
  'session.provider-start-claimed': sessionProviderStartPayloadSchema,
  'session.provider-start-adopted': sessionProviderStartPayloadSchema,
  'session.provider-start-settled': sessionProviderStartPayloadSchema,
  'session.runtime-recovered': sessionRuntimeRecoveredPayloadSchema,
  'session.deletion-updated': sessionDeletionUpdatedPayloadSchema,
  'session.discovery-metadata-updated': sessionDiscoveryMetadataUpdatedPayloadSchema,
}

export type OrchestrationEventType = keyof typeof ORCHESTRATION_EVENT_PAYLOADS

/**
 * One variant member. Generic on purpose: instantiated with a single literal
 * type it returns the exact `ObjectSchema` for that event, which is what
 * `OrchestrationEventVariantOption` maps over to rebuild the discriminated union.
 */
const eventVariantOption = <TType extends OrchestrationEventType>(
  type: TType,
  payload: (typeof ORCHESTRATION_EVENT_PAYLOADS)[TType],
) => v.object({ ...eventBaseSchema, type: v.literal(type), payload })

type OrchestrationEventVariantOption = {
  [TType in OrchestrationEventType]: ReturnType<typeof eventVariantOption<TType>>
}[OrchestrationEventType]

/**
 * `Object.entries` erases the key→payload correlation — it hands back
 * `[string, <union of every payload schema>]` — so rebuilding the discriminated
 * union costs exactly one assertion. The three type-derivation gates at the top
 * of `tests/orchestration.test.ts` are what keep it honest: they stop compiling
 * the moment `OrchestrationEvent` widens or decorrelates.
 */
const orchestrationEventVariantOptions = Object.entries(ORCHESTRATION_EVENT_PAYLOADS).map(
  ([type, payload]) => eventVariantOption(type as OrchestrationEventType, payload),
) as OrchestrationEventVariantOption[]

export const orchestrationEventSchema = v.variant('type', orchestrationEventVariantOptions)

export type OrchestrationAggregateKind = v.InferOutput<typeof orchestrationAggregateKindSchema>
export type OrchestrationActorKind = v.InferOutput<typeof orchestrationActorKindSchema>
export type ProjectCreatedPayload = v.InferOutput<typeof projectCreatedPayloadSchema>
export type SessionCreatedPayload = v.InferOutput<typeof sessionCreatedPayloadSchema>
export type OrchestrationEventMetadata = v.InferOutput<typeof orchestrationEventMetadataSchema>
export type OrchestrationEvent = v.InferOutput<typeof orchestrationEventSchema>
