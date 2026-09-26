import { Database, SQLiteError } from 'bun:sqlite'
import path from 'node:path'

/** A process-held OS lock: crashes release it, and concurrent launchers cannot unlink a live socket. */
export function acquireHostLock(directory: string) {
  const lock = new Database(path.join(directory, 'host-lock.sqlite'), { create: true })
  try {
    lock.exec('BEGIN EXCLUSIVE')
    return lock
  } catch (error) {
    lock.close()
    if (error instanceof SQLiteError && error.code === 'SQLITE_BUSY') return null
    throw error
  }
}
