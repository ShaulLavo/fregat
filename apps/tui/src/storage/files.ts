import { Database, SQLiteError } from 'bun:sqlite'
import { chmod, mkdir, open } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { environmentIdSchema, type EnvironmentId } from '@workspace/contracts'
import * as v from 'valibot'

import { createTuiError } from '@/host/utils/structured-errors'
import { recentCommands, RECENT_COMMANDS } from '@/storage/recent-commands-policy'

type Update = (current: string | null) => string | null

export async function openFileStorage(directory: string, environmentId: EnvironmentId) {
  const id = v.parse(environmentIdSchema, environmentId)
  const filename = path.join(directory, `${id}.sqlite`)
  let database: Database | undefined
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await prepareFile(filename)
    await chmod(filename, 0o600)
    database = new Database(filename, { strict: true })
    await initialize(database)
    return createStorage(database, id)
  } catch (error) {
    database?.close()
    throw createTuiError(
      'Could not read saved TUI state.',
      `Check access to ${filename}. If the cache is invalid, delete that file and press Ctrl+R to retry.`,
      error instanceof Error ? error : undefined,
    )
  }
}

async function prepareFile(filename: string) {
  const file = await open(filename, 'a+', 0o600)
  try {
    const header = Buffer.alloc(16)
    const { bytesRead } = await file.read(header, 0, header.length, 0)
    if (bytesRead !== 0 && header.toString() !== 'SQLite format 3\0') {
      throw createTuiError(
        'Saved TUI state has an invalid database header.',
        `Delete ${filename} to reset this cache.`,
      )
    }
  } finally {
    await file.close()
  }
}

async function enableWal(database: Database) {
  const deadline = Date.now() + 1000
  // Journal-mode lock upgrades can bypass SQLite's busy handler during concurrent opens.
  for (;;) {
    try {
      database.exec('PRAGMA journal_mode = WAL')
      return
    } catch (error) {
      if (!(error instanceof SQLiteError) || error.code !== 'SQLITE_BUSY') throw error
      if (Date.now() >= deadline) throw error
    }
    await setTimeout(10)
  }
}

async function initialize(database: Database) {
  await enableWal(database)
  database.exec('PRAGMA busy_timeout = 1000')
  // Viewer convenience state is checkpointed on flush; key presses need not wait for fsync.
  database.exec('PRAGMA synchronous = NORMAL')
  database.exec(
    'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT',
  )
}

function createStorage(database: Database, environmentId: EnvironmentId) {
  const read = database.query<{ value: string }, [string]>('SELECT value FROM state WHERE key = ?')
  const write = database.query(
    'INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  const remove = database.query('DELETE FROM state WHERE key = ?')
  const removeIfValue = database.query('DELETE FROM state WHERE key = ? AND value = ?')
  const list = database.query<{ key: string }, [string]>(
    'SELECT key FROM state WHERE substr(key, 1, length(?1)) = ?1 ORDER BY key',
  )
  let closed = false

  const update = database.transaction((key: string, transform: Update) => {
    const value = transform(read.get(key)?.value ?? null)
    if (value === null) {
      remove.run(key)
      return
    }
    validateItem(key, value)
    write.run(key, value)
  })

  return {
    environmentId,
    getItem: (key: string) => read.get(key)?.value ?? null,
    setItem(key: string, value: string) {
      validateItem(key, value)
      write.run(key, value)
    },
    updateItem(key: string, transform: Update) {
      update.immediate(key, transform)
    },
    removeItem(key: string) {
      remove.run(key)
    },
    removeItemIfValue(key: string, expected: string) {
      return removeIfValue.run(key, expected).changes !== 0
    },
    keys: (prefix: string) => list.all(prefix).map((row) => row.key),
    async flush() {
      if (!closed) database.exec('PRAGMA wal_checkpoint(PASSIVE)')
    },
    close() {
      if (closed) return
      closed = true
      database.close()
    },
  }
}

export type FileStorage = Awaited<ReturnType<typeof openFileStorage>>

function validateItem(key: string, value: string) {
  if (key === RECENT_COMMANDS) recentCommands.parse(value)
}
