import type { RecordedModelPrice } from '../provider/utils/model-prices'
import type { UsageContribution } from '../provider/utils/usage-contributions'
import type { ProviderUsageAmounts } from '../provider/utils/usage-totals'
import {
  TURN_END_REASONS,
  providerUsagePurposeSchema,
  pushServiceSchema,
  sessionRuntimeStatusSchema,
  type WorkspaceAddressId,
} from '@workspace/contracts'
import { sql } from 'drizzle-orm'
import {
  check,
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const terminalSessionCleanup = sqliteTable('terminal_session_cleanup', {
  sessionId: text('session_id').primaryKey(),
})

export const terminalHistoryChunks = sqliteTable(
  'terminal_history_chunks',
  {
    owner: text('owner').notNull(),
    sequence: integer('sequence').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.sequence] })],
)

/**
 * Tokens and cost per turn and model. Not a projection of the event log and not tied
 * to the session row: what a turn cost stays spent after its session is deleted.
 * `price_snapshot` pins catalog estimates to the rates used when recording.
 */
export const providerUsageTurns = sqliteTable(
  'provider_usage_turns',
  {
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id').notNull(),
    model: text('model').notNull(),
    providerInstanceId: text('provider_instance_id').notNull(),
    driverKind: text('driver_kind').notNull(),
    accountKey: text('account_key'),
    /** `turn` for chat; `title` and `commit-message` for the app's own generations. */
    purpose: text('purpose', { enum: providerUsagePurposeSchema.options }).notNull(),
    /** `import` for turns read back from a transcript of a session begun outside Platform. */
    source: text('source', { enum: ['live', 'import'] })
      .notNull()
      .default('live'),
    recordedAt: text('recorded_at').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    reasoningTokens: integer('reasoning_tokens').notNull(),
    costUsd: real('cost_usd'),
    priceSnapshot: text('price_snapshot', { mode: 'json' }).$type<RecordedModelPrice>(),
    contributions: text('contributions_json', { mode: 'json' })
      .$type<UsageContribution[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.turnId, table.model] }),
    index('provider_usage_turns_recorded_idx').on(table.recordedAt),
  ],
)

export const providerPriceCatalog = sqliteTable('provider_price_catalog', {
  id: integer('id').primaryKey(),
  snapshotJson: text('snapshot_json').notNull(),
})

export const providerUsageImportRequests = sqliteTable(
  'provider_usage_import_requests',
  {
    billingScope: text('billing_scope').notNull(),
    billingKey: text('billing_key').notNull(),
    model: text('model').notNull(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id').notNull(),
    providerInstanceId: text('provider_instance_id').notNull(),
    recordedAt: text('recorded_at').notNull(),
    amounts: text('amounts_json', { mode: 'json' }).$type<ProviderUsageAmounts>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.billingScope, table.billingKey, table.model] }),
    index('provider_usage_import_requests_turn_idx').on(table.sessionId, table.turnId, table.model),
  ],
)

/** The last running totals seen per session, provider conversation and model. */
export const providerUsageBaselines = sqliteTable(
  'provider_usage_baselines',
  {
    sessionId: text('session_id').notNull(),
    scope: text('scope').notNull(),
    model: text('model').notNull(),
    totalsJson: text('totals_json').notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.scope, table.model] })],
)

export const attachmentUploadOwners = sqliteTable(
  'attachment_upload_owners',
  {
    attachmentId: text('attachment_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    attachmentJson: text('attachment_json').notNull(),
  },
  (table) => [index('attachment_upload_owners_session_idx').on(table.sessionId)],
)

/**
 * Browsers subscribed to Web Push from this server. `id` is `pushDeviceId(endpoint)`, so a
 * browser that registers again replaces its own row. Device records, never settings.
 */
export const pushDevices = sqliteTable('push_devices', {
  revision: text('revision').notNull(),
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  label: text('label').notNull(),
  service: text('service', { enum: pushServiceSchema.options }).notNull(),
  /** The page origin that registered it; an https one becomes the VAPID subject. */
  origin: text('origin'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const environmentIdentity = sqliteTable('environment_identity', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
})

export type EnvironmentIdentity = typeof environmentIdentity.$inferSelect

export const fsMetadata = sqliteTable('fs_metadata', {
  path: text('path').primaryKey(),
  name: text('name').notNull(),
  entryType: text('entry_type', {
    enum: ['file', 'directory', 'symlink', 'other'],
  }).notNull(),
  size: integer('size').notNull(),
  mtimeMs: integer('mtime_ms').notNull(),
  birthtimeMs: integer('birthtime_ms').notNull().default(0),
  lastPickedAt: integer('last_picked_at'),
  pickCount: integer('pick_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type FsMetadataRow = typeof fsMetadata.$inferSelect

export const workspaceAddresses = sqliteTable(
  'workspace_addresses',
  {
    id: text('id').$type<WorkspaceAddressId>().primaryKey(),
    filesystemRoot: text('filesystem_root').notNull(),
    canonicalPath: text('canonical_path').notNull(),
  },
  (table) => [
    uniqueIndex('workspace_addresses_directory_idx').on(table.filesystemRoot, table.canonicalPath),
  ],
)

export const orchestrationEvents = sqliteTable(
  'orchestration_events',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull().unique(),
    aggregateKind: text('aggregate_kind', { enum: ['project', 'worktree', 'session'] }).notNull(),
    aggregateId: text('aggregate_id').notNull(),
    streamVersion: integer('stream_version').notNull(),
    eventType: text('event_type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    commandId: text('command_id'),
    causationEventId: text('causation_event_id'),
    correlationId: text('correlation_id'),
    actorKind: text('actor_kind', { enum: ['client', 'server', 'provider'] }).notNull(),
    payloadJson: text('payload_json').notNull(),
    metadataJson: text('metadata_json').notNull(),
  },
  (table) => [
    uniqueIndex('orchestration_events_stream_version_idx').on(
      table.aggregateKind,
      table.aggregateId,
      table.streamVersion,
    ),
    index('orchestration_events_sequence_idx').on(table.sequence),
    index('orchestration_events_aggregate_sequence_idx').on(
      table.aggregateKind,
      table.aggregateId,
      table.sequence,
    ),
    index('orchestration_events_command_id_idx').on(table.commandId),
    index('orchestration_events_correlation_id_idx').on(table.correlationId),
  ],
)

export const orchestrationCommandReceipts = sqliteTable(
  'orchestration_command_receipts',
  {
    commandId: text('command_id').primaryKey(),
    commandType: text('command_type').notNull(),
    aggregateKind: text('aggregate_kind', { enum: ['project', 'worktree', 'session'] }).notNull(),
    aggregateId: text('aggregate_id').notNull(),
    acceptedAt: text('accepted_at').notNull(),
    resultSequence: integer('result_sequence'),
    status: text('status', { enum: ['accepted', 'rejected'] }).notNull(),
    commandJson: text('command_json').notNull(),
    intentFingerprint: text('intent_fingerprint').notNull(),
    resultJson: text('result_json'),
    error: text('error'),
  },
  (table) => [
    index('orchestration_command_receipts_aggregate_idx').on(
      table.aggregateKind,
      table.aggregateId,
    ),
    index('orchestration_command_receipts_sequence_idx').on(table.resultSequence),
    check(
      'orchestration_receipt_result_sequence',
      sql`(${table.status} = 'accepted' AND ${table.resultSequence} IS NOT NULL) OR (${table.status} = 'rejected' AND ${table.resultSequence} IS NULL)`,
    ),
  ],
)

export const projectionState = sqliteTable('projection_state', {
  projector: text('projector').primaryKey(),
  lastAppliedSequence: integer('last_applied_sequence').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const projectionProjects = sqliteTable(
  'projection_projects',
  {
    projectId: text('project_id').primaryKey(),
    title: text('title').notNull(),
    repositoryKey: text('repository_key').notNull(),
    repositoryKind: text('repository_kind', { enum: ['git', 'directory'] }).notNull(),
    repositoryIdentityJson: text('repository_identity_json').notNull(),
    defaultModelSelectionJson: text('default_model_selection_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
    /** Fractional index; the project list sorts on plain string comparison. */
    orderKey: text('order_key'),
    /** The project's saved commands, as one JSON array. Null before any are set. */
    scriptsJson: text('scripts_json'),
  },
  (table) => [
    index('projection_projects_updated_at_idx').on(table.updatedAt),
    uniqueIndex('projection_projects_live_repository_idx')
      .on(table.repositoryKey)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
)

export const projectionWorktrees = sqliteTable(
  'projection_worktrees',
  {
    worktreeId: text('worktree_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projectionProjects.projectId),
    registrationGeneration: integer('registration_generation').notNull(),
    canonicalPath: text('canonical_path').notNull(),
    path: text('path').notNull(),
    branch: text('branch'),
    kind: text('kind', { enum: ['current', 'linked'] }).notNull(),
    ownership: text('ownership', {
      enum: ['protected', 'external', 'platform', 'unclaimed'],
    }).notNull(),
    baseWorktreeId: text('base_worktree_id'),
    baseBranch: text('base_branch'),
    baseCommit: text('base_commit'),
    headCommit: text('head_commit'),
    metadataVersion: integer('metadata_version').notNull().default(0),
    pathKind: text('path_kind', { enum: ['id-derived', 'legacy'] })
      .notNull()
      .default('legacy'),
    lifecycleJson: text('lifecycle_json').notNull().default('{"state":"ready"}'),
    lifecycleState: text('lifecycle_state').notNull().default('ready'),
    operationId: text('operation_id'),
    activeTerminalCount: integer('active_terminal_count').notNull().default(0),
    terminalOwnershipUnknown: integer('terminal_ownership_unknown', { mode: 'boolean' })
      .notNull()
      .default(false),
    externalDriverUnverified: integer('external_driver_unverified', { mode: 'boolean' })
      .notNull()
      .default(false),
    removedAt: text('removed_at'),
    creationCapabilityJson: text('creation_capability_json')
      .notNull()
      .default('{"allowed":false,"reason":"base-not-ready"}'),
    cleanupEligibilityJson: text('cleanup_eligibility_json')
      .notNull()
      .default('{"reason":"not-ready","nonDeletedSessionCount":0,"canResolveMissing":false}'),
    pullRequestJson: text('pull_request_json'),
    setupJson: text('setup_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    retiredAt: text('retired_at'),
    retirementSequence: integer('retirement_sequence'),
  },
  (table) => [
    uniqueIndex('projection_worktrees_live_path_idx')
      .on(table.canonicalPath)
      .where(sql`${table.retiredAt} IS NULL`),
    uniqueIndex('projection_worktrees_current_idx')
      .on(table.projectId)
      .where(sql`${table.retiredAt} IS NULL AND ${table.kind} = 'current'`),
    index('projection_worktrees_project_idx').on(table.projectId),
    index('projection_worktrees_lifecycle_idx').on(table.lifecycleState),
    check(
      'projection_worktrees_removed_state',
      sql`(${table.lifecycleState} = 'removed') = (${table.removedAt} IS NOT NULL)`,
    ),
    check('projection_worktrees_terminal_count', sql`${table.activeTerminalCount} >= 0`),
    check(
      'projection_worktrees_current_protected',
      sql`${table.kind} != 'current' OR ${table.ownership} = 'protected'`,
    ),
    check(
      'projection_worktrees_registration_generation',
      sql`${table.registrationGeneration} >= 0`,
    ),
  ],
)

export const projectionTerminalLeases = sqliteTable(
  'projection_terminal_leases',
  {
    terminalLeaseId: text('terminal_lease_id').primaryKey(),
    worktreeId: text('worktree_id')
      .notNull()
      .references(() => projectionWorktrees.worktreeId),
    runtimeEpoch: text('runtime_epoch').notNull(),
    state: text('state', {
      enum: [
        'requested',
        'claimed',
        'active',
        'termination-requested',
        'ended',
        'ownership-unknown',
      ],
    }).notNull(),
    /** The host session key this lease belongs to; null for a lease begun before Plan 149. */
    key: text('key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('projection_terminal_leases_worktree_idx').on(table.worktreeId)],
)

/** The last offset each terminal session has written to history, so a reattach resumes there. */
export const terminalSessionOffsets = sqliteTable('terminal_session_offsets', {
  owner: text('owner').primaryKey(),
  offset: integer('offset').notNull(),
})

export const agentTerminalHandoffs = sqliteTable('agent_terminal_handoffs', {
  sessionId: text('session_id').primaryKey(),
  providerInstanceId: text('provider_instance_id').notNull(),
  worktreeId: text('worktree_id').notNull(),
  terminalLeaseId: text('terminal_lease_id').notNull(),
  runtimeEpoch: text('runtime_epoch').notNull(),
  cwd: text('cwd').notNull(),
  startedAt: text('started_at').notNull(),
  baselineJson: text('baseline_json').notNull(),
  phase: text('phase', { enum: ['active', 'history'] }).notNull(),
})

export const projectionSessions = sqliteTable(
  'projection_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    worktreeId: text('worktree_id')
      .notNull()
      .references(() => projectionWorktrees.worktreeId),
    origin: text('origin', { enum: ['platform', 'discovered'] }).notNull(),
    attentionState: text('attention_state', {
      enum: ['needs-input', 'working', 'settled'],
    }).notNull(),
    attentionReason: text('attention_reason', {
      enum: ['approval', 'user-input', 'interruption', 'worktree', 'failure', 'plan', 'active'],
    }),
    hasError: integer('has_error', { mode: 'boolean' }).notNull().default(false),
    acknowledgedFailureThroughSequence: integer('acknowledged_failure_through_sequence'),
    latestFailureSequence: integer('latest_failure_sequence'),
    latestInterruptionSequence: integer('latest_interruption_sequence'),
    runtimeSequence: integer('runtime_sequence'),
    providerStopState: text('provider_stop_state', {
      enum: ['requested', 'completed', 'no-binding', 'failed'],
    }),
    blobCleanupState: text('blob_cleanup_state', { enum: ['requested', 'completed', 'failed'] }),
    providerStopError: text('provider_stop_error'),
    blobCleanupError: text('blob_cleanup_error'),
    deletionUpdatedAt: text('deletion_updated_at'),
    deletionSequence: integer('deletion_sequence'),
    title: text('title').notNull(),
    runtimeMode: text('runtime_mode', {
      enum: ['full-access', 'approval-required', 'auto-accept-edits'],
    }).notNull(),
    interactionMode: text('interaction_mode', { enum: ['default', 'plan'] }).notNull(),
    modelSelectionJson: text('model_selection_json').notNull(),
    latestTurnId: text('latest_turn_id'),
    latestTurnJson: text('latest_turn_json'),
    latestUserMessageAt: text('latest_user_message_at'),
    pendingRewindCommandId: text('pending_rewind_command_id'),
    pendingRewindRestoreFiles: integer('pending_rewind_restore_files', { mode: 'boolean' })
      .notNull()
      .default(false),
    pendingApprovalCount: integer('pending_approval_count').notNull().default(0),
    pendingUserInputCount: integer('pending_user_input_count').notNull().default(0),
    hasActionableProposedPlan: integer('has_actionable_proposed_plan', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    /**
     * The plan kernel the shell delta serves, projected so a rail row never pays
     * an activity scan to say which step is running. Null is "nothing to
     * narrate".
     */
    planProgressJson: text('plan_progress_json'),
    forkedFromJson: text('forked_from_json'),
    agent: text('agent'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
    deletedAt: text('deleted_at'),
    lifecycleRevision: integer('lifecycle_revision').notNull().default(0),
    /** null = classify on activity alone; the two values are explicit user intent. */
    settledOverride: text('settled_override', { enum: ['settled', 'active'] }),
    settledAt: text('settled_at'),
    snoozedUntil: text('snoozed_until'),
    snoozedAt: text('snoozed_at'),
    pinnedAt: text('pinned_at'),
    /** Fractional index; the pinned block sorts on plain string comparison. */
    pinOrderKey: text('pin_order_key'),
    activeOrderKey: text('active_order_key'),
    titleStateJson: text('title_state_json'),
    titleRegenerationJson: text('title_regeneration_json'),
    titleGenerationError: text('title_generation_error'),
    unsettledAt: text('unsettled_at'),
  },
  (table) => [
    index('projection_sessions_worktree_deleted_created_idx').on(
      table.worktreeId,
      table.deletedAt,
      table.createdAt,
    ),
    // The session list reads the pinned block first and orders it by key, so the
    // pinned rows are found without scanning every session of the project.
    index('projection_sessions_pinned_order_idx').on(table.pinnedAt, table.pinOrderKey),
  ],
)

export const projectionSessionMessages = sqliteTable(
  'projection_session_messages',
  {
    messageId: text('message_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => projectionSessions.sessionId),
    turnId: text('turn_id'),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    text: text('text').notNull(),
    attachmentsJson: text('attachments_json').notNull().default('[]'),
    modelSelectionJson: text('model_selection_json'),
    streaming: integer('streaming', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('projection_session_messages_session_created_idx').on(
      table.sessionId,
      table.createdAt,
      table.messageId,
    ),
  ],
)

export const projectionSessionActivities = sqliteTable(
  'projection_session_activities',
  {
    activityId: text('activity_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => projectionSessions.sessionId),
    turnId: text('turn_id'),
    tone: text('tone', { enum: ['info', 'tool', 'thinking', 'approval', 'error'] }).notNull(),
    kind: text('kind').notNull(),
    summary: text('summary').notNull(),
    payloadJson: text('payload_json').notNull(),
    sequence: integer('sequence'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('projection_session_activities_session_created_idx').on(table.sessionId, table.createdAt),
    index('projection_session_activities_session_kind_idx').on(table.sessionId, table.kind),
  ],
)

export const projectionSessionRuntime = sqliteTable(
  'projection_session_runtime',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => projectionSessions.sessionId),
    status: text('status', {
      enum: sessionRuntimeStatusSchema.options,
    }).notNull(),
    providerName: text('provider_name'),
    providerInstanceId: text('provider_instance_id').notNull(),
    providerBindingHandle: text('provider_binding_handle'),
    providerConversationMarker: text('provider_conversation_marker'),
    providerResumeCursor: text('provider_resume_cursor'),
    runtimeEpoch: text('runtime_epoch').notNull(),
    runtimeMode: text('runtime_mode', {
      enum: ['full-access', 'approval-required', 'auto-accept-edits'],
    }).notNull(),
    activeTurnId: text('active_turn_id'),
    lastError: text('last_error'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('projection_session_runtime_binding_handle_idx').on(table.providerBindingHandle),
    index('projection_session_runtime_provider_instance_idx').on(table.providerInstanceId),
  ],
)

export const projectionTurns = sqliteTable(
  'projection_turns',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => projectionSessions.sessionId),
    turnId: text('turn_id').notNull(),
    userMessageId: text('user_message_id'),
    assistantMessageId: text('assistant_message_id'),
    state: text('state', {
      enum: ['running', 'completed', 'interrupted', 'error'],
    }).notNull(),
    sourceProposedPlanJson: text('source_proposed_plan_json'),
    providerStartState: text('provider_start_state', {
      enum: ['blocked-on-worktree', 'queued', 'claimed', 'adopted', 'settled', 'interrupted'],
    }).notNull(),
    providerStartGeneration: integer('provider_start_generation').notNull(),
    providerStartSequence: integer('provider_start_sequence').notNull(),
    runtimeEpoch: text('runtime_epoch'),
    requestedAt: text('requested_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    endReason: text('end_reason', { enum: TURN_END_REASONS }),
  },
  (table) => [
    uniqueIndex('projection_turns_session_turn_idx').on(table.sessionId, table.turnId),
    index('projection_turns_session_requested_idx').on(table.sessionId, table.requestedAt),
    index('projection_turns_provider_start_idx').on(table.providerStartState, table.sessionId),
  ],
)

export const projectionSessionProposedPlans = sqliteTable(
  'projection_session_proposed_plans',
  {
    planId: text('plan_id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => projectionSessions.sessionId),
    turnId: text('turn_id'),
    planMarkdown: text('plan_markdown').notNull(),
    implementedAt: text('implemented_at'),
    implementationSessionId: text('implementation_session_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('projection_session_proposed_plans_session_created_idx').on(
      table.sessionId,
      table.createdAt,
    ),
    index('projection_session_proposed_plans_session_updated_idx').on(
      table.sessionId,
      table.updatedAt,
    ),
  ],
)

export const projectionSessionCheckpoints = sqliteTable(
  'projection_session_checkpoints',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => projectionSessions.sessionId),
    turnId: text('turn_id').notNull(),
    checkpointTurnCount: integer('checkpoint_turn_count').notNull(),
    checkpointRef: text('checkpoint_ref').notNull(),
    status: text('status', { enum: ['ready', 'missing', 'error'] }).notNull(),
    filesJson: text('files_json').notNull(),
    assistantMessageId: text('assistant_message_id'),
    completedAt: text('completed_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.turnId] }),
    index('projection_session_checkpoints_session_turn_count_idx').on(
      table.sessionId,
      table.checkpointTurnCount,
    ),
  ],
)

export const providerSessionRuntime = sqliteTable(
  'provider_session_runtime',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => projectionSessions.sessionId),
    providerDriverKind: text('provider_driver_kind').notNull(),
    providerInstanceId: text('provider_instance_id').notNull(),
    providerBindingHandle: text('provider_binding_handle'),
    providerConversationMarker: text('provider_conversation_marker'),
    runtimeEpoch: text('runtime_epoch').notNull(),
    adapterKey: text('adapter_key').notNull(),
    runtimeMode: text('runtime_mode', {
      enum: ['full-access', 'approval-required', 'auto-accept-edits'],
    }).notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    providerResumeCursorJson: text('provider_resume_cursor_json'),
    runtimePayloadJson: text('runtime_payload_json'),
  },
  (table) => [
    index('provider_session_runtime_provider_instance_idx').on(table.providerInstanceId),
    index('provider_session_runtime_binding_handle_idx').on(table.providerBindingHandle),
  ],
)

export type OrchestrationEventRow = typeof orchestrationEvents.$inferSelect
export type OrchestrationCommandReceiptRow = typeof orchestrationCommandReceipts.$inferSelect
export type ProjectionProjectRow = typeof projectionProjects.$inferSelect
export type ProjectionWorktreeRow = typeof projectionWorktrees.$inferSelect
export type ProjectionTurnRow = typeof projectionTurns.$inferSelect
export type ProjectionSessionRow = typeof projectionSessions.$inferSelect
export type OrchestrationSessionMessageRow = typeof projectionSessionMessages.$inferSelect
export type OrchestrationSessionActivityRow = typeof projectionSessionActivities.$inferSelect
export type ProjectionSessionRuntimeRow = typeof projectionSessionRuntime.$inferSelect
export type ProjectionSessionProposedPlanRow = typeof projectionSessionProposedPlans.$inferSelect
export type ProjectionSessionCheckpointRow = typeof projectionSessionCheckpoints.$inferSelect
export type ProviderSessionRuntimeRow = typeof providerSessionRuntime.$inferSelect

export const providerResetCreditAttempts = sqliteTable('provider_reset_credit_attempts', {
  accountKey: text('account_key').primaryKey(),
  creditId: text('credit_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  confirmedAt: text('confirmed_at').notNull(),
  outcome: text('outcome', { enum: ['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'] }),
  settledAt: text('settled_at'),
})
