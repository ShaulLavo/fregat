import {
  sessionWorktreeTargetSchema,
  worktreeProvisioningSchema,
  worktreeClientCommandSchemas,
  worktreeInternalCommandSchemas,
  terminalLeaseCommandSchemas,
  worktreeRetryCommandSchema,
  worktreeCleanupCommandSchema,
  worktreeForceCleanupCommandSchema,
  worktreeReleaseCommandSchema,
} from './worktree-lifecycle'
import * as v from 'valibot'
import {
  approvalRequestIdSchema,
  commandIdSchema,
  messageIdSchema,
  projectIdSchema,
  worktreeIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from './chat-ids'
import {
  chatAttachmentUploadsSchema,
  importedSessionMessageSchema,
  isoDateTimeSchema,
  nonNegativeIntegerSchema,
  orchestrationCheckpointFileSchema,
  orchestrationCheckpointStatusSchema,
  orchestrationProjectScriptSchema,
  orchestrationProposedPlanSchema,
  sessionRuntimeStateSchema,
  worktreeRegistrationEntries,
  repositoryIdentitySchema,
  repositoryKindSchema,
  sessionDeletionStateSchema,
  orchestrationSessionActivitySchema,
  orderKeySchema,
  sourceProposedPlanReferenceSchema,
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

const commandBaseSchema = {
  commandId: commandIdSchema,
} as const

/**
 * Client commands carry no timestamps: the server clock stamps `occurredAt` and
 * every projected `createdAt`/`updatedAt`/`deletedAt`/`archivedAt`. A skewed or
 * hostile client must not be able to place an event in the past or the future.
 * Internal (provider-runtime) commands below still carry the provider's own
 * event time, which is already a server clock reading.
 */
export const projectCreateCommandSchema = v.strictObject({
  ...commandBaseSchema,
  type: v.literal('project.create'),
  title: trimmedNonEmptyStringSchema,
  workspaceRoot: v.pipe(v.string(), v.trim()),
  // "New project in a folder that does not exist yet" is a deliberate act, not
  // a typo the server should silently paper over: the caller opts in, so a
  // mistyped path still fails loudly instead of minting an empty directory.
  // Undefined rather than defaulted-false, so internal dispatch can build the
  // command without restating a flag only the wire ever sets.
  createWorkspaceRootIfMissing: v.optional(v.boolean()),
  defaultModelSelection: v.optional(v.nullable(modelSelectionSchema), null),
})

export const projectMetaUpdateCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('project.meta.update'),
  projectId: projectIdSchema,
  title: v.optional(trimmedNonEmptyStringSchema),
  defaultModelSelection: v.optional(v.nullable(modelSelectionSchema)),
  // The whole list every time, never a patch. Scripts are reordered and renamed
  // as a set, and a per-entry command would need a stable script id that the
  // thing being identified — a name and a command line — does not have.
  scripts: v.optional(v.array(orchestrationProjectScriptSchema)),
})

export const projectReorderCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('project.reorder'),
  projectId: projectIdSchema,
  // Fractional index, same algorithm the pinned session block runs on: the
  // project list sorts by plain string comparison of these keys, so one drag
  // writes one key to one row and never touches the projects the user did not
  // move.
  orderKey: orderKeySchema,
})

export const projectDeleteCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('project.delete'),
  projectId: projectIdSchema,
  // Deleting a project cascades to its sessions, so a project that still has
  // live sessions needs an explicit opt-in rather than a silent mass delete.
  force: v.optional(v.boolean(), false),
})

export const sessionCreateCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.create'),
  sessionId: sessionIdSchema,
  worktreeTarget: sessionWorktreeTargetSchema,
  title: trimmedNonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
})

export const sessionTurnBootstrapCreateSessionSchema = v.object({
  worktreeTarget: sessionWorktreeTargetSchema,
  title: trimmedNonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
})

export const sessionTurnBootstrapSchema = v.object({
  createSession: v.optional(sessionTurnBootstrapCreateSessionSchema),
})

export const sessionMetaUpdateCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.meta.update'),
  sessionId: sessionIdSchema,
  title: v.optional(trimmedNonEmptyStringSchema),
  modelSelection: v.optional(modelSelectionSchema),
})

export const sessionDeleteCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.delete'),
  sessionId: sessionIdSchema,
})

export const sessionArchiveCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.archive'),
  sessionId: sessionIdSchema,
})

export const sessionUnarchiveCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.unarchive'),
  sessionId: sessionIdSchema,
})

export const sessionSettleCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.settle'),
  sessionId: sessionIdSchema,
})

export const sessionUnsettleCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.unsettle'),
  sessionId: sessionIdSchema,
  // Commands only carry "user": activity un-settles are decided server-side
  // (the decider emits `session.unsettled` with reason "activity" directly), so
  // a client cannot forge the neutral reset.
  reason: v.literal('user'),
})

export const sessionSnoozeCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.snooze'),
  sessionId: sessionIdSchema,
  // The wake time. Event-shaped wake conditions (PR merged, review posted) will
  // arrive alongside this; a timer is just the first kind of condition.
  snoozedUntil: isoDateTimeSchema,
})

export const sessionUnsnoozeCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.unsnooze'),
  sessionId: sessionIdSchema,
  // Same as unsettle: only the server stamps "activity". A timer wake emits no
  // event at all — a passed `snoozedUntil` simply stops classifying as snoozed.
  reason: v.literal('user'),
})

export const sessionPinCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.pin'),
  sessionId: sessionIdSchema,
  // Initial slot in the arranged pinned order. Optional: a pin with no key
  // falls to the creation-ordered tail of the pinned block until it is dragged.
  orderKey: v.optional(orderKeySchema),
})

export const sessionUnpinCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.unpin'),
  sessionId: sessionIdSchema,
})

export const sessionPinReorderCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.pin.reorder'),
  sessionId: sessionIdSchema,
  // Fractional index: the pinned block sorts by plain string comparison of
  // these keys, so one drag writes one key to one row and never touches the
  // neighbours the user did not move.
  orderKey: orderKeySchema,
})

export const sessionRuntimeModeSetCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.runtime-mode.set'),
  sessionId: sessionIdSchema,
  runtimeMode: runtimeModeSchema,
})

export const sessionInteractionModeSetCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.interaction-mode.set'),
  sessionId: sessionIdSchema,
  interactionMode: interactionModeSchema,
})

/**
 * Ceiling on one user message. Generous — a pasted stack trace or a whole file
 * is legitimate — but not unbounded: this string is appended to the event log,
 * which is the one store nothing ever prunes, and it is replayed into every
 * snapshot that session will serve for the rest of its life. A runaway paste
 * with no ceiling is a permanent cost, not a transient one.
 */
export const MAX_TURN_MESSAGE_CHARS = 1_000_000

export const sessionTurnStartCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.turn.start'),
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  message: v.object({
    messageId: messageIdSchema,
    role: v.literal('user'),
    text: v.pipe(v.string(), v.maxLength(MAX_TURN_MESSAGE_CHARS)),
    attachments: v.optional(chatAttachmentUploadsSchema, []),
  }),
  modelSelection: v.optional(modelSelectionSchema),
  titleSeed: v.optional(trimmedNonEmptyStringSchema),
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
  sourceProposedPlan: v.optional(sourceProposedPlanReferenceSchema),
  bootstrap: v.optional(sessionTurnBootstrapSchema),
})

export const sessionTurnInterruptCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.turn.interrupt'),
  sessionId: sessionIdSchema,
  turnId: v.optional(turnIdSchema),
})

export const sessionRuntimeStopCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.runtime.stop'),
  sessionId: sessionIdSchema,
})

export const sessionApprovalRespondCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.approval.respond'),
  sessionId: sessionIdSchema,
  requestId: approvalRequestIdSchema,
  decision: providerApprovalDecisionSchema,
})

export const sessionUserInputRespondCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.user-input.respond'),
  sessionId: sessionIdSchema,
  requestId: approvalRequestIdSchema,
  answers: providerUserInputAnswersSchema,
})

export const sessionCheckpointRevertCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.checkpoint.revert'),
  sessionId: sessionIdSchema,
  turnCount: nonNegativeIntegerSchema,
})

export const clientOrchestrationCommandSchema = v.variant('type', [
  projectCreateCommandSchema,
  projectMetaUpdateCommandSchema,
  projectReorderCommandSchema,
  projectDeleteCommandSchema,
  sessionCreateCommandSchema,
  sessionMetaUpdateCommandSchema,
  sessionDeleteCommandSchema,
  sessionArchiveCommandSchema,
  sessionUnarchiveCommandSchema,
  sessionSettleCommandSchema,
  sessionUnsettleCommandSchema,
  sessionSnoozeCommandSchema,
  sessionUnsnoozeCommandSchema,
  sessionPinCommandSchema,
  sessionUnpinCommandSchema,
  sessionPinReorderCommandSchema,
  sessionRuntimeModeSetCommandSchema,
  sessionInteractionModeSetCommandSchema,
  sessionTurnStartCommandSchema,
  sessionTurnInterruptCommandSchema,
  sessionRuntimeStopCommandSchema,
  sessionApprovalRespondCommandSchema,
  sessionUserInputRespondCommandSchema,
  sessionCheckpointRevertCommandSchema,
  ...worktreeClientCommandSchemas,
])

export const sessionRuntimeSetCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.runtime.set'),
  sessionId: sessionIdSchema,
  runtime: sessionRuntimeStateSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionMessageAssistantDeltaCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.message.assistant.delta'),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  delta: v.string(),
  turnId: v.optional(turnIdSchema),
  createdAt: isoDateTimeSchema,
})

export const sessionMessageAssistantCompleteCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.message.assistant.complete'),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  turnId: v.optional(turnIdSchema),
  completedAt: isoDateTimeSchema,
})

export const sessionActivityAppendCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.activity.append'),
  sessionId: sessionIdSchema,
  activity: orchestrationSessionActivitySchema,
  createdAt: isoDateTimeSchema,
})

export const sessionProposedPlanUpsertCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.proposed-plan.upsert'),
  sessionId: sessionIdSchema,
  proposedPlan: orchestrationProposedPlanSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionTurnDiffCompleteCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.turn.diff.complete'),
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  completedAt: isoDateTimeSchema,
  checkpointRef: trimmedNonEmptyStringSchema,
  status: orchestrationCheckpointStatusSchema,
  files: v.array(orchestrationCheckpointFileSchema),
  assistantMessageId: v.optional(messageIdSchema),
  checkpointTurnCount: nonNegativeIntegerSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionRevertCompleteCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.revert.complete'),
  sessionId: sessionIdSchema,
  turnCount: nonNegativeIntegerSchema,
  createdAt: isoDateTimeSchema,
})

export const preparedProjectCreateCommandSchema = v.object({
  ...projectCreateCommandSchema.entries,
  ...worktreeRegistrationEntries,
  repositoryKey: trimmedNonEmptyStringSchema,
  repositoryKind: repositoryKindSchema,
  repositoryIdentity: repositoryIdentitySchema,
  intentFingerprint: trimmedNonEmptyStringSchema,
})

export const projectReviveCommandSchema = v.object({
  ...preparedProjectCreateCommandSchema.entries,
  type: v.literal('project.revive'),
})

export const worktreeRegisterCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('worktree.register'),
  ...worktreeRegistrationEntries,
})

export const worktreeReviveCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('worktree.revive'),
  ...worktreeRegistrationEntries,
  retirementSequence: nonNegativeIntegerSchema,
})

export const sessionDiscoverCommandSchema = v.object({
  ...v.omit(sessionCreateCommandSchema, ['worktreeTarget']).entries,
  worktreeId: worktreeIdSchema,
  type: v.literal('session.discover'),
  sourceUpdatedAt: isoDateTimeSchema,
})

export const sessionDiscoveryMetadataUpdateCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.discovery-metadata.update'),
  sessionId: sessionIdSchema,
  worktreeId: worktreeIdSchema,
  modelSelection: modelSelectionSchema,
  title: trimmedNonEmptyStringSchema,
  sourceUpdatedAt: isoDateTimeSchema,
})

const providerStartEntries = {
  ...commandBaseSchema,
  sessionId: sessionIdSchema,
  turnId: turnIdSchema,
  generation: nonNegativeIntegerSchema,
  observedSequence: nonNegativeIntegerSchema,
  runtimeEpoch: trimmedNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
} as const

export const sessionProviderStartClaimCommandSchema = v.object({
  ...providerStartEntries,
  type: v.literal('session.provider-start.claim'),
})

export const sessionProviderStartAdoptCommandSchema = v.object({
  ...providerStartEntries,
  type: v.literal('session.provider-start.adopt'),
})

export const sessionProviderStartSettleCommandSchema = v.object({
  ...providerStartEntries,
  type: v.literal('session.provider-start.settle'),
})

export const sessionRuntimeRecoverCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.runtime.recover'),
  sessionId: sessionIdSchema,
  observedSequence: nonNegativeIntegerSchema,
  runtimeEpoch: trimmedNonEmptyStringSchema,
  turnId: v.optional(turnIdSchema),
  message: trimmedNonEmptyStringSchema,
  createdAt: isoDateTimeSchema,
})

export const sessionDeletionUpdateCommandSchema = v.object({
  ...commandBaseSchema,
  type: v.literal('session.deletion.update'),
  sessionId: sessionIdSchema,
  deletion: sessionDeletionStateSchema,
})

export const preparedSessionCreateCommandSchema = v.object({
  ...sessionCreateCommandSchema.entries,
  worktreeProvisioning: v.optional(worktreeProvisioningSchema),
  intentFingerprint: v.optional(trimmedNonEmptyStringSchema),
})
export const preparedSessionTurnStartCommandSchema = v.object({
  ...sessionTurnStartCommandSchema.entries,
  worktreeProvisioning: v.optional(worktreeProvisioningSchema),
  intentFingerprint: v.optional(trimmedNonEmptyStringSchema),
})

export const internalOrchestrationCommandSchema = v.variant('type', [
  v.object({
    ...commandBaseSchema,
    type: v.literal('session.terminal-history.append'),
    sessionId: sessionIdSchema,
    messages: v.array(importedSessionMessageSchema),
  }),
  v.object({
    ...commandBaseSchema,
    type: v.literal('session.history.import'),
    sessionId: sessionIdSchema,
    revision: trimmedNonEmptyStringSchema,
    messages: v.array(importedSessionMessageSchema),
    sourceUpdatedAt: isoDateTimeSchema,
  }),
  preparedProjectCreateCommandSchema,
  preparedSessionCreateCommandSchema,
  preparedSessionTurnStartCommandSchema,
  ...worktreeInternalCommandSchemas,
  ...terminalLeaseCommandSchemas,
  projectReviveCommandSchema,
  worktreeRegisterCommandSchema,
  worktreeReviveCommandSchema,
  sessionDiscoverCommandSchema,
  sessionDiscoveryMetadataUpdateCommandSchema,
  sessionProviderStartClaimCommandSchema,
  sessionProviderStartAdoptCommandSchema,
  sessionProviderStartSettleCommandSchema,
  sessionRuntimeRecoverCommandSchema,
  sessionDeletionUpdateCommandSchema,
  sessionRuntimeSetCommandSchema,
  sessionMessageAssistantDeltaCommandSchema,
  sessionMessageAssistantCompleteCommandSchema,
  sessionActivityAppendCommandSchema,
  sessionProposedPlanUpsertCommandSchema,
  sessionTurnDiffCompleteCommandSchema,
  sessionRevertCompleteCommandSchema,
])

export const orchestrationCommandSchema = v.variant('type', [
  projectMetaUpdateCommandSchema,
  projectReorderCommandSchema,
  projectDeleteCommandSchema,
  sessionMetaUpdateCommandSchema,
  sessionDeleteCommandSchema,
  sessionArchiveCommandSchema,
  sessionUnarchiveCommandSchema,
  sessionSettleCommandSchema,
  sessionUnsettleCommandSchema,
  sessionSnoozeCommandSchema,
  sessionUnsnoozeCommandSchema,
  sessionPinCommandSchema,
  sessionUnpinCommandSchema,
  sessionPinReorderCommandSchema,
  sessionRuntimeModeSetCommandSchema,
  sessionInteractionModeSetCommandSchema,
  sessionTurnInterruptCommandSchema,
  sessionRuntimeStopCommandSchema,
  sessionApprovalRespondCommandSchema,
  sessionUserInputRespondCommandSchema,
  sessionCheckpointRevertCommandSchema,
  worktreeRetryCommandSchema,
  worktreeCleanupCommandSchema,
  worktreeForceCleanupCommandSchema,
  worktreeReleaseCommandSchema,
  ...internalOrchestrationCommandSchema.options,
])

export type ProjectCreateCommand = v.InferOutput<typeof projectCreateCommandSchema>
export type PreparedProjectCreateCommand = v.InferOutput<typeof preparedProjectCreateCommandSchema>
export type ProjectReviveCommand = v.InferOutput<typeof projectReviveCommandSchema>
export type WorktreeRegisterCommand = v.InferOutput<typeof worktreeRegisterCommandSchema>
export type WorktreeReviveCommand = v.InferOutput<typeof worktreeReviveCommandSchema>
export type SessionDiscoverCommand = v.InferOutput<typeof sessionDiscoverCommandSchema>
export type SessionDiscoveryMetadataUpdateCommand = v.InferOutput<
  typeof sessionDiscoveryMetadataUpdateCommandSchema
>
export type SessionProviderStartClaimCommand = v.InferOutput<
  typeof sessionProviderStartClaimCommandSchema
>
export type SessionProviderStartAdoptCommand = v.InferOutput<
  typeof sessionProviderStartAdoptCommandSchema
>
export type SessionProviderStartSettleCommand = v.InferOutput<
  typeof sessionProviderStartSettleCommandSchema
>
export type SessionRuntimeRecoverCommand = v.InferOutput<typeof sessionRuntimeRecoverCommandSchema>
export type SessionDeletionUpdateCommand = v.InferOutput<typeof sessionDeletionUpdateCommandSchema>
export type ProjectMetaUpdateCommand = v.InferOutput<typeof projectMetaUpdateCommandSchema>
export type ProjectReorderCommand = v.InferOutput<typeof projectReorderCommandSchema>
export type ProjectDeleteCommand = v.InferOutput<typeof projectDeleteCommandSchema>
export type SessionCreateCommand = v.InferOutput<typeof sessionCreateCommandSchema>
export type SessionTurnBootstrapCreateSession = v.InferOutput<
  typeof sessionTurnBootstrapCreateSessionSchema
>
export type SessionTurnBootstrap = v.InferOutput<typeof sessionTurnBootstrapSchema>
export type SessionMetaUpdateCommand = v.InferOutput<typeof sessionMetaUpdateCommandSchema>
export type SessionDeleteCommand = v.InferOutput<typeof sessionDeleteCommandSchema>
export type SessionArchiveCommand = v.InferOutput<typeof sessionArchiveCommandSchema>
export type SessionUnarchiveCommand = v.InferOutput<typeof sessionUnarchiveCommandSchema>
export type SessionSettleCommand = v.InferOutput<typeof sessionSettleCommandSchema>
export type SessionUnsettleCommand = v.InferOutput<typeof sessionUnsettleCommandSchema>
export type SessionSnoozeCommand = v.InferOutput<typeof sessionSnoozeCommandSchema>
export type SessionUnsnoozeCommand = v.InferOutput<typeof sessionUnsnoozeCommandSchema>
export type SessionPinCommand = v.InferOutput<typeof sessionPinCommandSchema>
export type SessionUnpinCommand = v.InferOutput<typeof sessionUnpinCommandSchema>
export type SessionPinReorderCommand = v.InferOutput<typeof sessionPinReorderCommandSchema>
export type SessionRuntimeModeSetCommand = v.InferOutput<typeof sessionRuntimeModeSetCommandSchema>
export type SessionInteractionModeSetCommand = v.InferOutput<
  typeof sessionInteractionModeSetCommandSchema
>
export type SessionTurnStartCommand = v.InferOutput<typeof sessionTurnStartCommandSchema>
export type SessionTurnInterruptCommand = v.InferOutput<typeof sessionTurnInterruptCommandSchema>
export type SessionRuntimeStopCommand = v.InferOutput<typeof sessionRuntimeStopCommandSchema>
export type SessionApprovalRespondCommand = v.InferOutput<
  typeof sessionApprovalRespondCommandSchema
>
export type SessionUserInputRespondCommand = v.InferOutput<
  typeof sessionUserInputRespondCommandSchema
>
export type SessionCheckpointRevertCommand = v.InferOutput<
  typeof sessionCheckpointRevertCommandSchema
>
export type ClientOrchestrationCommand = v.InferOutput<typeof clientOrchestrationCommandSchema>
export type InternalOrchestrationCommand = v.InferOutput<typeof internalOrchestrationCommandSchema>
export type OrchestrationCommand = v.InferOutput<typeof orchestrationCommandSchema>
