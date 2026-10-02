import { dlopen, FFIType } from 'bun:ffi'
import { closeSync, openSync } from 'node:fs'
import path from 'node:path'
import { launcherErrors } from './structured-errors'

export async function acquireProfileLock(options: {
  profile: string
  remainingMs(): number
  pollMs: number
  signal?: AbortSignal
}) {
  // flock is released by the kernel on process death. Keep the inode so waiters share the same lock.
  const library = flockLibrary()
  let fd: number | undefined
  try {
    fd = openSync(
      path.join(path.dirname(options.profile), path.basename(options.profile) + '.launcher.lock'),
      'a',
      0o600,
    )
    for (;;) {
      options.signal?.throwIfAborted()
      if (options.remainingMs() <= 0)
        throw launcherErrors.PROFILE_BUSY({ internal: { reason: 'launcher-lock-limit' } })
      if (library.symbols.flock(fd, 2 | 4) === 0) break
      await Bun.sleep(Math.min(options.pollMs, options.remainingMs()))
    }
    const held = fd
    return () => {
      closeSync(held)
      library.close()
    }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    library.close()
    throw error
  }
}

function flockLibrary() {
  const symbols = { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }
  if (process.platform === 'darwin') return dlopen('/usr/lib/libSystem.B.dylib', symbols)
  try {
    return dlopen('libc.so.6', symbols)
  } catch {
    return dlopen('libc.so', symbols)
  }
}
