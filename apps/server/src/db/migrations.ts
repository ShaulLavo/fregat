import { elapsedMs } from '@workspace/utils/timing'
import { refreshAllWorktreePolicies } from '../orchestration/worktree-projection'
import { eq, sql } from 'drizzle-orm'

import { recordProcessInfo } from '../observability/runtime'
import { createStructuredError } from '../observability/structured-errors'
import { getDefaultPlatformDatabase, type PlatformDatabase } from './client'
import { environmentIdentity, schemaMigrations } from './schema'

export type Migration = {
  readonly version: number
  readonly name: string
  readonly up: (database: PlatformDatabase) => void
}

// Version 11 replaces obsolete developer chat state while preserving machine identity and files.
export const platformMigrations: readonly Migration[] = [
  { version: 11, name: 'session_domain', up: applySessionDomain },
  { version: 12, name: 'worktree_lifecycle', up: applyWorktreeLifecycle },
  { version: 13, name: 'workspace_addresses', up: applyWorkspaceAddresses },
  { version: 14, name: 'agent_terminal_handoffs', up: applyAgentTerminalHandoffs },
  { version: 15, name: 'message_pagination_order', up: applyMessagePaginationOrder },
  { version: 16, name: 'pending_rewind', up: applyPendingRewind },
  { version: 17, name: 'active_session_order', up: applyActiveSessionOrder },
  { version: 18, name: 'session_titles', up: applySessionTitles },
  { version: 19, name: 'attachment_upload_owners', up: applyAttachmentUploadOwners },
  { version: 20, name: 'terminal_history', up: applyTerminalHistory },
  { version: 21, name: 'provider_usage', up: applyProviderUsage },
  { version: 22, name: 'provider_usage_purpose', up: applyProviderUsagePurpose },
  { version: 23, name: 'provider_usage_prices', up: applyProviderUsagePrices },
  { version: 24, name: 'provider_usage_contributions', up: applyProviderUsageContributions },
  { version: 29, name: 'turn_end_reason', up: applyTurnEndReason },
  { version: 30, name: 'message_model_selection', up: applyMessageModelSelection },
  { version: 31, name: 'session_fork_and_agent', up: applySessionForkAndAgent },
  { version: 32, name: 'provider_usage_source', up: applyProviderUsageSource },
]

function applyMessageModelSelection(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_session_messages ADD COLUMN model_selection_json TEXT`)
}

function applyTurnEndReason(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_turns ADD COLUMN end_reason TEXT`)
}

function applyProviderUsageSource(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE provider_usage_turns ADD COLUMN source TEXT NOT NULL DEFAULT 'live'`)
}

function applySessionForkAndAgent(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN forked_from_json TEXT`)
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN agent TEXT`)
}

function applyProviderUsageContributions(database: PlatformDatabase) {
  database.run(
    sql`ALTER TABLE provider_usage_turns ADD COLUMN contributions_json TEXT NOT NULL DEFAULT '[]'`,
  )
}

function applyProviderUsagePrices(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE provider_usage_turns ADD COLUMN price_snapshot TEXT`)
  database.run(
    sql`CREATE TABLE provider_price_catalog (id INTEGER PRIMARY KEY, snapshot_json TEXT NOT NULL)`,
  )
}

function applyProviderUsagePurpose(database: PlatformDatabase) {
  database.run(
    sql`ALTER TABLE provider_usage_turns ADD COLUMN purpose TEXT NOT NULL DEFAULT 'turn'`,
  )
}

function applyProviderUsage(database: PlatformDatabase) {
  database.run(sql`
    CREATE TABLE provider_usage_turns (
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
      PRIMARY KEY (session_id, turn_id, model)
    )
  `)
  database.run(
    sql`CREATE INDEX provider_usage_turns_recorded_idx ON provider_usage_turns (recorded_at)`,
  )
  database.run(sql`
    CREATE TABLE provider_usage_baselines (
      session_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      model TEXT NOT NULL,
      totals_json TEXT NOT NULL,
      PRIMARY KEY (session_id, scope, model)
    )
  `)
}

function applyTerminalHistory(database: PlatformDatabase) {
  database.run(
    sql`CREATE TABLE terminal_history_chunks (owner TEXT NOT NULL, sequence INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (owner, sequence))`,
  )
}

function applyAttachmentUploadOwners(database: PlatformDatabase) {
  database.run(
    sql`CREATE TABLE attachment_upload_owners (attachment_id TEXT PRIMARY KEY NOT NULL, session_id TEXT NOT NULL, attachment_json TEXT NOT NULL)`,
  )
  database.run(
    sql`CREATE INDEX attachment_upload_owners_session_idx ON attachment_upload_owners (session_id)`,
  )
}

function applySessionTitles(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN title_state_json TEXT`)
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN title_regeneration_json TEXT`)
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN title_generation_error TEXT`)
}

function applyActiveSessionOrder(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN active_order_key TEXT`)
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN unsettled_at TEXT`)
}

function applyPendingRewind(database: PlatformDatabase) {
  database.run(sql`ALTER TABLE projection_sessions ADD COLUMN pending_rewind_command_id TEXT`)
  database.run(
    sql`ALTER TABLE projection_sessions ADD COLUMN pending_rewind_restore_files INTEGER NOT NULL DEFAULT 0`,
  )
}

function applyMessagePaginationOrder(database: PlatformDatabase) {
  database.run(sql`DROP INDEX projection_session_messages_session_created_idx`)
  database.run(sql`
    CREATE INDEX projection_session_messages_session_created_idx
    ON projection_session_messages (session_id, created_at, message_id)
  `)
}

function applyAgentTerminalHandoffs(database: PlatformDatabase) {
  database.run(sql`
    CREATE TABLE agent_terminal_handoffs (
      session_id TEXT PRIMARY KEY NOT NULL,
      provider_instance_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      terminal_lease_id TEXT NOT NULL,
      runtime_epoch TEXT NOT NULL,
      cwd TEXT NOT NULL,
      started_at TEXT NOT NULL,
      baseline_json TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (phase IN ('active', 'history'))
    )
  `)
}

function applyWorkspaceAddresses(database: PlatformDatabase) {
  database.run(sql`
    CREATE TABLE workspace_addresses (
      id TEXT PRIMARY KEY NOT NULL,
      filesystem_root TEXT NOT NULL,
      canonical_path TEXT NOT NULL
    )
  `)
  database.run(sql`
    CREATE UNIQUE INDEX workspace_addresses_directory_idx
    ON workspace_addresses (filesystem_root, canonical_path)
  `)
}

export function migratePlatformDatabase(
  database: PlatformDatabase = getDefaultPlatformDatabase(),
  migrations: readonly Migration[] = platformMigrations,
): readonly Migration[] {
  const startedAt = performance.now()
  createLedger(database)
  const recorded = recordedVersions(database)
  const applied: Migration[] = []
  for (const migration of migrations) {
    if (recorded.has(migration.version)) continue
    if (!applyMigration(database, migration)) continue
    applied.push(migration)
  }
  reportApplied(applied, startedAt)
  return applied
}

function applyMigration(database: PlatformDatabase, migration: Migration) {
  try {
    return database.transaction(
      (transaction) => {
        // The transaction handle exposes the same query API as the database; the
        // cast lets migrations be written as plain database code (same pattern as
        // `OrchestrationEngine.commitCommand`).
        const scoped = transaction as unknown as PlatformDatabase
        // Re-checked under the write lock: a peer process may have applied this
        // version between our ledger read and this transaction.
        if (isRecorded(scoped, migration.version)) return false

        migration.up(scoped)
        recordApplied(scoped, migration)

        return true
      },
      { behavior: 'immediate' },
    )
  } catch (cause) {
    throw createStructuredError({
      cause,
      code: 'db.MIGRATION_FAILED',
      fix: 'Fix the migration statements, then restart the server. The database is unchanged — the failed version rolled back and was not recorded.',
      internal: { migrationName: migration.name, migrationVersion: migration.version },
      message: `Database migration ${migration.version}_${migration.name} failed`,
      status: 500,
      why: 'A migration threw while applying its statements, so its transaction rolled back.',
    })
  }
}

function createLedger(database: PlatformDatabase) {
  database.run(sql`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`)
}

function recordedVersions(database: PlatformDatabase) {
  const rows = database.select({ version: schemaMigrations.version }).from(schemaMigrations).all()

  return new Set(rows.map((row) => row.version))
}

function isRecorded(database: PlatformDatabase, version: number) {
  const row = database
    .select({ version: schemaMigrations.version })
    .from(schemaMigrations)
    .where(eq(schemaMigrations.version, version))
    .get()

  return row !== undefined
}

function recordApplied(database: PlatformDatabase, migration: Migration) {
  database
    .insert(schemaMigrations)
    .values({
      appliedAt: new Date().toISOString(),
      name: migration.name,
      version: migration.version,
    })
    .run()
}

/**
 * One wide event for the whole run, not one per migration. A startup that
 * applied nothing is the normal case and stays silent.
 */
function reportApplied(applied: readonly Migration[], startedAt: number) {
  if (applied.length === 0) return

  recordProcessInfo('db.migrations.applied', {
    area: 'db',
    migrations: {
      appliedCount: applied.length,
      durationMs: elapsedMs(startedAt),
      latestVersion: applied.at(-1)?.version,
      names: applied.map((migration) => migration.name),
      versions: applied.map((migration) => migration.version),
    },
    operation: 'migrate',
  })
}

function applySessionDomain(database: PlatformDatabase) {
  database.run(sql`DROP TABLE IF EXISTS provider_session_runtime`)
  database.run(sql`DROP TABLE IF EXISTS projection_thread_messages`)
  database.run(sql`DROP TABLE IF EXISTS projection_thread_activities`)
  database.run(sql`DROP TABLE IF EXISTS projection_thread_sessions`)
  database.run(sql`DROP TABLE IF EXISTS projection_thread_proposed_plans`)
  database.run(sql`DROP TABLE IF EXISTS projection_thread_checkpoints`)
  database.run(sql`DROP TABLE IF EXISTS projection_session_messages`)
  database.run(sql`DROP TABLE IF EXISTS projection_session_activities`)
  database.run(sql`DROP TABLE IF EXISTS projection_session_runtime`)
  database.run(sql`DROP TABLE IF EXISTS projection_session_proposed_plans`)
  database.run(sql`DROP TABLE IF EXISTS projection_session_checkpoints`)
  database.run(sql`DROP TABLE IF EXISTS projection_turns`)
  database.run(sql`DROP TABLE IF EXISTS projection_threads`)
  database.run(sql`DROP TABLE IF EXISTS projection_sessions`)
  database.run(sql`DROP TABLE IF EXISTS projection_worktrees`)
  database.run(sql`DROP TABLE IF EXISTS projection_projects`)
  database.run(sql`DROP TABLE IF EXISTS projection_state`)
  database.run(sql`DROP TABLE IF EXISTS orchestration_command_receipts`)
  database.run(sql`DROP TABLE IF EXISTS orchestration_events`)
  for (const statement of SESSION_DOMAIN_SCHEMA) database.run(sql.raw(statement))
  if (database.select().from(environmentIdentity).get() === undefined) {
    database
      .insert(environmentIdentity)
      .values({ id: crypto.randomUUID(), createdAt: new Date().toISOString() })
      .run()
  }
  database.run(sql`DELETE FROM schema_migrations WHERE version < 11`)
}

const SESSION_DOMAIN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "environment_identity" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "fs_metadata" (
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
  `CREATE TABLE IF NOT EXISTS "orchestration_command_receipts" (
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
  `CREATE TABLE IF NOT EXISTS "orchestration_events" (
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
  `CREATE TABLE IF NOT EXISTS "projection_projects" (
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
  `CREATE TABLE IF NOT EXISTS "projection_session_activities" (
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
  `CREATE TABLE IF NOT EXISTS "projection_session_checkpoints" (
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
  `CREATE TABLE IF NOT EXISTS "projection_session_messages" (
  "message_id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "turn_id" text,
  "role" text NOT NULL,
  "text" text NOT NULL,
  "attachments_json" text NOT NULL DEFAULT '[]',
  "streaming" integer NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE IF NOT EXISTS "projection_session_proposed_plans" (
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
  `CREATE TABLE IF NOT EXISTS "projection_session_runtime" (
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
  `CREATE TABLE IF NOT EXISTS "projection_sessions" (
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
  FOREIGN KEY ("worktree_id") REFERENCES "projection_worktrees" ("worktree_id")
)`,
  `CREATE TABLE IF NOT EXISTS "projection_state" (
  "projector" text PRIMARY KEY NOT NULL,
  "last_applied_sequence" integer NOT NULL,
  "updated_at" text NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "projection_turns" (
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
  FOREIGN KEY ("session_id") REFERENCES "projection_sessions" ("session_id")
)`,
  `CREATE TABLE IF NOT EXISTS "projection_worktrees" (
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
  FOREIGN KEY ("project_id") REFERENCES "projection_projects" ("project_id"),
  CONSTRAINT "projection_worktrees_current_protected" CHECK ("kind" != 'current' OR "ownership" = 'protected'),
  CONSTRAINT "projection_worktrees_registration_generation" CHECK ("registration_generation" >= 0)
)`,
  `CREATE TABLE IF NOT EXISTS "provider_session_runtime" (
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
  `CREATE INDEX IF NOT EXISTS "orchestration_command_receipts_aggregate_idx" ON "orchestration_command_receipts" ("aggregate_kind", "aggregate_id")`,
  `CREATE INDEX IF NOT EXISTS "orchestration_command_receipts_sequence_idx" ON "orchestration_command_receipts" ("result_sequence")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "orchestration_events_stream_version_idx" ON "orchestration_events" ("aggregate_kind", "aggregate_id", "stream_version")`,
  `CREATE INDEX IF NOT EXISTS "orchestration_events_sequence_idx" ON "orchestration_events" ("sequence")`,
  `CREATE INDEX IF NOT EXISTS "orchestration_events_aggregate_sequence_idx" ON "orchestration_events" ("aggregate_kind", "aggregate_id", "sequence")`,
  `CREATE INDEX IF NOT EXISTS "orchestration_events_command_id_idx" ON "orchestration_events" ("command_id")`,
  `CREATE INDEX IF NOT EXISTS "orchestration_events_correlation_id_idx" ON "orchestration_events" ("correlation_id")`,
  `CREATE INDEX IF NOT EXISTS "projection_projects_updated_at_idx" ON "projection_projects" ("updated_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "projection_projects_live_repository_idx" ON "projection_projects" ("repository_key") WHERE "deleted_at" IS NULL`,
  `CREATE INDEX IF NOT EXISTS "projection_session_activities_session_created_idx" ON "projection_session_activities" ("session_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_activities_session_kind_idx" ON "projection_session_activities" ("session_id", "kind")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_checkpoints_session_turn_count_idx" ON "projection_session_checkpoints" ("session_id", "checkpoint_turn_count")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_messages_session_created_idx" ON "projection_session_messages" ("session_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_proposed_plans_session_created_idx" ON "projection_session_proposed_plans" ("session_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_proposed_plans_session_updated_idx" ON "projection_session_proposed_plans" ("session_id", "updated_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_runtime_binding_handle_idx" ON "projection_session_runtime" ("provider_binding_handle")`,
  `CREATE INDEX IF NOT EXISTS "projection_session_runtime_provider_instance_idx" ON "projection_session_runtime" ("provider_instance_id")`,
  `CREATE INDEX IF NOT EXISTS "projection_sessions_worktree_deleted_created_idx" ON "projection_sessions" ("worktree_id", "deleted_at", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_sessions_pinned_order_idx" ON "projection_sessions" ("pinned_at", "pin_order_key")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "projection_turns_session_turn_idx" ON "projection_turns" ("session_id", "turn_id")`,
  `CREATE INDEX IF NOT EXISTS "projection_turns_session_requested_idx" ON "projection_turns" ("session_id", "requested_at")`,
  `CREATE INDEX IF NOT EXISTS "projection_turns_provider_start_idx" ON "projection_turns" ("provider_start_state", "session_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "projection_worktrees_live_path_idx" ON "projection_worktrees" ("canonical_path") WHERE "retired_at" IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "projection_worktrees_current_idx" ON "projection_worktrees" ("project_id") WHERE "retired_at" IS NULL AND "kind" = 'current'`,
  `CREATE INDEX IF NOT EXISTS "projection_worktrees_project_idx" ON "projection_worktrees" ("project_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_session_runtime_provider_instance_idx" ON "provider_session_runtime" ("provider_instance_id")`,
  `CREATE INDEX IF NOT EXISTS "provider_session_runtime_binding_handle_idx" ON "provider_session_runtime" ("provider_binding_handle")`,
  `CREATE INDEX IF NOT EXISTS fs_metadata_recent_idx ON fs_metadata (last_picked_at DESC)`,
  `CREATE INDEX IF NOT EXISTS fs_metadata_entry_type_idx ON fs_metadata (entry_type)`,
] as const

function applyWorktreeLifecycle(database: PlatformDatabase) {
  for (const statement of WORKTREE_LIFECYCLE_SCHEMA) database.run(sql.raw(statement))
  database.run(
    sql`UPDATE projection_worktrees SET lifecycle_state = 'retired', lifecycle_json = json_object('state', 'retired', 'retiredAt', retired_at) WHERE retired_at IS NOT NULL`,
  )
  database.run(
    sql`UPDATE projection_worktrees SET external_driver_unverified = EXISTS (SELECT 1 FROM projection_sessions s WHERE s.worktree_id = projection_worktrees.worktree_id AND s.origin = 'discovered')`,
  )
  refreshAllWorktreePolicies(database)
}

const WORKTREE_LIFECYCLE_SCHEMA = [
  `ALTER TABLE projection_worktrees ADD COLUMN base_worktree_id TEXT`,
  `ALTER TABLE projection_worktrees ADD COLUMN base_commit TEXT`,
  `ALTER TABLE projection_worktrees ADD COLUMN head_commit TEXT`,
  `ALTER TABLE projection_worktrees ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projection_worktrees ADD COLUMN path_kind TEXT NOT NULL DEFAULT 'legacy'`,
  `ALTER TABLE projection_worktrees ADD COLUMN lifecycle_json TEXT NOT NULL DEFAULT '{"state":"ready"}'`,
  `ALTER TABLE projection_worktrees ADD COLUMN operation_id TEXT`,
  `ALTER TABLE projection_worktrees ADD COLUMN active_terminal_count INTEGER NOT NULL DEFAULT 0 CHECK (active_terminal_count >= 0)`,
  `ALTER TABLE projection_worktrees ADD COLUMN terminal_ownership_unknown INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projection_worktrees ADD COLUMN external_driver_unverified INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projection_worktrees ADD COLUMN removed_at TEXT`,
  `ALTER TABLE projection_worktrees ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'ready' CHECK ((lifecycle_state = 'removed') = (removed_at IS NOT NULL))`,
  `ALTER TABLE projection_worktrees ADD COLUMN creation_capability_json TEXT NOT NULL DEFAULT '{"allowed":false,"reason":"base-not-ready"}'`,
  `ALTER TABLE projection_worktrees ADD COLUMN cleanup_eligibility_json TEXT NOT NULL DEFAULT '{"reason":"not-ready","nonDeletedSessionCount":0,"canResolveMissing":false}'`,
  `CREATE INDEX projection_worktrees_lifecycle_idx ON projection_worktrees (lifecycle_state)`,
  `CREATE TABLE projection_terminal_leases (terminal_lease_id TEXT PRIMARY KEY NOT NULL, worktree_id TEXT NOT NULL REFERENCES projection_worktrees(worktree_id), runtime_epoch TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX projection_terminal_leases_worktree_idx ON projection_terminal_leases(worktree_id)`,
]
