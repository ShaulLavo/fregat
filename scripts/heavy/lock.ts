import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, openSync } from 'node:fs'

const LOCK_EX = 2
const LOCK_NB = 4
const libc = dlopen('libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
})

/**
 * An exclusive flock(2) on the file, or null when another process holds it. It is the
 * lock flock(1) takes, so scripts using either exclude each other. The descriptor is
 * close-on-exec: a job's children never inherit the lock, and it dies with this process.
 */
export function tryLock(file: string): number | null {
  const fd = openSync(file, 'a')
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return fd
  closeSync(fd)
  return null
}

export function unlock(fd: number) {
  closeSync(fd)
}
