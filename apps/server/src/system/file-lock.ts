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
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isWasiRuntime } from './runtime'

const LOCK_EX = 2
const LOCK_NB = 4
const STALE_EMPTY_AGE_MS = 5_000
const DEFAULT_LEASE_TTL_MS = 6_000
const MIN_HEARTBEAT_MS = 50
const MAX_RECLAIM_DEPTH = 3

let libc: { flock: (fd: number, operation: number) => number } | undefined
const fallbackLocks = new Set<string>()
const ownedTokens = new Set<string>()

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
  readonly leaseTtlMs?: number
}

/**
 * An exclusive flock held until `release` or process exit, or null while another holder has it.
 * The kernel drops it with its holder, so a crash leaves nothing stale and nothing is evicted.
 * Bun opens with O_CLOEXEC, so spawned children never inherit it.
 * Under WASI (`wasm32`), where `bun:ffi` is unavailable, publishes an atomic link-based lease lock
 * refreshed in place by a heartbeat so crashed owners expire and are reclaimed safely.
 */
export function tryFileLock(file: string, options: FileLockOptions = {}): FileLock | null {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const useNativeFfi = options.useNativeFfi ?? !isWasiRuntime()
  if (!useNativeFfi) return tryExclusiveLockFile(file, options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS)
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

function tryExclusiveLockFile(file: string, leaseTtlMs: number): FileLock | null {
  const key = path.resolve(file)
  if (fallbackLocks.has(key)) return null

  const token = randomBytes(8).toString('hex')
  const staging = `${file}.${process.pid}.${token}.tmp`
  const fd = openSync(staging, 'wx+', 0o600)
  let retained = false
  try {
    writeLeaseRecord(fd, process.pid, token, Date.now() + leaseTtlMs)
    const ownedIno = publishAtomicLock(staging, file, token, leaseTtlMs)
    if (ownedIno === null) return null
    fallbackLocks.add(key)
    ownedTokens.add(token)
    const heartbeat = startLeaseHeartbeat(fd, file, ownedIno, token, leaseTtlMs)
    retained = true
    return {
      release: () => {
        if (!fallbackLocks.delete(key)) return
        ownedTokens.delete(token)
        clearInterval(heartbeat)
        try {
          closeSync(fd)
        } catch {
          // Descriptor may already be closed.
        }
        unlinkMatchingLock(file, ownedIno, token)
      },
    }
  } finally {
    if (!retained) closeSync(fd)
    rmSync(staging, { force: true })
  }
}

function formatLeaseRecord(pid: number, token: string, expiresAtMs: number): string {
  const paddedExpiry = String(Math.max(0, Math.trunc(expiresAtMs))).padStart(16, '0')
  return `${pid}:${token}:${paddedExpiry}\n`
}

function writeLeaseRecord(fd: number, pid: number, token: string, expiresAtMs: number) {
  writeSync(fd, formatLeaseRecord(pid, token, expiresAtMs), 0)
}

function startLeaseHeartbeat(
  fd: number,
  file: string,
  ownedIno: number,
  token: string,
  leaseTtlMs: number,
) {
  const intervalMs = Math.max(MIN_HEARTBEAT_MS, Math.floor(leaseTtlMs / 3))
  const timer = setInterval(() => {
    const current = readLockSnapshot(file)
    if (!current || current.ino !== ownedIno || current.token !== token) return
    try {
      writeLeaseRecord(fd, process.pid, token, Date.now() + leaseTtlMs)
    } catch {
      // Stop silently if the lock file was released concurrently.
    }
  }, intervalMs)
  timer.unref?.()
  return timer
}

function publishAtomicLock(
  staging: string,
  file: string,
  token: string,
  leaseTtlMs: number,
): number | null {
  if (tryLink(staging, file)) return readOwnedInode(file, token)
  if (!reclaimStaleLock(file, 0, leaseTtlMs)) return null
  if (tryLink(staging, file)) return readOwnedInode(file, token)
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
 * inode and token before unlinking, so contenders never unlink a live replacement lock.
 */
function reclaimStaleLock(target: string, depth: number, leaseTtlMs: number): boolean {
  if (depth >= MAX_RECLAIM_DEPTH) return false
  const snapshot = readLockSnapshot(target)
  if (!snapshot || !isSnapshotStale(snapshot, leaseTtlMs)) return false

  const witness = `${target}.reclaim.${snapshot.token ?? `ino-${snapshot.ino}`}`
  const token = randomBytes(8).toString('hex')
  const staging = `${witness}.${process.pid}.${token}.tmp`
  const fd = openSync(staging, 'wx+', 0o600)
  let witnessIno: number | null = null
  try {
    try {
      writeLeaseRecord(fd, process.pid, token, Date.now() + leaseTtlMs)
    } finally {
      closeSync(fd)
    }
    ownedTokens.add(token)
    witnessIno = acquireWitness(staging, witness, token, depth, leaseTtlMs)
    if (witnessIno === null) return false
    const current = readLockSnapshot(target)
    if (!current || !sameSnapshot(current, snapshot) || !isSnapshotStale(current, leaseTtlMs)) {
      return false
    }
    rmSync(target, { force: true })
    return true
  } finally {
    ownedTokens.delete(token)
    rmSync(staging, { force: true })
    if (witnessIno !== null) unlinkMatchingLock(witness, witnessIno, token)
  }
}

function acquireWitness(
  staging: string,
  witness: string,
  token: string,
  depth: number,
  leaseTtlMs: number,
): number | null {
  if (tryLink(staging, witness)) return readOwnedInode(witness, token)
  if (!reclaimStaleLock(witness, depth + 1, leaseTtlMs)) return null
  if (tryLink(staging, witness)) return readOwnedInode(witness, token)
  return null
}

type LockSnapshot = {
  readonly ino: number
  readonly size: number
  readonly mtimeMs: number
  readonly content: string
  readonly pid: number | null
  readonly token: string | null
  readonly expiresAtMs: number | null
}

function readLockSnapshot(file: string): LockSnapshot | null {
  try {
    const info = lstatSync(file)
    if (!info.isFile()) return null
    const content = readFileSync(file, 'utf8')
    const parsed = parseLockRecord(content)
    return { ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, content, ...parsed }
  } catch {
    return null
  }
}

function parseLockRecord(content: string): {
  readonly pid: number | null
  readonly token: string | null
  readonly expiresAtMs: number | null
} {
  const match = /^(\d+)(?::([a-f0-9]+)(?::(\d+))?)?\s*$/.exec(content)
  if (!match) return { pid: null, token: null, expiresAtMs: null }
  const pid = Number.parseInt(match[1] ?? '', 10)
  const token = match[2] ?? null
  const expiresRaw = match[3] ? Number.parseInt(match[3], 10) : null
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    token,
    expiresAtMs: expiresRaw !== null && Number.isFinite(expiresRaw) ? expiresRaw : null,
  }
}

function sameSnapshot(left: LockSnapshot, right: LockSnapshot): boolean {
  if (left.ino !== right.ino || left.token !== right.token) return false
  return left.token !== null || left.content === right.content
}

function isSnapshotStale(snapshot: LockSnapshot, leaseTtlMs: number): boolean {
  if (snapshot.token && ownedTokens.has(snapshot.token)) return false
  if (snapshot.pid === null) {
    return snapshot.size === 0 && Date.now() - snapshot.mtimeMs > STALE_EMPTY_AGE_MS
  }
  const pidState = probePidLiveness(snapshot.pid)
  if (pidState === 'alive') return false
  if (pidState === 'dead') return true
  // WASI (`process.kill` returns ENOSYS, and every process shares pid 1) decides liveness by lease.
  if (snapshot.expiresAtMs !== null) return Date.now() > snapshot.expiresAtMs
  return Date.now() - snapshot.mtimeMs > leaseTtlMs
}

function probePidLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  if (isWasiRuntime() || pid === process.pid) return 'unknown'
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    const code = errorStringField(error, 'code')
    if (code === 'ESRCH') return 'dead'
    if (code === 'EPERM') return 'alive'
    return 'unknown'
  }
}

function readOwnedInode(file: string, token: string): number | null {
  const snapshot = readLockSnapshot(file)
  if (!snapshot || snapshot.token !== token) return null
  return snapshot.ino
}

function unlinkMatchingLock(file: string, ownedIno: number, ownedToken: string) {
  const current = readLockSnapshot(file)
  if (!current || current.ino !== ownedIno || current.token !== ownedToken) return
  rmSync(file, { force: true })
}
