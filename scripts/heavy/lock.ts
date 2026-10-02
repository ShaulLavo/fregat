import { dlopen, FFIType } from 'bun:ffi'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const LOCK_SH = 1
const LOCK_EX = 2
const LOCK_NB = 4
// NOT-PORTABLE: Eager libc.so.6 loading prevents test collection on macOS and musl Linux.
const libc = dlopen('libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

export type LockMode = 'shared' | 'exclusive'

/**
 * A flock(2) on the file, or null when a conflicting holder has it. It is the lock flock(1)
 * takes, so scripts using either exclude each other. The descriptor is close-on-exec: a
 * job's children never inherit the lock unless it is handed to them, and it dies with this
 * process.
 */
export function tryLock(file: string, mode: LockMode = 'exclusive'): number | null {
  const fd = openSync(file, 'a')
  if (lockDescriptor(fd, mode)) return fd
  closeSync(fd)
  return null
}

/** Takes the lock on an open descriptor without waiting; false when another holder has it. */
export function lockDescriptor(fd: number, mode: LockMode = 'exclusive') {
  return libc.symbols.flock(fd, operation(mode) | LOCK_NB) === 0
}

/** Opens a file another process may remove at any moment; null when it is already gone. */
export function openExisting(file: string): number | null {
  return unlessMissing(() => openSync(file, 'r'))
}

/** The value, or null when the path does not exist (yet, or any more); other errors throw. */
export function unlessMissing<T>(read: () => T): T | null {
  try {
    return read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Blocks until the lock is free. Only for locks every holder keeps for milliseconds. */
export function waitLock(file: string): number {
  const fd = openSync(file, 'a')
  libc.symbols.flock(fd, LOCK_EX)
  return fd
}

export function unlock(fd: number) {
  closeSync(fd)
}

function operation(mode: LockMode) {
  return mode === 'shared' ? LOCK_SH : LOCK_EX
}

// The wrapper's state lives beside the legacy slot locks other tools still take directly.
export const DEFAULT_STATE_DIR = '/work/tmp/wave-heavy'
const PRODUCTION_SLICE_ROOT = 'heavy'

/** The state directory whose wrappers own the production slice root, and that root. */
export type Production = { readonly stateDir: string; readonly root: string }
export const PRODUCTION: Production = { root: PRODUCTION_SLICE_ROOT, stateDir: DEFAULT_STATE_DIR }

/** The slice-root grammar `--slice-root` accepts: lowercase letters and digits. */
export function isSliceRoot(name: unknown): name is string {
  return typeof name === 'string' && /^[a-z0-9]+$/.test(name)
}

/**
 * The slice root a state directory owns. A wrapper reaps every slice under its root that its
 * state directory has no owner for, so only the production state directory may use
 * production's root; any other directory gets a private root derived from its identity.
 */
export function sliceRootFor(stateDir: string, production: Production = PRODUCTION) {
  if (isProductionState(stateDir, production)) return production.root
  const identity = directoryIdentity(stateDir) ?? path.resolve(stateDir)
  return `heavys${createHash('sha256').update(identity).digest('hex').slice(0, 10)}`
}

/** Whether the directory is production's state directory, by any path that reaches it. */
export function isProductionState(stateDir: string, production: Production = PRODUCTION) {
  const identity = directoryIdentity(stateDir)
  return identity !== null && identity === directoryIdentity(production.stateDir)
}

// Device and inode name a directory however it is reached: a symlink or a bind mount gives
// one directory several paths, and every one of them must own the same slices.
function directoryIdentity(dir: string) {
  const stat = unlessMissing(() => statSync(dir))
  return stat ? `${stat.dev}:${stat.ino}` : null
}
const POLL_MS = 5_000
const WAIT_NOTICE_MS = 60_000

// Holder lines are advisory; a missing or unreadable one must not stop a job from waiting.
function holderLine(file: string) {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * The Pi lane's one lock: a `--host pi` job, or a lane sync, waits for it. Pi jobs run on the
 * Pi under its own ceiling, so they take no part in this machine's admission or slot locks.
 */
export async function acquirePiLane(stateDir: string, pollMs = POLL_MS) {
  mkdirSync(stateDir, { recursive: true })
  const holder = path.join(stateDir, 'pi.holder')
  const started = Date.now()
  let nextNotice = 0
  for (;;) {
    const fd = tryLock(path.join(stateDir, 'pi.lock'))
    if (fd !== null) return { fd, holder }
    if (Date.now() - started >= nextNotice) {
      console.error(`[wave-heavy] the Pi lane is busy, waiting: ${holderLine(holder)}`)
      nextNotice += WAIT_NOTICE_MS
    }
    await Bun.sleep(pollMs)
  }
}
