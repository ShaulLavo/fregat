import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { isTestProcess, platformHomePath } from '../home'
import { createStructuredError } from '../observability/structured-errors'

export type PlatformDatabase = ReturnType<typeof openPlatformDatabase>['db']

export type MetadataDatabaseHandle = {
  db: PlatformDatabase
  databasePath: string
  close: () => void
}

export function createMetadataDatabase(
  options: { databasePath?: string } = {},
): MetadataDatabaseHandle {
  return openPlatformDatabase(options.databasePath ?? resolveDefaultDatabasePath())
}

/**
 * Resolved per call, never at import time, so this module stays side-effect-free
 * to import and the guard below throws where the caller can see it.
 */
function resolveDefaultDatabasePath(): string {
  const explicit = Bun.env.FS_METADATA_DB
  if (explicit) return explicit

  // A test process must never touch the developer's real database. Defaulting
  // silently is what let the server suite write and WAL-lock ~/.platform.
  if (isTestProcess()) {
    throw createStructuredError({
      code: 'db.TEST_DATABASE_NOT_INJECTED',
      fix: "Inject a database in the test: `createMetadataDatabase({ databasePath: ':memory:' })`, then pass it as `metadataDatabase` and `orchestration.database`. See `apps/web/test/server.ts`.",
      message: 'A test process reached the default platform database path',
      status: 500,
      why: "The default path is the developer's real ~/.platform/fs-metadata.sqlite; opening it from a test writes and WAL-locks live state and makes results depend on that machine's data.",
    })
  }

  return platformHomePath('fs-metadata.sqlite')
}

let defaultHandle: MetadataDatabaseHandle | null = null

/**
 * Lazily-opened process-wide database used as a fallback when no handle is
 * injected. Opening is deferred until first use so importing this module has
 * no side effects.
 */
export function getDefaultPlatformDatabase(): PlatformDatabase {
  defaultHandle ??= createMetadataDatabase()
  return defaultHandle.db
}

function openPlatformDatabase(databasePath: string) {
  ensureDatabaseDirectory(databasePath)

  const sqlite = new Database(databasePath, { create: true })
  // `busy_timeout` is what makes concurrent startup safe: two processes opening
  // the same file both initialize the schema, and the loser of the
  // `BEGIN IMMEDIATE` race waits for the write lock instead of failing busy.
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')

  return {
    db: drizzle({ client: sqlite, schema }),
    databasePath,
    close: () => sqlite.close(),
  }
}

function ensureDatabaseDirectory(databasePath: string) {
  if (databasePath === ':memory:') return

  mkdirSync(path.dirname(databasePath), { recursive: true })
}
