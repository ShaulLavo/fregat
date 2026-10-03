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

import {
  isSliceRoot,
  lockDescriptor,
  openExisting,
  tryLock,
  unlessMissing,
  unlock,
  waitLock,
} from './lock'

/** A job in the state directory: waiting in `queue/`, or running in `jobs/`. */
export type Entry = {
  readonly id: string
  readonly label: string
  readonly jobClass: string
  readonly estimateBytes: number
  /** Where its slice runs: `<sliceRoot>-<id>.slice`. Wrappers sharing a state directory may differ. */
  readonly sliceRoot: string
  /** A `--quiet` job: it drains finite jobs, for at most one quiet hold. */
  readonly quiet: boolean
  readonly server: boolean
  /** A queued quiet request's deadline, in boot seconds; independent of its running lease. */
  readonly quietAdmissionUntil?: number
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
 * Live entries in arrival order. A waiting entry whose file is unlocked belongs to a dead
 * wrapper and is removed; a dead job's entry stays for `deadJobs`, since it names the slice
 * left running. A file that disappears during the scan belongs to a wrapper that just finished.
 */
export function live(stateDir: string, place: Place): Entry[] {
  return scan(stateDir, place).flatMap(({ entry, file, owned }) => {
    if (owned) return entry ? [entry] : []
    if (place === 'queue') rmSync(file, { force: true })
    return []
  })
}

/**
 * Running entries whose wrapper is gone. Only an `attributable` one may name a slice to stop:
 * its file is `<id>.json`, it parses, its id has the wrapper's shape and its root the CLI's
 * grammar. The caller removes each file once its slice has stopped.
 */
export function deadJobs(stateDir: string): DeadJob[] {
  return scan(stateDir, 'jobs')
    .filter(({ owned }) => !owned)
    .map(({ entry, file }) =>
      entry && path.basename(file) === `${entry.id}.json` && isSliceRoot(entry.sliceRoot)
        ? { attributable: true, entry, file }
        : { attributable: false, file },
    )
}

export type DeadJob =
  | { readonly attributable: true; readonly entry: Entry; readonly file: string }
  | { readonly attributable: false; readonly file: string }

// File names as `enqueue` and `promote` write them; nothing else in these directories is read.
const NAMES: Record<Place, RegExp> = {
  jobs: /^[0-9a-f]{12}\.json$/,
  queue: /^\d{12}-[0-9a-f]{12}\.json$/,
}

// Every entry file with its lock state; `entry` is null when the file is not one this wrapper
// writes, by name or content.
function scan(stateDir: string, place: Place) {
  const dir = path.join(stateDir, place)
  return (unlessMissing(() => readdirSync(dir)) ?? [])
    .filter((name) => name.endsWith('.json'))
    .toSorted()
    .flatMap((name) => {
      const file = path.join(dir, name)
      const read = readEntry(file, NAMES[place].test(name))
      return read ? [{ file, ...read }] : []
    })
}

// Read through the descriptor that saw the lock: the owner may unlink the path meanwhile.
function readEntry(file: string, named: boolean) {
  const fd = openExisting(file)
  if (fd === null) return null
  try {
    const owned = !lockDescriptor(fd)
    return { entry: named ? parseEntry(readFileSync(fd, 'utf8')) : null, owned }
  } finally {
    closeSync(fd)
  }
}

function parseEntry(text: string): Entry | null {
  try {
    return JSON.parse(text) as Entry
  } catch {
    return null
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
