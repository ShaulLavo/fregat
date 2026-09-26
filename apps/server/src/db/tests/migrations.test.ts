import { OrchestrationProjectionPipeline } from '../../orchestration/projection-pipeline'
import { OrchestrationSnapshotQuery } from '../../orchestration/snapshot-query'
import { DOMAIN_IDS } from '../../orchestration/tests/factories/session-domain'
import {
  RETIRED_WORKTREE,
  resetWorktreeProjections,
  seedVersion11Worktrees,
} from './factories/worktree-lifecycle'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { is, sql } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../schema'
import { afterEach, describe, expect, it } from 'vitest'
import { createMetadataDatabase, type MetadataDatabaseHandle } from '../client'
import { readEnvironmentIdentity } from '../environment-identity'
import { environmentIdentity } from '../schema'
import { migratePlatformDatabase, platformMigrations, type Migration } from '../migrations'
import { migratePlatformDatabase as migrateOrchestrationDatabase } from '../migrations'

const expectedTables = [
  'schema_migrations',
  'environment_identity',
  'fs_metadata',
  'orchestration_events',
  'orchestration_command_receipts',
  'projection_state',
  'projection_projects',
  'projection_worktrees',
  'projection_terminal_leases',
  'projection_sessions',
  'projection_session_messages',
  'projection_session_activities',
  'projection_session_runtime',
  'projection_session_proposed_plans',
  'projection_session_checkpoints',
  'projection_turns',
  'provider_session_runtime',
  'agent_terminal_handoffs',
] as const

/** Every real migration in the ledger, so the assertions below move with it. */
const ledgerVersionNumbers = platformMigrations.map((migration) => migration.version)
const nextVersion = Math.max(...ledgerVersionNumbers) + 1

const openHandles: MetadataDatabaseHandle[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('platform migration ledger', () => {
  it('creates every table in a fresh database and records the baseline', () => {
    const handle = openTempDatabase()

    const applied = migratePlatformDatabase(handle.db)

    expect(applied.map((migration) => migration.version)).toEqual(ledgerVersionNumbers)
    expect(tableNames(handle)).toEqual(expect.arrayContaining([...expectedTables]))
    expect(ledgerVersions(handle)).toEqual(ledgerVersionNumbers)
    expect(ledgerRow(handle, 11)?.applied_at).toEqual(expect.any(String))
  })

  it('preserves deployed extra schema and records while adding turn metadata at versions 29 and 30', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(
      handle.db,
      platformMigrations.filter((migration) => migration.version <= 24),
    )
    handle.db.$client.exec(`
      ALTER TABLE projection_worktrees ADD COLUMN pull_request_json TEXT;
      ALTER TABLE projection_worktrees ADD COLUMN setup_json TEXT;
      ALTER TABLE projection_sessions ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE push_devices (
        revision TEXT NOT NULL, id TEXT PRIMARY KEY NOT NULL, endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL, auth TEXT NOT NULL, label TEXT NOT NULL, service TEXT NOT NULL,
        origin TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (25, 'worktree_pull_requests', '2026-09-25T00:00:00Z'),
        (26, 'worktree_setup', '2026-09-25T00:00:00Z'),
        (27, 'push_devices', '2026-09-25T00:00:00Z'),
        (28, 'session_lifecycle_revision', '2026-09-25T00:00:00Z');
    `)
    insertTopology(handle)
    handle.db.run(
      sql`UPDATE projection_worktrees SET pull_request_json = '{"number":31}', setup_json = '{"state":"ready"}'`,
    )
    expect(ledgerRow(handle, 25)?.name).toBe('worktree_pull_requests')
    expect(ledgerRow(handle, 26)?.name).toBe('worktree_setup')
    expect(columnNames(handle, 'projection_turns')).not.toContain('end_reason')
    expect(columnNames(handle, 'projection_session_messages')).not.toContain('model_selection_json')

    const applied = migratePlatformDatabase(handle.db)

    expect(applied.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 29, name: 'turn_end_reason' },
      { version: 30, name: 'message_model_selection' },
      { version: 31, name: 'session_fork_and_agent' },
      { version: 32, name: 'provider_usage_source' },
      { version: 36, name: 'provider_usage_import_requests' },
      { version: 37, name: 'terminal_session_cleanup' },
      { version: 38, name: 'provider_reset_credit_attempts' },
    ])
    expect(columnNames(handle, 'projection_turns')).toContain('end_reason')
    expect(columnNames(handle, 'projection_session_messages')).toContain('model_selection_json')
    expect(
      rows(handle, sql`SELECT pull_request_json, setup_json FROM projection_worktrees`),
    ).toEqual([{ pull_request_json: '{"number":31}', setup_json: '{"state":"ready"}' }])
    expect(tableNames(handle)).toContain('push_devices')
    expect(columnNames(handle, 'projection_sessions')).toContain('lifecycle_revision')
    expect(ledgerVersions(handle)).toEqual(
      [...new Set([...ledgerVersionNumbers, 25, 26, 27, 28])].sort((a, b) => a - b),
    )
    expect(migratePlatformDatabase(handle.db)).toEqual([])
  })

  it('adds push, lifecycle and turn metadata above the deployed worktree migrations', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(
      handle.db,
      platformMigrations.filter((migration) => migration.version <= 26),
    )
    insertTopology(handle)
    handle.db.run(
      sql`UPDATE projection_worktrees SET pull_request_json = '{"number":31}', setup_json = '{"state":"ready"}'`,
    )
    expect(ledgerRow(handle, 25)?.name).toBe('worktree_pull_requests')
    expect(ledgerRow(handle, 26)?.name).toBe('worktree_setup')
    expect(columnNames(handle, 'projection_turns')).not.toContain('end_reason')
    expect(columnNames(handle, 'projection_session_messages')).not.toContain('model_selection_json')

    const applied = migratePlatformDatabase(handle.db)

    expect(applied.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 27, name: 'push_devices' },
      { version: 28, name: 'session_lifecycle_revision' },
      { version: 29, name: 'turn_end_reason' },
      { version: 30, name: 'message_model_selection' },
      { version: 31, name: 'session_fork_and_agent' },
      { version: 32, name: 'provider_usage_source' },
      { version: 36, name: 'provider_usage_import_requests' },
      { version: 37, name: 'terminal_session_cleanup' },
      { version: 38, name: 'provider_reset_credit_attempts' },
    ])
    expect(columnNames(handle, 'push_devices')).toContain('revision')
    expect(columnNames(handle, 'projection_sessions')).toContain('lifecycle_revision')
    expect(columnNames(handle, 'projection_turns')).toContain('end_reason')
    expect(columnNames(handle, 'projection_session_messages')).toContain('model_selection_json')
    expect(
      rows(handle, sql`SELECT pull_request_json, setup_json FROM projection_worktrees`),
    ).toEqual([{ pull_request_json: '{"number":31}', setup_json: '{"state":"ready"}' }])
    expect(migratePlatformDatabase(handle.db)).toEqual([])
  })

  it('upgrades the message index to serve the complete page order without sorting', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(
      handle.db,
      platformMigrations.filter((migration) => migration.version < 15),
    )
    const plan = () => messagePaginationPlan(handle)
    expect(plan()).toEqual(expect.arrayContaining([expect.stringContaining('TEMP B-TREE')]))

    expect(migratePlatformDatabase(handle.db).map((migration) => migration.version)).toEqual([
      15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 36, 37, 38,
    ])

    expect(plan()).toEqual(
      expect.arrayContaining([
        expect.stringContaining('USING INDEX projection_session_messages_session_created_idx'),
      ]),
    )
    expect(plan()).not.toEqual(expect.arrayContaining([expect.stringContaining('TEMP B-TREE')]))
    expect(migratePlatformDatabase(handle.db)).toEqual([])
  })

  it('matches every current Drizzle table, index and foreign key', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    for (const table of Object.values(schema)) {
      if (!is(table, SQLiteTable)) continue
      const config = getTableConfig(table)
      expect(columnNames(handle, config.name).toSorted()).toEqual(
        config.columns.map((column) => column.name).toSorted(),
      )
      expect(indexNames(handle, config.name)).toEqual(
        expect.arrayContaining(config.indexes.map((index) => index.config.name)),
      )
      expect(rows(handle, sql`SELECT * FROM pragma_foreign_key_list(${config.name})`)).toHaveLength(
        config.foreignKeys.length,
      )
    }
  })

  it('preserves version 11 history and converges after projection-only replay', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(
      handle.db,
      platformMigrations.filter((migration) => migration.version === 11),
    )
    seedVersion11Worktrees(handle.db)
    expect(migratePlatformDatabase(handle.db).map((migration) => migration.version)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 36, 37,
      38,
    ])
    const query = new OrchestrationSnapshotQuery(handle.db)
    const migrated = query.shellSnapshot()
    const worktrees = [...query.fullReadModel().worktrees.values()]
    expect(worktrees.find((worktree) => worktree.id === DOMAIN_IDS.worktree)).toMatchObject({
      lifecycle: { state: 'ready' },
      operationId: null,
      externalDriverUnverified: true,
      activeTerminalCount: 0,
      terminalOwnershipUnknown: false,
    })
    expect(worktrees.find((worktree) => worktree.id === RETIRED_WORKTREE)?.lifecycle.state).toBe(
      'retired',
    )
    expect(rows(handle, sql`PRAGMA foreign_key_check`)).toEqual([])
    resetWorktreeProjections(handle.db)
    new OrchestrationProjectionPipeline(handle.db).catchUp()
    expect(query.shellSnapshot()).toEqual(migrated)
    expect([...query.fullReadModel().worktrees.values()]).toEqual(worktrees)
    expect(rows(handle, sql`SELECT command_id FROM orchestration_command_receipts`)).toEqual([
      { command_id: 'historical-receipt' },
    ])
    expect(rows(handle, sql`PRAGMA foreign_key_check`)).toEqual([])
  })

  it('enforces removal timestamps and nonnegative terminal ownership counts', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    insertTopology(handle)
    expect(() =>
      handle.db.run(sql`UPDATE projection_worktrees SET lifecycle_state = 'removed'`),
    ).toThrow()
    expect(() => handle.db.run(sql`UPDATE projection_worktrees SET removed_at = 'now'`)).toThrow()
    expect(() =>
      handle.db.run(sql`UPDATE projection_worktrees SET active_terminal_count = -1`),
    ).toThrow()
  })

  it('applies nothing on the second run', () => {
    const handle = openTempDatabase()

    migratePlatformDatabase(handle.db)
    const second = migratePlatformDatabase(handle.db)

    expect(second).toEqual([])
    expect(ledgerVersions(handle)).toEqual(ledgerVersionNumbers)
  })

  it('creates one durable identity on fresh databases and preserves it across connections', () => {
    const first = openTempDatabase()
    migratePlatformDatabase(first.db)
    const identity = readEnvironmentIdentity(first.db)

    const second = openTempDatabase(first.databasePath)
    migratePlatformDatabase(second.db)

    expect(identity.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(identity.createdAt).toEqual(expect.any(String))
    expect(second.db.select().from(environmentIdentity).all()).toEqual([identity])
  })

  it('resets legacy chat state while retaining environment identity and non-chat tables', () => {
    const handle = openTempDatabase()
    seedLegacyDatabase(handle)
    const identity = readEnvironmentIdentity(handle.db)
    const applied = migratePlatformDatabase(handle.db)
    expect(applied.map(({ version }) => version)).toEqual(ledgerVersionNumbers)
    expect(ledgerVersions(handle)).toEqual(ledgerVersionNumbers)
    expect(handle.db.select().from(environmentIdentity).all()).toEqual([identity])
    expect(rows<{ value: string }>(handle, sql`SELECT value FROM operator_state`)).toEqual([
      { value: 'keep-settings-and-secrets' },
    ])
    expect(rows<{ path: string }>(handle, sql`SELECT path FROM fs_metadata`)).toEqual([
      { path: '/keep/file.ts' },
    ])
    expect(tableNames(handle).filter((name) => name.includes('thread'))).toEqual([])
    expect(rows(handle, sql`SELECT * FROM orchestration_events`)).toEqual([])
    expect(rows(handle, sql`SELECT * FROM projection_sessions`)).toEqual([])
    insertTopology(handle)
    expect(rows(handle, sql`PRAGMA foreign_key_check`)).toEqual([])
    expect(migratePlatformDatabase(handle.db)).toEqual([])
    expect(rows(handle, sql`SELECT * FROM projection_worktrees`)).toHaveLength(1)
  })

  it('creates the same constrained topology on a fresh database', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    insertTopology(handle)
    expect(rows(handle, sql`PRAGMA foreign_key_check`)).toEqual([])
    expect(() =>
      handle.db.run(
        sql`INSERT INTO projection_worktrees (worktree_id, project_id, registration_generation, canonical_path, path, kind, ownership, created_at, updated_at) VALUES ('other', 'project', 0, '/other', '/other', 'current', 'protected', 'now', 'now')`,
      ),
    ).toThrow()
    expect(() =>
      handle.db.run(
        sql`INSERT INTO projection_worktrees (worktree_id, project_id, registration_generation, canonical_path, path, kind, ownership, created_at, updated_at) VALUES ('other', 'project', 0, '/root', '/root', 'linked', 'external', 'now', 'now')`,
      ),
    ).toThrow()
    expect(() =>
      handle.db.run(
        sql`INSERT INTO projection_projects (project_id, title, repository_key, repository_kind, repository_identity_json, created_at, updated_at) VALUES ('duplicate', 'Duplicate', 'repository', 'directory', '{}', 'now', 'now')`,
      ),
    ).toThrow()
    expect(columnNames(handle, 'projection_sessions')).not.toEqual(
      expect.arrayContaining(['project_id', 'branch', 'worktree_path']),
    )
    expect(columnInfo(handle, 'projection_sessions', 'worktree_id')?.not_null).toBe(1)
    expect(columnNames(handle, 'provider_session_runtime')).not.toContain('status')
  })

  it('enforces accepted versus rejected receipt sequence invariants', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    expect(() =>
      handle.db.run(
        sql`INSERT INTO orchestration_command_receipts (command_id, command_type, aggregate_kind, aggregate_id, accepted_at, status, command_json, intent_fingerprint) VALUES ('invalid', 'project.create', 'project', 'project', 'now', 'accepted', '{}', 'fingerprint')`,
      ),
    ).toThrow()
    handle.db.run(
      sql`INSERT INTO orchestration_command_receipts (command_id, command_type, aggregate_kind, aggregate_id, accepted_at, status, command_json, intent_fingerprint, result_sequence) VALUES ('valid', 'project.create', 'project', 'project', 'now', 'accepted', '{}', 'fingerprint', 0)`,
    )
    expect(rows(handle, sql`SELECT result_sequence FROM orchestration_command_receipts`)).toEqual([
      { result_sequence: 0 },
    ])
  })

  it('refuses a missing identity instead of recreating it', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    handle.db.delete(environmentIdentity).run()

    expect(captureError(() => readEnvironmentIdentity(handle.db))).toMatchObject({
      code: 'db.ENVIRONMENT_IDENTITY_INVALID',
    })
    expect(handle.db.select().from(environmentIdentity).all()).toEqual([])
  })

  it('refuses an ambiguous database identity', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)
    handle.db
      .insert(environmentIdentity)
      .values({
        id: 'unexpected-second-identity',
        createdAt: '2026-09-05T00:00:00.000Z',
      })
      .run()

    expect(captureError(() => readEnvironmentIdentity(handle.db))).toMatchObject({
      code: 'db.ENVIRONMENT_IDENTITY_INVALID',
    })
    expect(handle.db.select().from(environmentIdentity).all()).toHaveLength(2)
  })

  it('applies nothing from a second connection to the same file', () => {
    const first = openTempDatabase()
    const second = openTempDatabase(first.databasePath)

    migratePlatformDatabase(first.db)
    const applied = migratePlatformDatabase(second.db)

    expect(applied).toEqual([])
    expect(ledgerVersions(second)).toEqual(ledgerVersionNumbers)
  })

  it('creates the orchestration lookup indexes the snapshot queries rely on', () => {
    const handle = openTempDatabase()

    migrateOrchestrationDatabase(handle.db)

    expect(indexNames(handle, 'orchestration_events')).toEqual(
      expect.arrayContaining([
        'orchestration_events_sequence_idx',
        'orchestration_events_aggregate_sequence_idx',
      ]),
    )
    expect(indexNames(handle, 'projection_sessions')).toContain(
      'projection_sessions_worktree_deleted_created_idx',
    )
    expect(indexNames(handle, 'projection_session_runtime')).toEqual(
      expect.arrayContaining([
        'projection_session_runtime_binding_handle_idx',
        'projection_session_runtime_provider_instance_idx',
      ]),
    )
    expect(columnInfo(handle, 'provider_session_runtime', 'provider_instance_id')?.not_null).toBe(1)
  })

  it('creates the activity kind index the pending-request fold reads through', () => {
    const handle = openTempDatabase()

    migratePlatformDatabase(handle.db)

    expect(indexNames(handle, 'projection_session_activities')).toEqual(
      expect.arrayContaining([
        'projection_session_activities_session_created_idx',
        'projection_session_activities_session_kind_idx',
      ]),
    )
  })

  it('adds the session lifecycle columns and their pinned lookup index', () => {
    const handle = openTempDatabase()

    migrateOrchestrationDatabase(handle.db)

    expect(columnNames(handle, 'projection_sessions')).toEqual(
      expect.arrayContaining([
        'settled_override',
        'settled_at',
        'snoozed_until',
        'snoozed_at',
        'pinned_at',
        'pin_order_key',
      ]),
    )
    expect(indexNames(handle, 'projection_sessions')).toContain(
      'projection_sessions_pinned_order_idx',
    )
  })

  it('adds a column to a database already at the 001 baseline', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)

    const applied = migratePlatformDatabase(handle.db, [...platformMigrations, addParkedAt])

    expect(applied.map((migration) => migration.version)).toEqual([nextVersion])
    expect(columnNames(handle, 'projection_sessions')).toContain('parked_at')
    expect(ledgerVersions(handle)).toEqual([...ledgerVersionNumbers, nextVersion])
  })

  it('rolls back the DDL and records nothing when a migration throws', () => {
    const handle = openTempDatabase()
    migratePlatformDatabase(handle.db)

    expect(() =>
      migratePlatformDatabase(handle.db, [...platformMigrations, addParkedAtThenThrow]),
    ).toThrow(new RegExp(`migration ${nextVersion}_add_projection_sessions_parked_at failed`, 'i'))

    expect(columnNames(handle, 'projection_sessions')).not.toContain('parked_at')
    expect(ledgerVersions(handle)).toEqual(ledgerVersionNumbers)
  })

  it('reports the failure as a structured error', () => {
    const handle = openTempDatabase()

    const error = captureError(() =>
      migratePlatformDatabase(handle.db, [...platformMigrations, addParkedAtThenThrow]),
    )

    expect(error).toMatchObject({
      code: 'db.MIGRATION_FAILED',
      name: 'EvlogError',
    })
    expect(error).toHaveProperty('why')
    expect(error).toHaveProperty('fix')
  })
})

const addParkedAt: Migration = {
  name: 'add_projection_sessions_parked_at',
  up: (database) => {
    database.run(sql`ALTER TABLE projection_sessions ADD COLUMN parked_at TEXT`)
  },
  version: nextVersion,
}

const addParkedAtThenThrow: Migration = {
  name: 'add_projection_sessions_parked_at',
  up: (database) => {
    database.run(sql`ALTER TABLE projection_sessions ADD COLUMN parked_at TEXT`)
    throw new Error('migration exploded after its DDL')
  },
  version: nextVersion,
}

function openTempDatabase(databasePath?: string) {
  const handle = createMetadataDatabase({ databasePath: databasePath ?? tempDatabasePath() })
  openHandles.push(handle)

  return handle
}

function tempDatabasePath() {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-migrations-'))
  tempDirs.push(directory)

  return path.join(directory, 'platform.sqlite')
}

function captureError(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error
  }

  return expect.unreachable('expected the migration run to throw')
}

function tableNames(handle: MetadataDatabaseHandle) {
  return rows<{ name: string }>(
    handle,
    sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
  ).map((row) => row.name)
}

function columnNames(handle: MetadataDatabaseHandle, tableName: string) {
  return rows<{ name: string }>(
    handle,
    sql`SELECT name FROM pragma_table_info(${tableName}) ORDER BY cid`,
  ).map((row) => row.name)
}

function columnInfo(handle: MetadataDatabaseHandle, tableName: string, columnName: string) {
  return rows<{ not_null: number }>(
    handle,
    sql`SELECT "notnull" AS not_null FROM pragma_table_info(${tableName}) WHERE name = ${columnName}`,
  ).at(0)
}

function indexNames(handle: MetadataDatabaseHandle, tableName: string) {
  return rows<{ name: string }>(
    handle,
    sql`SELECT name FROM pragma_index_list(${tableName}) ORDER BY name`,
  ).map((row) => row.name)
}

function messagePaginationPlan(handle: MetadataDatabaseHandle) {
  const statement = handle.db.$client.prepare<{ detail: string }, [string]>(`
    EXPLAIN QUERY PLAN SELECT * FROM projection_session_messages
    WHERE session_id = ?
    ORDER BY created_at DESC, message_id DESC LIMIT 201
  `)
  try {
    return statement.all(DOMAIN_IDS.session).map((row) => row.detail)
  } finally {
    statement.finalize()
  }
}

function ledgerVersions(handle: MetadataDatabaseHandle) {
  return rows<{ version: number }>(
    handle,
    sql`SELECT version FROM schema_migrations ORDER BY version`,
  ).map((row) => row.version)
}

function ledgerRow(handle: MetadataDatabaseHandle, version: number) {
  return rows<{ applied_at: string; name: string }>(
    handle,
    sql`SELECT name, applied_at FROM schema_migrations WHERE version = ${version}`,
  ).at(0)
}

function rows<T>(handle: MetadataDatabaseHandle, query: ReturnType<typeof sql>) {
  return handle.db.all<T>(query)
}

function insertTopology(handle: MetadataDatabaseHandle) {
  handle.db.run(
    sql`INSERT INTO projection_projects (project_id, title, repository_key, repository_kind, repository_identity_json, created_at, updated_at) VALUES ('project', 'Project', 'repository', 'directory', '{}', 'now', 'now')`,
  )
  handle.db.run(
    sql`INSERT INTO projection_worktrees (worktree_id, project_id, registration_generation, canonical_path, path, kind, ownership, created_at, updated_at) VALUES ('worktree', 'project', 0, '/root', '/root', 'current', 'protected', 'now', 'now')`,
  )
}

function seedLegacyDatabase(handle: MetadataDatabaseHandle) {
  handle.db.run(
    sql`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  )
  handle.db.run(
    sql`INSERT INTO schema_migrations VALUES (9, 'legacy', 'now'), (10, 'environment_identity', 'now')`,
  )
  handle.db.run(
    sql`CREATE TABLE environment_identity (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
  )
  handle.db.run(
    sql`INSERT INTO environment_identity VALUES ('7d79d3dc-dda7-471b-b092-e0bd1edcb8c9', '2026-09-05T00:00:00.000Z')`,
  )
  handle.db.run(
    sql`CREATE TABLE fs_metadata (path TEXT PRIMARY KEY, name TEXT, entry_type TEXT, size INTEGER, mtime_ms INTEGER, birthtime_ms INTEGER, last_picked_at INTEGER, pick_count INTEGER, created_at INTEGER, updated_at INTEGER)`,
  )
  handle.db.run(sql`INSERT INTO fs_metadata (path) VALUES ('/keep/file.ts')`)
  handle.db.run(sql`CREATE TABLE operator_state (value TEXT NOT NULL)`)
  handle.db.run(sql`INSERT INTO operator_state VALUES ('keep-settings-and-secrets')`)
  handle.db.run(sql`CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, text TEXT)`)
  handle.db.run(sql`INSERT INTO projection_threads VALUES ('old-thread', 'discard')`)
  handle.db.run(
    sql`CREATE TABLE orchestration_events (sequence INTEGER PRIMARY KEY, payload_json TEXT)`,
  )
  handle.db.run(sql`INSERT INTO orchestration_events VALUES (42, 'old event')`)
}
