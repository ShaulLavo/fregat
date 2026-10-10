import { execFile } from 'node:child_process'

/** Cancellation waits for close so the worker can finish its owned-resource cleanup. */
export function runLiveProcess(
  file,
  args,
  { signal, timeout = 180_000, cleanupTimeout = 45_000, maxBuffer = 4 * 1024 * 1024 } = {},
) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const expiry = new AbortController()
    let cleanupDeadline
    const child = execFile(file, args, { maxBuffer }, (error, stdout, stderr) => {
      clearTimeout(deadline)
      clearTimeout(cleanupDeadline)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(signal.reason)
      if (expiry.signal.aborted) return reject(expiry.signal.reason)
      if (error) return reject(error)
      resolve({ stdout, stderr })
    })
    const abort = () => {
      child.kill(signal?.reason === 'SIGINT' ? 'SIGINT' : 'SIGTERM')
      cleanupDeadline ??= setTimeout(() => child.kill('SIGKILL'), cleanupTimeout)
    }
    const deadline = setTimeout(() => {
      expiry.abort()
      abort()
    }, timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
