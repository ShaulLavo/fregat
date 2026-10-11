import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

export async function withTerminalCheck<T>(
  scratchRoot: string,
  run: (directory: string, signal: AbortSignal) => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let directory: string | undefined
  try {
    directory = await mkdtemp(path.join(scratchRoot, 'fregat-live-terminal-'))
    controller.signal.throwIfAborted()
    return await run(directory, controller.signal)
  } finally {
    try {
      await cleanup()
      if (directory) await rm(directory, { recursive: true, force: true })
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
  }
}
