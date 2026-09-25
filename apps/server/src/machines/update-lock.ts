import { shellQuote } from '../utils/shell'
import { sshCommand, type SshSpawner } from './forward'
import { updateErrors } from './structured-errors'

type Remote = { spawn: SshSpawner; target: string; signal: AbortSignal }

export function withUpdateLock<T>(
  remote: Remote,
  directory: string,
  bun: string,
  action: () => Promise<T>,
) {
  return withRemoteLock(remote, directory, '.update-lock.sqlite', bun, action)
}

export function withLaunchLock<T>(
  remote: Remote,
  directory: string,
  bun: string,
  action: () => Promise<T>,
) {
  return withRemoteLock(remote, `${directory}/.platform-ssh-launch`, 'lock.sqlite', bun, action)
}

// SQLite releases the lock when SSH closes, including a killed primary.
async function withRemoteLock<T>(
  remote: Remote,
  directory: string,
  filename: string,
  bun: string,
  action: () => Promise<T>,
): Promise<T> {
  remote.signal.throwIfAborted()
  const input = new TransformStream<Uint8Array, Uint8Array>()
  const writer = input.writable.getWriter()
  const script = `import { Database } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
await mkdir(${JSON.stringify(directory)}, { recursive: true });
const db = new Database(${JSON.stringify(`${directory}/${filename}`)});
db.exec('PRAGMA busy_timeout = 600000; BEGIN IMMEDIATE');
process.stdout.write('locked\\n');
await new Response(Bun.stdin.stream()).text();
db.close();`
  const child = remote.spawn(
    sshCommand(remote.target, `${shellQuote(bun)} -e ${shellQuote(script)}`),
    input.readable,
  )
  const abort = () => child.kill('SIGTERM')
  remote.signal.addEventListener('abort', abort, { once: true })
  if (remote.signal.aborted) abort()
  const timeout = setTimeout(abort, 900_000)
  const stderr = new Response(child.stderr).text()
  const reader = child.stdout.getReader()
  try {
    const first = await reader.read()
    remote.signal.throwIfAborted()
    if (first.done || new TextDecoder().decode(first.value).trim() !== 'locked')
      throw updateErrors.install({
        internal: { step: 'lock', stderr: (await stderr).slice(-2000) },
      })
    clearTimeout(timeout)
    // The action may restore with a fresh signal after cancellation.
    remote.signal.removeEventListener('abort', abort)
    return await action()
  } finally {
    clearTimeout(timeout)
    remote.signal.removeEventListener('abort', abort)
    await writer.close().catch(() => undefined)
    child.kill('SIGTERM')
    await child.exited
    await stderr
    reader.releaseLock()
  }
}
