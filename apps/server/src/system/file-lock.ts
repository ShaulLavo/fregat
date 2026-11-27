import { errorStringField } from '@workspace/contracts'
import { dlopen, FFIType } from 'bun:ffi'
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import { isWasiRuntime } from './runtime'

const LOCK_EX = 2
const LOCK_NB = 4

let libc: { flock: (fd: number, operation: number) => number } | undefined
const fallbackLocks = new Set<string>()

function flock(fd: number, operation: number) {
  libc ??= dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols
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
 * Under WASI (`wasm32`), where `bun:ffi` is unavailable, falls back to an exclusive PID lock file.
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

  const fd = openExclusiveOrReclaimStale(file)
  if (fd === null) return null

  let retained = false
  try {
    writeSync(fd, `${process.pid}\n`, 0)
    fallbackLocks.add(key)
    retained = true
    return {
      release: () => {
        if (!fallbackLocks.delete(key)) return
        rmSync(file, { force: true })
      },
    }
  } finally {
    closeSync(fd)
    if (!retained) rmSync(file, { force: true })
  }
}

function openExclusiveOrReclaimStale(file: string): number | null {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return openSync(file, 'wx', 0o600)
    } catch (error) {
      if (errorStringField(error, 'code') !== 'EEXIST') throw error
      if (attempt > 0 || isLockHolderAlive(file)) return null
      rmSync(file, { force: true })
    }
  }
  return null
}

function isLockHolderAlive(file: string): boolean {
  let pid: number
  try {
    pid = Number.parseInt(readFileSync(file, 'utf8'), 10)
  } catch {
    return false
  }
  if (!Number.isInteger(pid) || pid <= 0) return false
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorStringField(error, 'code') === 'EPERM'
  }
}
