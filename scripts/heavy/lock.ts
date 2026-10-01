import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import path from 'node:path'

const LOCK_SH = 1
const LOCK_EX = 2
const LOCK_NB = 4
const libc = dlopen('libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

export type LockMode = 'shared' | 'exclusive'

/**
 * A flock(2) on the file, or null when a conflicting holder has it. It is the lock flock(1)
 * takes, so scripts using either exclude each other. The descriptor is close-on-exec: a
 * job's children never inherit the lock, and it dies with this process.
 */
export function tryLock(file: string, mode: LockMode = 'exclusive'): number | null {
  const fd = openSync(file, 'a')
  if (libc.symbols.flock(fd, operation(mode) | LOCK_NB) === 0) return fd
  closeSync(fd)
  return null
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
