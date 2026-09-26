import { dlopen, ptr } from 'bun:ffi'
import { realpath } from 'node:fs/promises'
import { FsError } from '../fs/errors'

/** Resolve the object already opened, even if a directory in its original path was replaced. */
export async function openedPath(fd: number): Promise<string> {
  if (process.platform === 'linux') return realpath(`/proc/self/fd/${fd}`)
  if (process.platform !== 'darwin')
    throw new FsError('OPERATION_FAILED', undefined, undefined, {
      internal: { platform: process.platform },
      why: 'This platform cannot validate the opened file path.',
      fix: 'Read the checkout on a Linux or macOS host.',
    })

  const library = dlopen('/usr/lib/system/libsystem_kernel.dylib', {
    __fcntl_nocancel: { args: ['i32', 'i32', 'ptr'], returns: 'i32' },
  })
  try {
    const buffer = Buffer.alloc(1024)
    // F_GETPATH through the fixed-arity syscall avoids Darwin arm64’s variadic fcntl ABI.
    if (library.symbols.__fcntl_nocancel(fd, 50, ptr(buffer)) !== 0)
      throw new FsError('OPERATION_FAILED', undefined, undefined, { internal: { fd } })
    return buffer.subarray(0, buffer.indexOf(0)).toString('utf8')
  } finally {
    library.close()
  }
}
