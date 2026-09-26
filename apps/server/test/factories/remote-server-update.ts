import * as v from 'valibot'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ORCHESTRATION_WS_PROTOCOL_VERSION, type Machines } from '@workspace/contracts'
import { afterEach } from 'vitest'
import { createSshLauncher } from '../../src/machines/launcher'
import type { SshSpawner } from '../../src/machines/forward'
import { releaseSource } from '../../src/machines/update'
import { machine, writeRelease } from './ssh'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

/** A PATH holding this test's bun and the base system, and no `platform-server`. */
export function remotePath(home: string, withBun = true) {
  const directories = [path.join(home, '.local/bin'), '/usr/bin', '/bin']
  if (withBun) directories.splice(1, 0, path.dirname(process.execPath))
  return directories.join(':')
}

/** A remote home, and a local directory of releases this server could ship. */
export async function updateFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-update-'))
  cleanups.push(() =>
    stopRemoteServers(root).then(() => rm(root, { recursive: true, force: true })),
  )
  const home = path.join(root, 'home')
  const local = path.join(root, 'local')
  await mkdir(home, { recursive: true })
  await mkdir(local, { recursive: true })
  return { root, home, local, serverRoot: path.join(home, '.platform/server') }
}

/**
 * A release as deploy leaves it: `server/` with its runtime manifest and a `node_modules` link to
 * this machine's packages, which the transfer must leave behind. The one small runtime dependency
 * is already in the checkout cache; postinstall counts installs in the remote home.
 */
export async function shippableRelease(
  local: string,
  name: string,
  protocolVersion = ORCHESTRATION_WS_PROTOCOL_VERSION,
) {
  await writeRelease(local, name, protocolVersion)
  const server = path.join(local, 'releases', name, 'server')
  await mkdir(path.join(server, 'runtime'), { recursive: true })
  const lock = v.parse(
    v.object({ packages: v.record(v.string(), v.unknown()) }),
    Bun.JSONC.parse(
      await readFile(path.resolve(import.meta.dirname, '../../../../bun.lock'), 'utf8'),
    ),
  )
  const entry = v.parse(v.looseTuple([v.string()]), lock.packages['detect-libc'])
  const dependencies = { 'detect-libc': entry[0].slice('detect-libc@'.length) }
  const manifest = {
    name: 'platform-server-runtime',
    private: true,
    dependencies,
    scripts: { postinstall: 'echo installed >> "$HOME/runtime-installs.log"' },
  }
  await writeFile(path.join(server, 'runtime/package.json'), JSON.stringify(manifest))
  await writeFile(
    path.join(server, 'runtime/bun.lock'),
    JSON.stringify({
      lockfileVersion: 1,
      configVersion: 1,
      workspaces: { '': { name: manifest.name, dependencies } },
      packages: { 'detect-libc': entry },
    }),
  )
  await symlink(
    path.resolve(import.meta.dirname, '../../node_modules'),
    path.join(server, 'node_modules'),
  )
  return releaseSource(server)
}

type LocalSshOptions = { home: string; path?: string }

/**
 * An SSH boundary that runs each remote command under a real `sh` with the remote's HOME and PATH,
 * streams stdin through, and maps a forwarded local port to the remote one.
 */
export function localSsh(options: LocalSshOptions) {
  const commands: string[] = []
  const forwards = new Map<string, string>()
  const spawn: SshSpawner = (command, stdin) => {
    const forward = command.indexOf('-L')
    if (forward >= 0) return forwardChild(command[forward + 1] ?? '', forwards)
    const remote = command.slice(command.indexOf('--') + 2).join(' ')
    commands.push(remote)
    const child = Bun.spawn({
      cmd: ['sh', '-c', remote],
      env: { HOME: options.home, PATH: options.path ?? remotePath(options.home), TMPDIR: tmpdir() },
      stdin: stdin ?? 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return child
  }
  const fetcher: typeof fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input)
      url.port = forwards.get(url.port) ?? url.port
      return fetch(url, init)
    },
    { preconnect: fetch.preconnect },
  )
  return { spawn, fetcher, localPort: async () => 51099, commands }
}

function forwardChild(mapping: string, forwards: Map<string, string>) {
  const [, localPort, , remotePort] = mapping.split(':')
  if (localPort && remotePort) forwards.set(localPort, remotePort)
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  cleanups.push(async () => {
    child.kill()
    await child.exited
  })
  return child
}

/** A launcher over `localSsh` for the machine `fixture`. */
export function updateLauncher(
  ssh: ReturnType<typeof localSsh>,
  supply: ReturnType<typeof releaseSource>,
  machines: Machines = { fixture: machine },
  clientId = '00000000-0000-4000-8000-000000000001',
) {
  const events: Array<{ action: string; fields: Record<string, unknown> }> = []
  const launcher = createSshLauncher({
    clientId,
    webOrigin: 'http://127.0.0.1:5173',
    readMachines: async () => machines,
    publish: () => undefined,
    spawn: ssh.spawn,
    fetcher: ssh.fetcher,
    localPort: ssh.localPort,
    record: (action, fields) => events.push({ action, fields }),
    releaseSource: supply,
  })
  cleanups.push(launcher.close)
  return { launcher, events }
}

// Launched release servers run detached; their process records name them.
async function stopRemoteServers(root: string) {
  const glob = new Bun.Glob('**/.platform-ssh-launch/*.process')
  for await (const file of glob.scan({ cwd: root, dot: true })) {
    const record: unknown = await Bun.file(path.join(root, file))
      .json()
      .catch(() => null)
    if (typeof record !== 'object' || record === null || !('pid' in record)) continue
    if (typeof record.pid !== 'number') continue
    try {
      process.kill(record.pid)
    } catch {
      // Already stopped by the launcher's own stop script.
    }
  }
}
