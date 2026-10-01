import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { tryLock, unlock } from './lock'

/** A job in the state directory: waiting in `queue/`, or running in `jobs/`. */
export type Entry = {
  readonly id: string
  readonly label: string
  readonly jobClass: string
  readonly estimateBytes: number
  readonly cwd: string
  readonly pid: number
  /** When it joined the queue, then when it started. */
  readonly since: string
}

/** An entry this process owns: its file stays exclusively locked while the process lives. */
export type Held = { readonly entry: Entry; readonly file: string; readonly fd: number }

type Place = 'queue' | 'jobs'

// Names sort in arrival order, so the queue is first-in first-out.
export function enqueue(stateDir: string, entry: Entry): Held {
  const ticket = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}-${entry.id}`
  return write(stateDir, 'queue', ticket, entry)
}

/** Moves a waiting entry to `jobs/`; the new file is locked before the old one is dropped. */
export function promote(stateDir: string, held: Held): Held {
  const running = write(stateDir, 'jobs', held.entry.id, {
    ...held.entry,
    since: new Date().toISOString(),
  })
  release(held)
  return running
}

export function release(held: Held) {
  rmSync(held.file, { force: true })
  unlock(held.fd)
}

/** Live entries in arrival order. An unlocked file belongs to a dead wrapper and is removed. */
export function live(stateDir: string, place: Place): Entry[] {
  const dir = path.join(stateDir, place)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .toSorted()
    .flatMap((name) => {
      const file = path.join(dir, name)
      const fd = tryLock(file)
      if (fd === null) return [readEntry(file)]
      rmSync(file, { force: true })
      unlock(fd)
      return []
    })
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

function readEntry(file: string): Entry {
  return JSON.parse(readFileSync(file, 'utf8')) as Entry
}
