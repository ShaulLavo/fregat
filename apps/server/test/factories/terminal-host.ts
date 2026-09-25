import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  hostPtyFactory,
  TerminalHostClient,
  type HostLauncher,
} from '../../src/terminal/host-client'
import { hostPaths } from '../../src/terminal-host/protocol'

const HOST_EXIT_MS = 5_000

/**
 * A real terminal host in a throwaway state root and runtime directory. `close` stops every host
 * process it launched, waits for each to exit, and removes both directories.
 */
export async function createTestTerminalHost({ idleMs = 5_000 }: { idleMs?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-pty-host-'))
  const stateRoot = path.join(root, 'home')
  const env = { ...process.env, XDG_RUNTIME_DIR: path.join(root, 'run') }
  const hosts: Bun.Subprocess[] = []
  const clients: TerminalHostClient[] = []
  // The production launcher, keeping the handle so the test can wait for the exit.
  const launch: HostLauncher = (argv, hostEnv) => {
    hosts.push(
      Bun.spawn([...argv], {
        env: hostEnv,
        detached: true,
        stdio: ['ignore', 'ignore', 'inherit'],
      }),
    )
  }
  const connect = () => {
    const client = new TerminalHostClient({ stateRoot, env, idleMs, launch })
    clients.push(client)
    return client
  }
  const client = connect()

  return {
    stateRoot,
    paths: hostPaths(stateRoot, env),
    client,
    factory: hostPtyFactory(client),
    /** Another server's view of the same host. */
    connect,
    hosts,
    async close() {
      for (const next of clients) next.close()
      await Promise.all(hosts.map(stopHost))
      await rm(root, { recursive: true, force: true })
    },
  }
}

// SIGTERM runs the host's own shutdown, which ends its shells first.
async function stopHost(host: Bun.Subprocess) {
  if (host.exitCode !== null || host.signalCode !== null) return
  host.kill('SIGTERM')
  const timeout = Bun.sleep(HOST_EXIT_MS).then(() => 'timeout' as const)
  if ((await Promise.race([host.exited, timeout])) !== 'timeout') return
  host.kill('SIGKILL')
  await host.exited
}
