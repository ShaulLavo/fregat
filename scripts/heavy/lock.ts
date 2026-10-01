import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, openSync } from 'node:fs'

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
