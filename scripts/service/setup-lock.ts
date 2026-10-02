import { tryFileLock, type FileLock } from '../../apps/server/src/system/file-lock'
import { serviceErrors } from './structured-errors'

export async function acquireSetupLock(
  file: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<FileLock> {
  for (;;) {
    signal?.throwIfAborted()
    const lock = tryFileLock(file)
    if (lock) return lock
    if (Date.now() >= deadline)
      throw serviceErrors.SETUP_BUSY({ internal: { waitedForDeadline: true } })
    await Bun.sleep(100)
  }
}
