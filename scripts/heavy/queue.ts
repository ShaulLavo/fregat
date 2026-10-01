import {
  closeSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { lockDescriptor, openExisting, tryLock, unlessMissing, unlock, waitLock } from './lock'

/** A job in the state directory: waiting in `queue/`, or running in `jobs/`. */
export type Entry = {
  readonly id: string
  readonly label: string
  readonly jobClass: string
  readonly estimateBytes: number
  /** A `--quiet` job: it runs alone, for at most one quiet hold. */
  readonly quiet: boolean
  /**
   * A running quiet job's lease, in boot seconds: by then systemd has ended its scope, so its
   * claim on the machine lapses even if its wrapper is suspended and cannot release it.
   */
  readonly quietUntil?: number
  readonly cwd: string
  readonly pid: number
  /** When it joined the queue, then when it started. */
  readonly since: string
}

/** An entry this process owns: its file stays exclusively locked while the process lives. */
export type Held = { readonly entry: Entry; readonly file: string; readonly fd: number }

type Place = 'queue' | 'jobs'

/**
 * Joins the queue with the next ticket of a counter kept under its own lock, so arrival order
 * holds across processes whatever their clocks say. The entry is published under that lock.
 */
export function enqueue(stateDir: string, entry: Entry): Held {
  const dir = path.join(stateDir, 'queue')
  mkdirSync(dir, { recursive: true })
  const lock = waitLock(path.join(dir, 'sequence.lock'))
  try {
    const counter = path.join(dir, 'sequence')
    const ticket = Number(readCounter(counter)) + 1
    writeFileSync(counter, String(ticket))
    return write(stateDir, 'queue', `${String(ticket).padStart(12, '0')}-${entry.id}`, entry)
  } finally {
    unlock(lock)
  }
}

/** Moves a waiting entry to `jobs/`; the new file is locked before the old one is dropped. */
export function promote(stateDir: string, held: Held, extra: Partial<Entry> = {}): Held {
  const running = write(stateDir, 'jobs', held.entry.id, {
    ...held.entry,
    ...extra,
    since: new Date().toISOString(),
  })
  release(held)
  return running
}

export function release(held: Held) {
  rmSync(held.file, { force: true })
  unlock(held.fd)
}

/**
 * Live entries in arrival order. An unlocked file belongs to a dead wrapper and is removed; a
 * file that disappears during the scan belongs to a wrapper that just finished, and is gone.
 */
export function live(stateDir: string, place: Place): Entry[] {
  const dir = path.join(stateDir, place)
  return (unlessMissing(() => readdirSync(dir)) ?? [])
    .filter((name) => name.endsWith('.json'))
    .toSorted()
    .flatMap((name) => {
      const entry = liveEntry(path.join(dir, name))
      return entry ? [entry] : []
    })
}

// Read through the descriptor that saw the lock: the owner may unlink the path meanwhile.
function liveEntry(file: string): Entry | null {
  const fd = openExisting(file)
  if (fd === null) return null
  try {
    if (!lockDescriptor(fd)) return JSON.parse(readFileSync(fd, 'utf8')) as Entry
    rmSync(file, { force: true })
    return null
  } finally {
    closeSync(fd)
  }
}

function write(stateDir: string, place: Place, name: string, entry: Entry): Held {
  const dir = path.join(stateDir, place)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.json`)
  const partial = path.join(dir, `.${name}.partial`)
  writeFileSync(partial, JSON.stringify(entry))
  const fd = tryLock(partial)!
  renameSync(partial, file)
  return { entry, fd, file }
}

function readCounter(file: string) {
  return unlessMissing(() => readFileSync(file, 'utf8').trim()) || '0'
}
