import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { is, sql } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { afterEach, describe, expect, it } from 'vitest'
import { DOMAIN_IDS } from '../../orchestration/tests/factories/session-domain'
import { createMetadataDatabase, type MetadataDatabaseHandle } from '../client'
import { readEnvironmentIdentity } from '../environment-identity'
import { initializePlatformDatabase, SCHEMA_VERSION } from '../initialize'
import * as schema from '../schema'
import { environmentIdentity } from '../schema'

const openHandles: MetadataDatabaseHandle[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const handle of openHandles.splice(0)) handle.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

const drizzleTables = Object.values(schema)
  .filter((table) => is(table, SQLiteTable))
  .map((table) => getTableConfig(table))

describe('platform database schema', () => {
  it('creates every table the code reads, with its columns, indexes and foreign keys', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)

    expect(userVersion(handle)).toBe(SCHEMA_VERSION)
    expect(tableNames(handle).filter((name) => name !== 'sqlite_sequence')).toEqual(
      drizzleTables.map((config) => config.name).toSorted(),
    )
    for (const config of drizzleTables) {
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

  it('creates one durable identity and leaves a current database as it is', () => {
    const first = openTempDatabase()
    initializePlatformDatabase(first.db)
    const identity = readEnvironmentIdentity(first.db)
    const objects = schemaObjects(first)

    const second = openTempDatabase(first.databasePath)
    initializePlatformDatabase(second.db)
    initializePlatformDatabase(second.db)

    expect(identity.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.db.select().from(environmentIdentity).all()).toEqual([identity])
    expect(schemaObjects(second)).toEqual(objects)
  })

  it('refuses a database written by the migration ledger and leaves it untouched', () => {
    const handle = openTempDatabase()
    handle.db.run(
      sql`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
    )
    handle.db.run(
      sql`INSERT INTO schema_migrations VALUES (38, 'provider_reset_credit_attempts', 'now')`,
    )
    const objects = schemaObjects(handle)

    const error = captureError(() => initializePlatformDatabase(handle.db))

    expect(error).toMatchObject({ code: 'db.SCHEMA_VERSION_MISMATCH' })
    expect(error).toHaveProperty(
      'message',
      `${handle.databasePath} holds schema version 0, which this server cannot open`,
    )
    expect(error).toHaveProperty('internal', {
      databasePath: handle.databasePath,
      expectedVersion: SCHEMA_VERSION,
      foundVersion: 0,
      objectCount: 1,
    })
    expect(error).toHaveProperty('why', expect.stringContaining('repairs nothing'))
    expect(error).toHaveProperty('fix', expect.stringContaining('delete the database file'))
    expect(schemaObjects(handle)).toEqual(objects)
    expect(userVersion(handle)).toBe(0)
  })

  it('refuses a database stamped with another schema version', () => {
    const handle = openTempDatabase()
    handle.db.run(sql.raw(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`))

    const error = captureError(() => initializePlatformDatabase(handle.db))

    expect(error).toMatchObject({ code: 'db.SCHEMA_VERSION_MISMATCH' })
    expect(error).toHaveProperty('internal.foundVersion', SCHEMA_VERSION + 1)
    expect(error).toHaveProperty('internal.objectCount', 0)
    expect(tableNames(handle)).toEqual([])
  })

  it('serves the message page order from its index without sorting', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)

    const plan = messagePaginationPlan(handle)

    expect(plan).toEqual(
      expect.arrayContaining([
        expect.stringContaining('USING INDEX projection_session_messages_session_created_idx'),
      ]),
    )
    expect(plan).not.toEqual(expect.arrayContaining([expect.stringContaining('TEMP B-TREE')]))
  })

  it('enforces removal timestamps and nonnegative terminal ownership counts', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)
    insertTopology(handle)
    expect(() =>
      handle.db.run(sql`UPDATE projection_worktrees SET lifecycle_state = 'removed'`),
    ).toThrow()
    expect(() => handle.db.run(sql`UPDATE projection_worktrees SET removed_at = 'now'`)).toThrow()
    expect(() =>
      handle.db.run(sql`UPDATE projection_worktrees SET active_terminal_count = -1`),
    ).toThrow()
  })

  it('enforces one current worktree per project, live paths and live repositories', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)
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
  })

  it('enforces accepted versus rejected receipt sequence invariants', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)
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
    initializePlatformDatabase(handle.db)
    handle.db.delete(environmentIdentity).run()

    expect(captureError(() => readEnvironmentIdentity(handle.db))).toMatchObject({
      code: 'db.ENVIRONMENT_IDENTITY_INVALID',
    })
    initializePlatformDatabase(handle.db)
    expect(handle.db.select().from(environmentIdentity).all()).toEqual([])
  })

  it('refuses an ambiguous database identity', () => {
    const handle = openTempDatabase()
    initializePlatformDatabase(handle.db)
    handle.db
      .insert(environmentIdentity)
      .values({ id: 'unexpected-second-identity', createdAt: '2026-09-05T00:00:00.000Z' })
      .run()

    expect(captureError(() => readEnvironmentIdentity(handle.db))).toMatchObject({
      code: 'db.ENVIRONMENT_IDENTITY_INVALID',
    })
    expect(handle.db.select().from(environmentIdentity).all()).toHaveLength(2)
  })
})

function openTempDatabase(databasePath?: string) {
  const handle = createMetadataDatabase({ databasePath: databasePath ?? tempDatabasePath() })
  openHandles.push(handle)

  return handle
}

function tempDatabasePath() {
  const directory = mkdtempSync(path.join(tmpdir(), 'platform-schema-'))
  tempDirs.push(directory)

  return path.join(directory, 'platform.sqlite')
}

function captureError(run: () => unknown) {
  try {
    run()
  } catch (error) {
    return error
  }

  return expect.unreachable('expected the call to throw')
}

function userVersion(handle: MetadataDatabaseHandle) {
  return rows<{ user_version: number }>(handle, sql`PRAGMA user_version`)[0]?.user_version
}

function schemaObjects(handle: MetadataDatabaseHandle) {
  return rows(handle, sql`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)
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

function indexNames(handle: MetadataDatabaseHandle, tableName: string) {
  return rows<{ name: string }>(
    handle,
    sql`SELECT name FROM pragma_index_list(${tableName}) ORDER BY name`,
  ).map((row) => row.name)
}

function messagePaginationPlan(handle: MetadataDatabaseHandle) {
  return handle.db.$client
    .query<{ detail: string }, [string]>(
      `EXPLAIN QUERY PLAN SELECT * FROM projection_session_messages
      WHERE session_id = ?
      ORDER BY created_at DESC, message_id DESC LIMIT 201`,
    )
    .all(DOMAIN_IDS.session)
    .map((row) => row.detail)
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
