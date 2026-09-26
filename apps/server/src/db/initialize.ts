import { elapsedMs } from '@workspace/utils/timing'
import { sql, type SQL } from 'drizzle-orm'

import { recordProcessInfo } from '../observability/runtime'
import { getDefaultPlatformDatabase, type PlatformDatabase } from './client'
import { environmentIdentity } from './schema'
import { dbErrors } from './structured-errors'

/** Stamped in `PRAGMA user_version`. Any change to `SCHEMA` bumps it. */
export const SCHEMA_VERSION = 1

/**
 * Creates the schema in an empty database and accepts one already at
 * `SCHEMA_VERSION`. Anything else is refused: a database from another schema is
 * deleted by its owner, never repaired here.
 */
export function initializePlatformDatabase(
  database: PlatformDatabase = getDefaultPlatformDatabase(),
) {
  if (userVersion(database) === SCHEMA_VERSION) return

  const startedAt = performance.now()
  database.transaction(
    (transaction) => {
      // Same query API as the database; the cast keeps the helpers typed once.
      const scoped = transaction as unknown as PlatformDatabase
      // Re-read under the write lock: a peer process may have created it first.
      const found = userVersion(scoped)
      if (found === SCHEMA_VERSION) return
      const objectCount = schemaObjectCount(scoped)
      if (found !== 0 || objectCount > 0) throw schemaMismatch(scoped, found, objectCount)

      createSchema(scoped)
      recordProcessInfo('db.schema.created', {
        area: 'db',
        operation: 'initialize',
        schema: { durationMs: elapsedMs(startedAt), version: SCHEMA_VERSION },
      })
    },
    { behavior: 'immediate' },
  )
}

function createSchema(database: PlatformDatabase) {
  for (const statement of SCHEMA) database.run(sql.raw(statement))
  database
    .insert(environmentIdentity)
    .values({ id: crypto.randomUUID(), createdAt: new Date().toISOString() })
    .run()
  database.run(sql.raw(`PRAGMA user_version = ${SCHEMA_VERSION}`))
}

function userVersion(database: PlatformDatabase) {
  return firstRow<{ user_version: number }>(database, sql`PRAGMA user_version`).user_version
}

function schemaObjectCount(database: PlatformDatabase) {
  return firstRow<{ count: number }>(database, sql`SELECT count(*) AS count FROM sqlite_master`)
    .count
}

// `get` hands back a value tuple on bun-sqlite; `all` keeps the column names.
function firstRow<T>(database: PlatformDatabase, query: SQL) {
  const [row] = database.all<T>(query)
  if (row === undefined) throw new TypeError('Expected a row')
  return row
}

function schemaMismatch(database: PlatformDatabase, found: number, objectCount: number) {
  const { file } = firstRow<{ file: string }>(
    database,
    sql`SELECT file FROM pragma_database_list WHERE name = 'main'`,
  )
  const databasePath = file || ':memory:'

  return dbErrors.SCHEMA_VERSION_MISMATCH({
    databasePath,
    found,
    internal: { databasePath, expectedVersion: SCHEMA_VERSION, foundVersion: found, objectCount },
  })
}

// Columns keep the declared spelling of the chain this replaced (versions 11 to 38),
// so `PRAGMA table_info` reads the same on both.
const SCHEMA = [
  `CREATE TABLE "environment_identity" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL
)`,
  `CREATE TABLE "fs_metadata" (
  "path" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "entry_type" text NOT NULL,
  "size" integer NOT NULL,
  "mtime_ms" integer NOT NULL,
  "birthtime_ms" integer NOT NULL DEFAULT 0,
  "last_picked_at" integer,
  "pick_count" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
)`,
  `CREATE TABLE workspace_addresses (
  id TEXT PRIMARY KEY NOT NULL,
  filesystem_root TEXT NOT NULL,
  canonical_path TEXT NOT NULL
)`,
  `CREATE TABLE "orchestration_command_receipts" (
  "command_id" text PRIMARY KEY NOT NULL,
  "command_type" text NOT NULL,
  "aggregate_kind" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "accepted_at" text NOT NULL,
  "result_sequence" integer,
  "status" text NOT NULL,
  "command_json" text NOT NULL,
  "intent_fingerprint" text NOT NULL,
  "result_json" text,
  "error" text,
  CONSTRAINT "orchestration_receipt_result_sequence" CHECK (("status" = 'accepted' AND "result_sequence" IS NOT NULL) OR ("status" = 'rejected' AND "result_sequence" IS NULL))
)`,
  `CREATE TABLE "orchestration_events" (
  "sequence" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "event_id" text NOT NULL UNIQUE,
  "aggregate_kind" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "stream_version" integer NOT NULL,
  "event_type" text NOT NULL,
  "occurred_at" text NOT NULL,
  "command_id" text,
  "causation_event_id" text,
  "correlation_id" text,
  "actor_kind" text NOT NULL,
  "payload_json" text NOT NULL,
  "metadata_json" text NOT NULL
)`,
  `CREATE TABLE "projection_state" (
  "projector" text PRIMARY KEY NOT NULL,
  "last_applied_sequence" integer NOT NULL,
  "updated_at" text NOT NULL
)`,
  `CREATE TABLE "projection_projects" (
  "project_id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "repository_key" text NOT NULL,
  "repository_kind" text NOT NULL,
  "repository_identity_json" text NOT NULL,
  "default_model_selection_json" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "deleted_at" text,
  "order_key" text,
  "scripts_json" text
)`,
  `CREATE TABLE "projection_worktrees" (
  "worktree_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "registration_generation" integer NOT NULL,
  "canonical_path" text NOT NULL,
  "path" text NOT NULL,
  "branch" text,
  "kind" text NOT NULL,
  "ownership" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "retired_at" text,
  "retirement_sequence" integer,
  base_worktree_id TEXT,
  base_commit TEXT,
  head_commit TEXT,
  metadata_version INTEGER NOT NULL DEFAULT 0,
  path_kind TEXT NOT NULL DEFAULT 'legacy',
  lifecycle_json TEXT NOT NULL DEFAULT '{"state":"ready"}',
  operation_id TEXT,
  active_terminal_count INTEGER NOT NULL DEFAULT 0 CHECK (active_terminal_count >= 0),
  terminal_ownership_unknown INTEGER NOT NULL DEFAULT 0,
  external_driver_unverified INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  lifecycle_state TEXT NOT NULL DEFAULT 'ready' CHECK ((lifecycle_state = 'removed') = (removed_at IS NOT NULL)),
  creation_capability_json TEXT NOT NULL DEFAULT '{"allowed":false,"reason":"base-not-ready"}',
  cleanup_eligibility_json TEXT NOT NULL DEFAULT '{"reason":"not-ready","nonDeletedSessionCount":0,"canResolveMissing":false}',
  pull_request_json TEXT,
  setup_json TEXT,
  base_branch TEXT,
  FOREIGN KEY ("project_id") REFERENCES "projection_projects" ("project_id"),
  CONSTRAINT "projection_worktrees_current_protected" CHECK ("kind" != 'current' OR "ownership" = 'protected'),
  CONSTRAINT "projection_worktrees_registration_generation" CHECK ("registration_generation" >= 0)
)`,
  `CREATE TABLE projection_terminal_leases (
  terminal_lease_id TEXT PRIMARY KEY NOT NULL,
  worktree_id TEXT NOT NULL REFERENCES projection_worktrees(worktree_id),
  runtime_epoch TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  key TEXT
)`,
  `CREATE TABLE "projection_sessions" (
  "session_id" text PRIMARY KEY NOT NULL,
  "worktree_id" text NOT NULL,
  "origin" text NOT NULL,
  "attention_state" text NOT NULL,
  "attention_reason" text,
  "has_error" integer NOT NULL DEFAULT 0,
  "acknowledged_failure_through_sequence" integer,
  "latest_failure_sequence" integer,
  "latest_interruption_sequence" integer,
  "runtime_sequence" integer,
  "provider_stop_state" text,
  "blob_cleanup_state" text,
  "provider_stop_error" text,
  "blob_cleanup_error" text,
  "deletion_updated_at" text,
  "deletion_sequence" integer,
  "title" text NOT NULL,
  "runtime_mode" text NOT NULL,
  "interaction_mode" text NOT NULL,
  "model_selection_json" text NOT NULL,
  "latest_turn_id" text,
  "latest_turn_json" text,
  "latest_user_message_at" text,
  "pending_approval_count" integer NOT NULL DEFAULT 0,
  "pending_user_input_count" integer NOT NULL DEFAULT 0,
  "has_actionable_proposed_plan" integer NOT NULL DEFAULT 0,
  "plan_progress_json" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "archived_at" text,
  "deleted_at" text,
  "settled_override" text,
  "settled_at" text,
  "snoozed_until" text,
  "snoozed_at" text,
  "pinned_at" text,
  "pin_order_key" text,
  pending_rewind_command_id TEXT,
  pending_rewind_restore_files INTEGER NOT NULL DEFAULT 0,
  active_order_key TEXT,
  unsettled_at TEXT,
  title_state_json TEXT,
  title_regeneration_json TEXT,
  title_generation_error TEXT,
  lifecycle_revision INTEGER NOT NULL DEFAULT 0,
  forked_from_json TEXT,
  agent TEXT,
  FOREIGN KEY ("worktree_id") REFERENCES "projection_worktrees" ("worktree_id")
)`,
  `CREATE TABLE "projection_session_messages" (
  "message_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "turn_id" text,
  "role" text NOT NULL,
  "text" text NOT NULL,
  "attachments_json" text NOT NULL DEFAULT '[]',
  "streaming" integer NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  model_selection_json TEXT,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "projection_session_activities" (
  "activity_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "turn_id" text,
  "tone" text NOT NULL,
  "kind" text NOT NULL,
  "summary" text NOT NULL,
  "payload_json" text NOT NULL,
  "sequence" integer,
  "created_at" text NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "projection_session_runtime" (
  "session_id" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "provider_name" text,
  "provider_instance_id" text NOT NULL,
  "provider_binding_handle" text,
  "provider_conversation_marker" text,
  "provider_resume_cursor" text,
  "runtime_epoch" text NOT NULL,
  "runtime_mode" text NOT NULL,
  "active_turn_id" text,
  "last_error" text,
  "updated_at" text NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "projection_session_proposed_plans" (
  "plan_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "turn_id" text,
  "plan_markdown" text NOT NULL,
  "implemented_at" text,
  "implementation_session_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "projection_session_checkpoints" (
  "session_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "checkpoint_turn_count" integer NOT NULL,
  "checkpoint_ref" text NOT NULL,
  "status" text NOT NULL,
  "files_json" text NOT NULL,
  "assistant_message_id" text,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("session_id", "turn_id"),
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "projection_turns" (
  "row_id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "session_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "user_message_id" text,
  "assistant_message_id" text,
  "state" text NOT NULL,
  "source_proposed_plan_json" text,
  "provider_start_state" text NOT NULL,
  "provider_start_generation" integer NOT NULL,
  "provider_start_sequence" integer NOT NULL,
  "runtime_epoch" text,
  "requested_at" text NOT NULL,
  "started_at" text,
  "completed_at" text,
  end_reason TEXT,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE "provider_session_runtime" (
  "session_id" text PRIMARY KEY NOT NULL,
  "provider_driver_kind" text NOT NULL,
  "provider_instance_id" text NOT NULL,
  "provider_binding_handle" text,
  "provider_conversation_marker" text,
  "runtime_epoch" text NOT NULL,
  "adapter_key" text NOT NULL,
  "runtime_mode" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "provider_resume_cursor_json" text,
  "runtime_payload_json" text,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE agent_terminal_handoffs (
  session_id TEXT PRIMARY KEY NOT NULL,
  provider_instance_id TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  terminal_lease_id TEXT NOT NULL,
  runtime_epoch TEXT NOT NULL,
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  baseline_json TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('active', 'history'))
)`,
  `CREATE TABLE attachment_upload_owners (
  attachment_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  attachment_json TEXT NOT NULL
)`,
  `CREATE TABLE terminal_history_chunks (
  owner TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (owner, sequence)
)`,
  `CREATE TABLE terminal_session_offsets (
  owner TEXT PRIMARY KEY NOT NULL,
  offset INTEGER NOT NULL
)`,
  `CREATE TABLE terminal_session_cleanup (
  session_id TEXT PRIMARY KEY NOT NULL
)`,
  `CREATE TABLE provider_usage_turns (
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_instance_id TEXT NOT NULL,
  driver_kind TEXT NOT NULL,
  account_key TEXT,
  recorded_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER NOT NULL,
  cost_usd REAL,
  purpose TEXT NOT NULL DEFAULT 'turn',
  price_snapshot TEXT,
  contributions_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'live',
  PRIMARY KEY (session_id, turn_id, model)
)`,
  `CREATE TABLE provider_usage_baselines (
  session_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  model TEXT NOT NULL,
  totals_json TEXT NOT NULL,
  PRIMARY KEY (session_id, scope, model)
)`,
  `CREATE TABLE provider_usage_import_requests (
  billing_scope TEXT NOT NULL,
  billing_key TEXT NOT NULL,
  model TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  provider_instance_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  amounts_json TEXT NOT NULL,
  PRIMARY KEY (billing_scope, billing_key, model)
)`,
  `CREATE TABLE provider_price_catalog (
  id INTEGER PRIMARY KEY,
  snapshot_json TEXT NOT NULL
)`,
  `CREATE TABLE provider_reset_credit_attempts (
  account_key TEXT PRIMARY KEY NOT NULL,
  credit_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed')),
  settled_at TEXT,
  CHECK ((outcome IS NULL) = (settled_at IS NULL))
)`,
  `CREATE TABLE push_devices (
  revision TEXT NOT NULL,
  id TEXT PRIMARY KEY NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL,
  service TEXT NOT NULL,
  origin TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  `CREATE INDEX fs_metadata_recent_idx ON fs_metadata (last_picked_at DESC)`,
  `CREATE INDEX fs_metadata_entry_type_idx ON fs_metadata (entry_type)`,
  `CREATE UNIQUE INDEX workspace_addresses_directory_idx ON workspace_addresses (filesystem_root, canonical_path)`,
  `CREATE INDEX "orchestration_command_receipts_aggregate_idx" ON "orchestration_command_receipts" ("aggregate_kind", "aggregate_id")`,
  `CREATE INDEX "orchestration_command_receipts_sequence_idx" ON "orchestration_command_receipts" ("result_sequence")`,
  `CREATE UNIQUE INDEX "orchestration_events_stream_version_idx" ON "orchestration_events" ("aggregate_kind", "aggregate_id", "stream_version")`,
  `CREATE INDEX "orchestration_events_sequence_idx" ON "orchestration_events" ("sequence")`,
  `CREATE INDEX "orchestration_events_aggregate_sequence_idx" ON "orchestration_events" ("aggregate_kind", "aggregate_id", "sequence")`,
  `CREATE INDEX "orchestration_events_command_id_idx" ON "orchestration_events" ("command_id")`,
  `CREATE INDEX "orchestration_events_correlation_id_idx" ON "orchestration_events" ("correlation_id")`,
  `CREATE INDEX "projection_projects_updated_at_idx" ON "projection_projects" ("updated_at")`,
  `CREATE UNIQUE INDEX "projection_projects_live_repository_idx" ON "projection_projects" ("repository_key") WHERE "deleted_at" IS NULL`,
  `CREATE UNIQUE INDEX "projection_worktrees_live_path_idx" ON "projection_worktrees" ("canonical_path") WHERE "retired_at" IS NULL`,
  `CREATE UNIQUE INDEX "projection_worktrees_current_idx" ON "projection_worktrees" ("project_id") WHERE "retired_at" IS NULL AND "kind" = 'current'`,
  `CREATE INDEX "projection_worktrees_project_idx" ON "projection_worktrees" ("project_id")`,
  `CREATE INDEX projection_worktrees_lifecycle_idx ON projection_worktrees (lifecycle_state)`,
  `CREATE INDEX projection_terminal_leases_worktree_idx ON projection_terminal_leases(worktree_id)`,
  `CREATE INDEX "projection_sessions_worktree_deleted_created_idx" ON "projection_sessions" ("worktree_id", "deleted_at", "created_at")`,
  `CREATE INDEX "projection_sessions_pinned_order_idx" ON "projection_sessions" ("pinned_at", "pin_order_key")`,
  `CREATE INDEX projection_session_messages_session_created_idx ON projection_session_messages (session_id, created_at, message_id)`,
  `CREATE INDEX "projection_session_activities_session_created_idx" ON "projection_session_activities" ("session_id", "created_at")`,
  `CREATE INDEX "projection_session_activities_session_kind_idx" ON "projection_session_activities" ("session_id", "kind")`,
  `CREATE INDEX "projection_session_runtime_binding_handle_idx" ON "projection_session_runtime" ("provider_binding_handle")`,
  `CREATE INDEX "projection_session_runtime_provider_instance_idx" ON "projection_session_runtime" ("provider_instance_id")`,
  `CREATE INDEX "projection_session_proposed_plans_session_created_idx" ON "projection_session_proposed_plans" ("session_id", "created_at")`,
  `CREATE INDEX "projection_session_proposed_plans_session_updated_idx" ON "projection_session_proposed_plans" ("session_id", "updated_at")`,
  `CREATE INDEX "projection_session_checkpoints_session_turn_count_idx" ON "projection_session_checkpoints" ("session_id", "checkpoint_turn_count")`,
  `CREATE UNIQUE INDEX "projection_turns_session_turn_idx" ON "projection_turns" ("session_id", "turn_id")`,
  `CREATE INDEX "projection_turns_session_requested_idx" ON "projection_turns" ("session_id", "requested_at")`,
  `CREATE INDEX "projection_turns_provider_start_idx" ON "projection_turns" ("provider_start_state", "session_id")`,
  `CREATE INDEX "provider_session_runtime_provider_instance_idx" ON "provider_session_runtime" ("provider_instance_id")`,
  `CREATE INDEX "provider_session_runtime_binding_handle_idx" ON "provider_session_runtime" ("provider_binding_handle")`,
  `CREATE INDEX attachment_upload_owners_session_idx ON attachment_upload_owners (session_id)`,
  `CREATE INDEX provider_usage_turns_recorded_idx ON provider_usage_turns (recorded_at)`,
  `CREATE INDEX provider_usage_import_requests_turn_idx ON provider_usage_import_requests (session_id, turn_id, model)`,
] as const
