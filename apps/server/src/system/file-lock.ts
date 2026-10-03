import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from 'node:fs'
import path from 'node:path'

const LOCK_EX = 2
const LOCK_NB = 4

let libc: { flock: (fd: number, operation: number) => number } | undefined

function flock(fd: number, operation: number) {
  libc ??= dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  }).symbols
  return libc.flock(fd, operation)
}

export type FileLock = { release: () => void }

/**
 * An exclusive flock held until `release` or process exit, or null while another holder has it.
 * The kernel drops it with its holder, so a crash leaves nothing stale and nothing is evicted.
 * Bun opens with O_CLOEXEC, so spawned children never inherit it.
 */
export function tryFileLock(file: string): FileLock | null {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
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
