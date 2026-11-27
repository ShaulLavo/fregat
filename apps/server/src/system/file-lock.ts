import { errorStringField } from '@workspace/contracts'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isWasiRuntime } from './runtime'

const LOCK_EX = 2
const LOCK_NB = 4
const STALE_EMPTY_AGE_MS = 5_000
const MAX_RECLAIM_DEPTH = 3

let libc: { flock: (fd: number, operation: number) => number } | undefined
const fallbackLocks = new Set<string>()

function flock(fd: number, operation: number) {
  if (!libc) {
    const { dlopen, FFIType } = createRequire(import.meta.url)(
      'bun:ffi',
    ) as typeof import('bun:ffi')
    libc = dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    }).symbols
  }
  return libc.flock(fd, operation)
}

export type FileLock = { release: () => void }

export type FileLockOptions = {
  readonly useNativeFfi?: boolean
}

/**
 * An exclusive flock held until `release` or process exit, or null while another holder has it.
 * The kernel drops it with its holder, so a crash leaves nothing stale and nothing is evicted.
 * Bun opens with O_CLOEXEC, so spawned children never inherit it.
 * Under WASI (`wasm32`), where `bun:ffi` is unavailable, publishes an atomic link-based PID lock.
 */
export function tryFileLock(file: string, options: FileLockOptions = {}): FileLock | null {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const useNativeFfi = options.useNativeFfi ?? !isWasiRuntime()
  if (!useNativeFfi) return tryExclusiveLockFile(file)
  return tryFlockFile(file)
}

function tryFlockFile(file: string): FileLock | null {
  const fd = openSync(file, 'a+', 0o600)
  let retained = false
  try {
    if (flock(fd, LOCK_EX | LOCK_NB) !== 0) return null
    // Diagnostics only: the lock, not this number, decides ownership.
    ftruncateSync(fd)
    writeSync(fd, `${process.pid}\n`, 0)
    retained = true
    return { release: () => closeSync(fd) }
  } finally {
    if (!retained) closeSync(fd)
  }
}

function tryExclusiveLockFile(file: string): FileLock | null {
  const key = path.resolve(file)
  if (fallbackLocks.has(key)) return null

  const token = randomBytes(8).toString('hex')
  const content = `${process.pid}:${token}\n`
  const staging = `${file}.${process.pid}.${token}.tmp`
  writeFileSync(staging, content, { flag: 'wx', mode: 0o600 })
  try {
    const ownedIno = publishAtomicLock(staging, file, content)
    if (ownedIno === null) return null
    fallbackLocks.add(key)
    return {
      release: () => {
        if (!fallbackLocks.delete(key)) return
        unlinkMatchingLock(file, ownedIno, content)
      },
    }
  } finally {
    rmSync(staging, { force: true })
  }
}

function publishAtomicLock(staging: string, file: string, content: string): number | null {
  if (tryLink(staging, file)) return readOwnedInode(file, content)
  if (!reclaimStaleLock(file, 0)) return null
  if (tryLink(staging, file)) return readOwnedInode(file, content)
  return null
}

function tryLink(staging: string, target: string): boolean {
  try {
    linkSync(staging, target)
    return true
  } catch (error) {
    if (errorStringField(error, 'code') === 'EEXIST') return false
    throw error
  }
}

/**
 * Serializes stale-lock cleanup with a per-incarnation witness file and re-verifies the observed
 * inode and content before unlinking, so contenders never unlink a live replacement lock.
 */
function reclaimStaleLock(target: string, depth: number): boolean {
  if (depth >= MAX_RECLAIM_DEPTH) return false
  const snapshot = readLockSnapshot(target)
  if (!snapshot || !isSnapshotStale(snapshot)) return false

  const witness = `${target}.reclaim.${snapshotWitnessId(snapshot)}`
  const token = randomBytes(8).toString('hex')
  const content = `${process.pid}:${token}\n`
  const staging = `${witness}.${process.pid}.${token}.tmp`
  writeFileSync(staging, content, { flag: 'wx', mode: 0o600 })
  let witnessIno: number | null = null
  try {
    witnessIno = acquireWitness(staging, witness, content, depth)
    if (witnessIno === null) return false
    const current = readLockSnapshot(target)
    if (!current || !sameSnapshot(current, snapshot) || !isSnapshotStale(current)) return false
    rmSync(target, { force: true })
    return true
  } finally {
    rmSync(staging, { force: true })
    if (witnessIno !== null) unlinkMatchingLock(witness, witnessIno, content)
  }
}

function acquireWitness(
  staging: string,
  witness: string,
  content: string,
  depth: number,
): number | null {
  if (tryLink(staging, witness)) return readOwnedInode(witness, content)
  if (!reclaimStaleLock(witness, depth + 1)) return null
  if (tryLink(staging, witness)) return readOwnedInode(witness, content)
  return null
}

type LockSnapshot = {
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly content: string
}

function readLockSnapshot(file: string): LockSnapshot | null {
  try {
    const info = lstatSync(file)
    if (!info.isFile()) return null
    const content = readFileSync(file, 'utf8')
    return { ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, content }
  } catch {
    return null
  }
}

function snapshotWitnessId(snapshot: LockSnapshot): string {
  const token = /^\d+:([a-f0-9]+)\s*$/.exec(snapshot.content)?.[1]
  return token ?? `ino-${snapshot.ino}`
}

function sameSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.ino === right.ino && left.content === right.content
}

function isSnapshotStale(snapshot: LockSnapshot): boolean {
  const pid = Number.parseInt(snapshot.content, 10)
  if (!Number.isInteger(pid) || pid <= 0) {
    return snapshot.size === 0 && Date.now() - snapshot.mtimeMs > STALE_EMPTY_AGE_MS
  }
  if (pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    // Only ESRCH proves the PID is dead; EPERM or ENOSYS (WASI) must fail closed.
    return errorStringField(error, 'code') === 'ESRCH'
  }
}

function readOwnedInode(file: string, content: string): number | null {
  const snapshot = readLockSnapshot(file)
  if (!snapshot || snapshot.content !== content) return null
  return snapshot.ino
}

function unlinkMatchingLock(file: string, ownedIno: number, ownedContent: string) {
  const current = readLockSnapshot(file)
  if (!current || current.ino !== ownedIno || current.content !== ownedContent) return
  rmSync(file, { force: true })
}
