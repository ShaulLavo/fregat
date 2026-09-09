import { worktreeLifecycleEntries } from './worktree-lifecycle'
import * as v from 'valibot'
import {
  eventIdSchema,
  messageIdSchema,
  projectIdSchema,
  worktreeIdSchema,
  providerBindingHandleSchema,
  providerConversationMarkerSchema,
  providerResumeCursorSchema,
  proposedPlanIdSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  turnIdSchema,
} from './chat-ids'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  interactionModeSchema,
  modelSelectionSchema,
  runtimeModeSchema,
} from './orchestration-runtime'
import { isValidOrderKey } from './order-key'

export const isoDateTimeSchema = v.string()
export const nonNegativeIntegerSchema = v.pipe(v.number(), v.integer(), v.minValue(0))
export const trimmedNonEmptyStringSchema = v.pipe(v.string(), v.trim(), v.minLength(1))

/**
 * Attachments per message. Beyond this the prompt is mostly pixels.
 * Same number the composer enforces in the browser — the browser check is the
 * fast, explainable refusal, this one is what actually holds when a client
 * skips it.
 */
export const MAX_CHAT_ATTACHMENTS = 8

/**
 * Ceiling on the encoded bytes per attachment. The composer downscales
 * anything larger before it reaches the wire, so a request over this is a
 * client that did not, not a user with a big screenshot.
 */
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024

/**
 * The same ceiling expressed in data-URL characters. base64 spends 4 characters
 * per 3 bytes; the constant slack covers the `data:image/…;base64,` prefix, so
 * the bound stays a bound rather than becoming a second, looser limit.
 */
export const MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH = 64 + 4 * Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3)

export const chatAttachmentSchema = v.object({
  type: v.literal('image'),
  id: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
  mimeType: v.pipe(v.string(), v.regex(/^image\//i)),
  sizeBytes: v.pipe(nonNegativeIntegerSchema, v.maxValue(MAX_CHAT_ATTACHMENT_BYTES)),
})

/**
 * Wire-only attachment shape: carries the bytes on their way in from the client.
 * The bytes are written to the blob store at ingest and never reach the event
 * log or the projection, which keep the metadata-only `chatAttachmentSchema`.
 */
export const chatAttachmentUploadSchema = v.object({
  ...chatAttachmentSchema.entries,
  dataUrl: v.optional(
    v.pipe(
      v.string(),
      // The length ceiling, not just the shape. `sizeBytes` is a number the
      // client declares and the bytes need not match it, so validating only
      // that leaves the actual payload unbounded: a client can say `1` and
      // send half a gigabyte, which the server would decode whole into memory
      // before anything noticed.
      v.maxLength(MAX_CHAT_ATTACHMENT_DATA_URL_LENGTH),
      v.regex(/^data:image\/[a-z+]+;base64,/i),
    ),
  ),
})

/**
 * The count cap lives on the array, so every place a message declares its
 * attachments must use these rather than re-wrapping the element schema.
 */
export const chatAttachmentsSchema = v.pipe(
  v.array(chatAttachmentSchema),
  v.maxLength(MAX_CHAT_ATTACHMENTS),
)

export const chatAttachmentUploadsSchema = v.pipe(
  v.array(chatAttachmentUploadSchema),
  v.maxLength(MAX_CHAT_ATTACHMENTS),
)

/**
 * Path prefix the attachment blob route is mounted on. The server mounts its
 * route from this and the web builds every `<img>` src from it, so the two can
 * only disagree by editing this one line.
 */
export const CHAT_ATTACHMENT_URL_PREFIX = '/attachments'

/**
 * The only image types the Anthropic API accepts. `chatAttachmentSchema` only
 * enforces `/^image\//i`, which is far wider (svg, bmp, heic, ...), so this
 * mapping — not the wire schema — is the real allowlist for what gets written
 * to the blob store, served back, and handed to a model.
 */
export const CHAT_ATTACHMENT_FILE_EXTENSIONS = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const

export type ChatAttachmentMimeType = keyof typeof CHAT_ATTACHMENT_FILE_EXTENSIONS

export function chatAttachmentExtension(mimeType: string): string | null {
  const normalized = mimeType.trim().toLowerCase()
  if (!Object.hasOwn(CHAT_ATTACHMENT_FILE_EXTENSIONS, normalized)) return null

  return CHAT_ATTACHMENT_FILE_EXTENSIONS[normalized as ChatAttachmentMimeType]
}

/**
 * Where an attachment's bytes are served from, relative to the server origin.
 * Derived rather than stored on the message: `id` and `mimeType` already decide
 * the blob's name on disk, so a persisted second copy could only ever go stale.
 * Null for a type outside the allowlist — which is exactly when no blob exists.
 */
export function chatAttachmentUrlPath(
  attachment: Pick<ChatAttachment, 'id' | 'mimeType'>,
): string | null {
  const extension = chatAttachmentExtension(attachment.mimeType)
  if (!extension) return null

  return `${CHAT_ATTACHMENT_URL_PREFIX}/${encodeURIComponent(attachment.id)}${extension}`
}

/**
 * Fractional index into an arranged list — the pinned session block and the
 * project list both sit on it. Validated rather than taken as any string: the
 * list sorts by plain string comparison, so one malformed key (an
 * out-of-alphabet character, or a trailing minimum digit that leaves no room to
 * insert before it) silently corrupts the arranged order for everyone.
 */
export const orderKeySchema = v.pipe(
  trimmedNonEmptyStringSchema,
  v.check(isValidOrderKey, 'Order key must be a lowercase a-z string not ending in "a"'),
)

/**
 * A command the project already knows how to run — `dev`, `test`, the migration
 * one nobody remembers the flags for. Stored on the project rather than read off
 * `package.json` on demand: not every project is a Node one, the useful list is
 * usually a subset of what the manifest holds, and a name the user chose beats a
 * key someone else did.
 */
export const orchestrationProjectScriptSchema = v.object({
  command: trimmedNonEmptyStringSchema,
  name: trimmedNonEmptyStringSchema,
})

export const repositoryIdentitySchema = v.variant('source', [
  v.object({
    source: v.literal('git-remote'),
    remoteName: v.literal('origin'),
    canonical: trimmedNonEmptyStringSchema,
    host: trimmedNonEmptyStringSchema,
    path: trimmedNonEmptyStringSchema,
  }),
  v.object({ source: v.literal('root-commit'), canonical: trimmedNonEmptyStringSchema }),
  v.object({ source: v.literal('path'), canonical: trimmedNonEmptyStringSchema }),
])

export const repositoryKindSchema = v.picklist(['git', 'directory'])

export const orchestrationWorktreeSchema = v.object({
  id: worktreeIdSchema,
  projectId: projectIdSchema,
  registrationGeneration: nonNegativeIntegerSchema,
  canonicalPath: trimmedNonEmptyStringSchema,
  path: v.string(),
  branch: v.nullable(trimmedNonEmptyStringSchema),
  kind: v.picklist(['current', 'linked']),
  ownership: v.picklist(['protected', 'external', 'platform', 'unclaimed']),
  ...worktreeLifecycleEntries,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  retiredAt: v.nullable(isoDateTimeSchema),
})

export const worktreeRegistrationEntries = {
  ...v.omit(orchestrationWorktreeSchema, [
    'id',
    'retiredAt',
    'lifecycle',
    'operationId',
    'baseWorktreeId',
    'baseCommit',
    'headCommit',
    'metadataVersion',
    'pathKind',
    'activeTerminalCount',
    'terminalOwnershipUnknown',
    'externalDriverUnverified',
    'removedAt',
    'worktreeCreationCapability',
    'cleanupEligibility',
  ]).entries,
  worktreeId: worktreeIdSchema,
} as const

export const orchestrationProjectSchema = v.object({
  id: projectIdSchema,
  title: trimmedNonEmptyStringSchema,
  repositoryKey: trimmedNonEmptyStringSchema,
  repositoryKind: repositoryKindSchema,
  repositoryIdentity: repositoryIdentitySchema,
  defaultModelSelection: v.nullable(modelSelectionSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: v.nullable(isoDateTimeSchema),
  // Null until the user drags the project: an unplaced project sorts after the
  // arranged run instead of jumping into the middle of it.
  orderKey: v.optional(v.nullable(orderKeySchema), null),
  scripts: v.optional(v.array(orchestrationProjectScriptSchema), []),
})

export const orchestrationMessageRoleSchema = v.picklist(['user', 'assistant', 'system'])

export const importedSessionMessageSchema = v.object({
  id: messageIdSchema,
  role: v.picklist(['user', 'assistant']),
  text: v.string(),
  createdAt: isoDateTimeSchema,
})

export const orchestrationMessageSchema = v.object({
  id: messageIdSchema,
  sessionId: sessionIdSchema,
  role: orchestrationMessageRoleSchema,
  text: v.string(),
  attachments: v.optional(chatAttachmentsSchema, []),
  turnId: v.nullable(turnIdSchema),
  streaming: v.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

export const orchestrationSessionActivityToneSchema = v.picklist([
  'info',
  'tool',
  'thinking',
  'approval',
  'error',
])

export const orchestrationSessionActivitySchema = v.object({
  id: eventIdSchema,
  sessionId: sessionIdSchema,
  tone: orchestrationSessionActivityToneSchema,
  kind: trimmedNonEmptyStringSchema,
  summary: trimmedNonEmptyStringSchema,
  payload: v.unknown(),
  turnId: v.nullable(turnIdSchema),
  sequence: v.optional(nonNegativeIntegerSchema),
  createdAt: isoDateTimeSchema,
})

export const orchestrationProposedPlanSchema = v.object({
  id: proposedPlanIdSchema,
  sessionId: sessionIdSchema,
  turnId: v.nullable(turnIdSchema),
  planMarkdown: trimmedNonEmptyStringSchema,
  /**
   * Stamped once a turn has been started from this plan. It is what makes the
   * plan card stop offering "Implement", and the only honest source for a
   * session's actionable-plan flag — without it the flag can only latch true.
   * Absent and null both mean "not implemented": the producer of a brand new
   * plan has nothing to say about implementation yet.
   */
  implementedAt: v.optional(v.nullable(isoDateTimeSchema)),
  implementationSessionId: v.optional(v.nullable(sessionIdSchema)),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
})

/**
 * One vocabulary for a session's liveness, shared by the projection, the
 * provider binding row and the adapter event stream — the three used to spell
 * it separately and `waiting` meant a different thing in each.
 *
 * `waiting` is the agent mid-work with the turn parked: compaction, or an
 * approval nobody has answered. It is live state that dies with the process,
 * which is why it counts as active everywhere and is never reclaimable.
 */
export const sessionRuntimeStatusSchema = v.picklist([
  'idle',
  'starting',
  'running',
  'waiting',
  'ready',
  'interrupted',
  'stopped',
  'error',
])

export const sessionRuntimeStateSchema = v.object({
  sessionId: sessionIdSchema,
  status: sessionRuntimeStatusSchema,
  providerName: v.nullable(trimmedNonEmptyStringSchema),
  providerInstanceId: v.optional(providerInstanceIdSchema),
  providerBindingHandle: v.nullable(providerBindingHandleSchema),
  providerConversationMarker: v.nullable(providerConversationMarkerSchema),
  providerResumeCursor: v.nullable(providerResumeCursorSchema),
  runtimeEpoch: trimmedNonEmptyStringSchema,
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  activeTurnId: v.nullable(turnIdSchema),
  lastError: v.nullable(trimmedNonEmptyStringSchema),
  updatedAt: isoDateTimeSchema,
})

const orchestrationLatestTurnStateSchema = v.picklist([
  'running',
  'interrupted',
  'completed',
  'error',
])

export const sourceProposedPlanReferenceSchema = v.object({
  sessionId: sessionIdSchema,
  planId: proposedPlanIdSchema,
})

export const orchestrationLatestTurnSchema = v.object({
  turnId: turnIdSchema,
  state: orchestrationLatestTurnStateSchema,
  requestedAt: isoDateTimeSchema,
  startedAt: v.nullable(isoDateTimeSchema),
  completedAt: v.nullable(isoDateTimeSchema),
  assistantMessageId: v.nullable(messageIdSchema),
  sourceProposedPlan: v.optional(sourceProposedPlanReferenceSchema),
  providerStartState: v.picklist([
    'blocked-on-worktree',
    'queued',
    'claimed',
    'adopted',
    'settled',
    'interrupted',
  ]),
  providerStartGeneration: nonNegativeIntegerSchema,
  providerStartSequence: nonNegativeIntegerSchema,
  runtimeEpoch: v.nullable(trimmedNonEmptyStringSchema),
})

export const orchestrationCheckpointStatusSchema = v.picklist(['ready', 'missing', 'error'])

export const orchestrationCheckpointFileSchema = v.object({
  path: v.string(),
  kind: trimmedNonEmptyStringSchema,
  additions: nonNegativeIntegerSchema,
  deletions: nonNegativeIntegerSchema,
})

export const orchestrationCheckpointSummarySchema = v.object({
  turnId: turnIdSchema,
  checkpointTurnCount: nonNegativeIntegerSchema,
  checkpointRef: trimmedNonEmptyStringSchema,
  status: orchestrationCheckpointStatusSchema,
  files: v.array(orchestrationCheckpointFileSchema),
  assistantMessageId: v.nullable(messageIdSchema),
  completedAt: isoDateTimeSchema,
})

/**
 * `settled` is the user parking a session by hand; `active` is the user pulling
 * it back out. `null` is neither — the session classifies purely on its own
 * activity, which is where real work always resets it.
 */
export const sessionSettledOverrideSchema = v.picklist(['settled', 'active'])

/**
 * `user` is an explicit button; `activity` is the server clearing the state
 * because real work arrived. Only the server can stamp `activity`, so a client
 * cannot forge the neutral reset.
 */
export const sessionLifecycleReasonSchema = v.picklist(['user', 'activity'])

/**
 * The settle / snooze / pin lifecycle a session carries alongside its work.
 * Shared as entries so every session-shaped schema projects the same fields
 * instead of re-declaring them and drifting.
 */
export const orchestrationSessionLifecycleEntries = {
  // Absent and null both mean "the user has said nothing": every field is
  // optional so a session payload minted before this lifecycle existed — or by a
  // producer that only cares about the work — still decodes.
  settledOverride: v.optional(v.nullable(sessionSettledOverrideSchema)),
  settledAt: v.optional(v.nullable(isoDateTimeSchema)),
  // Snooze is an overlay on the active lifecycle, not a fourth destination: a
  // snoozed session is still active and is only suppressed from the inbox until
  // `snoozedUntil` passes or the session raises its hand.
  snoozedUntil: v.optional(v.nullable(isoDateTimeSchema)),
  snoozedAt: v.optional(v.nullable(isoDateTimeSchema)),
  // A pin outranks the whole lifecycle: while `pinnedAt` is set the session
  // renders in the pinned block and never classifies into a shelf.
  pinnedAt: v.optional(v.nullable(isoDateTimeSchema)),
  pinOrderKey: v.optional(v.nullable(orderKeySchema)),
} as const

export const sessionOriginSchema = v.picklist(['platform', 'discovered'])
export const sessionAttentionStateSchema = v.picklist(['needs-input', 'working', 'settled'])
export const sessionAttentionReasonSchema = v.nullable(
  v.picklist(['approval', 'user-input', 'interruption', 'worktree', 'failure', 'plan', 'active']),
)
export const sessionProviderStopStateSchema = v.picklist([
  'requested',
  'completed',
  'no-binding',
  'failed',
])
export const sessionBlobCleanupStateSchema = v.picklist(['requested', 'completed', 'failed'])

export const sessionDeletionStateSchema = v.object({
  deletionSequence: nonNegativeIntegerSchema,
  providerStop: sessionProviderStopStateSchema,
  blobCleanup: sessionBlobCleanupStateSchema,
  providerStopError: v.nullable(trimmedNonEmptyStringSchema),
  blobCleanupError: v.nullable(trimmedNonEmptyStringSchema),
  updatedAt: isoDateTimeSchema,
})

export const sessionAttentionEntries = {
  attentionState: sessionAttentionStateSchema,
  attentionReason: sessionAttentionReasonSchema,
  acknowledgedFailureThroughSequence: v.nullable(nonNegativeIntegerSchema),
  hasError: v.boolean(),
} as const

export const orchestrationSessionSchema = v.object({
  id: sessionIdSchema,
  worktreeId: worktreeIdSchema,
  origin: sessionOriginSchema,
  ...sessionAttentionEntries,
  title: trimmedNonEmptyStringSchema,
  modelSelection: modelSelectionSchema,
  runtimeMode: v.optional(runtimeModeSchema, DEFAULT_RUNTIME_MODE),
  interactionMode: v.optional(interactionModeSchema, DEFAULT_INTERACTION_MODE),
  latestTurn: v.nullable(orchestrationLatestTurnSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  archivedAt: v.nullable(isoDateTimeSchema),
  deletedAt: v.nullable(isoDateTimeSchema),
  messages: v.array(orchestrationMessageSchema),
  activities: v.array(orchestrationSessionActivitySchema),
  runtime: v.nullable(sessionRuntimeStateSchema),
  deletion: v.nullable(sessionDeletionStateSchema),
  ...orchestrationSessionLifecycleEntries,
})

export type IsoDateTime = v.InferOutput<typeof isoDateTimeSchema>
export type ChatAttachment = v.InferOutput<typeof chatAttachmentSchema>
export type ChatAttachmentUpload = v.InferOutput<typeof chatAttachmentUploadSchema>
export type OrchestrationProject = v.InferOutput<typeof orchestrationProjectSchema>
export type RepositoryIdentity = v.InferOutput<typeof repositoryIdentitySchema>
export type RepositoryKind = v.InferOutput<typeof repositoryKindSchema>
export type OrchestrationWorktree = v.InferOutput<typeof orchestrationWorktreeSchema>
export type SessionOrigin = v.InferOutput<typeof sessionOriginSchema>
export type SessionAttentionState = v.InferOutput<typeof sessionAttentionStateSchema>
export type SessionAttentionReason = v.InferOutput<typeof sessionAttentionReasonSchema>
export type SessionDeletionState = v.InferOutput<typeof sessionDeletionStateSchema>
export type SessionProviderStopState = v.InferOutput<typeof sessionProviderStopStateSchema>
export type SessionBlobCleanupState = v.InferOutput<typeof sessionBlobCleanupStateSchema>
export type OrchestrationProjectScript = v.InferOutput<typeof orchestrationProjectScriptSchema>
export type OrchestrationMessageRole = v.InferOutput<typeof orchestrationMessageRoleSchema>
export type OrchestrationMessage = v.InferOutput<typeof orchestrationMessageSchema>
export type OrchestrationSessionActivityTone = v.InferOutput<
  typeof orchestrationSessionActivityToneSchema
>
export type OrchestrationSessionActivity = v.InferOutput<typeof orchestrationSessionActivitySchema>
export type OrchestrationProposedPlan = v.InferOutput<typeof orchestrationProposedPlanSchema>
export type SessionRuntimeStatus = v.InferOutput<typeof sessionRuntimeStatusSchema>
export type SessionRuntimeState = v.InferOutput<typeof sessionRuntimeStateSchema>
export type OrchestrationLatestTurn = v.InferOutput<typeof orchestrationLatestTurnSchema>
export type OrchestrationCheckpointStatus = v.InferOutput<
  typeof orchestrationCheckpointStatusSchema
>
export type OrchestrationCheckpointFile = v.InferOutput<typeof orchestrationCheckpointFileSchema>
export type OrchestrationCheckpointSummary = v.InferOutput<
  typeof orchestrationCheckpointSummarySchema
>
export type SessionSettledOverride = v.InferOutput<typeof sessionSettledOverrideSchema>
export type SessionLifecycleReason = v.InferOutput<typeof sessionLifecycleReasonSchema>
export type OrchestrationSession = v.InferOutput<typeof orchestrationSessionSchema>
