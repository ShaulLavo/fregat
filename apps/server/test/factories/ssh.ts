import { tmpdir } from 'node:os'
import { copyFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, afterEach, test as base } from 'vitest'
import {
  ORCHESTRATION_WS_PROTOCOL_VERSION,
  type MachineConnectionState,
  type Machines,
} from '@workspace/contracts'
import { createSshLauncher } from '../../src/machines/launcher'
import { releaseSource } from '../../src/machines/update'
import { parseDescriptor, type RemoteRecord } from '../../src/machines/records'
import { reserveForwardPort, type SshChild, type SshSpawner } from '../../src/machines/forward'
import { MachineService } from '../../src/machines/service'
import type { ReleaseInstallation, ServerInstallation } from '../../src/installation/descriptor'
import { REMOTE_SUPPORT } from '../../src/installation/release-files'

/** A production primary with no release to ship, as tests run the server from source. */
export const noRelease = releaseSource('/platform-test/no-release/server')

export const descriptorValue = {
  ok: true,
  environmentId: '00000000-0000-4000-8000-000000000078',
  label: 'fixture',
  protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
  serverVersion: 'test',
  platform: { os: 'linux', arch: 'x64' },
}

export const machine = {
  kind: 'ssh',
  target: 'fixture',
} satisfies Machines[string]
const installation: ServerInstallation = {
  kind: 'source',
  directory: "/work/space ' $(touch unwanted)",
  executable: process.execPath,
}
export const clientId = '00000000-0000-4000-8000-000000000001'

export function sourceInstallation(directory: string): ServerInstallation {
  return { kind: 'source', directory, executable: process.execPath }
}
const repositoryRoot = path.resolve(import.meta.dirname, '../../../..')

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

export async function fakeSsh(
  options: {
    kind?: 'managed' | 'external'
    probeFails?: boolean
    forwardFails?: boolean
    slowProbe?: boolean
    machines?: Machines
    descriptor?: typeof descriptorValue
    launchFailure?: Record<string, unknown>
    installation?: ServerInstallation
  } = {},
) {
  const descriptor = await parseDescriptor(options.descriptor ?? descriptorValue)
  const record = {
    leaseId: clientId,
    processId: options.kind === 'external' ? null : clientId,
    kind: options.kind ?? 'managed',
    pid: options.kind === 'external' ? null : 7890,
    port: 31001,
    startedAt: options.kind === 'external' ? null : 'Sat Sep  5 19:00:00 2026',
    descriptor,
  }
  const commands: string[][] = []
  const phases: MachineConnectionState[] = []
  const events: Array<{ action: string; fields: Record<string, unknown> }> = []
  const forwardChildren: SshChild[] = []
  const requestedPorts: Array<number | undefined> = []
  let health = options.descriptor ?? descriptorValue
  let serverAvailable = true
  const spawn: SshSpawner = (command) => {
    commands.push(command)
    if (command.at(-1)?.includes('await withLeaseLock(launch);')) serverAvailable = true
    const script = fakeProcessScript(command, record, options)
    const child = Bun.spawn({
      cmd: [process.execPath, '-e', script],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (command.includes('-N')) forwardChildren.push(child)
    cleanups.push(async () => {
      child.kill()
      await child.exited
    })
    return child
  }
  const fetcher: typeof fetch = Object.assign(
    async () => {
      if (!serverAvailable) throw new TypeError('The remote server refused the connection.')
      return Response.json(health)
    },
    { preconnect: fetch.preconnect },
  )
  const launcher = createSshLauncher({
    clientId,
    webOrigin: 'http://127.0.0.1:5173',
    readMachines: async () => options.machines ?? { fixture: machine },
    publish: (state) => phases.push(state),
    spawn,
    fetcher,
    localPort: async (previous) => {
      requestedPorts.push(previous)
      return previous ?? 51078
    },
    record: (action, fields) => events.push({ action, fields }),
    releaseSource: noRelease,
  })
  cleanups.push(launcher.close)
  return {
    launcher,
    spawn,
    fetcher,
    localPort: async () => 51078,
    commands,
    phases,
    events,
    forwardChildren,
    requestedPorts,
    crashServer: () => {
      serverAvailable = false
    },
    changeHealth: (next: typeof descriptorValue) => {
      health = next
    },
  }
}

export async function sshServiceFixture(options: Parameters<typeof fakeSsh>[0] = {}) {
  const boundary = await fakeSsh(options)
  let machines = options.machines ?? { fixture: machine }
  const service = new MachineService({
    environmentId: clientId,
    webOrigin: 'http://127.0.0.1:5173',
    readMachines: () => machines,
    spawn: boundary.spawn,
    fetcher: boundary.fetcher,
    localPort: boundary.localPort,
    releaseSource: noRelease,
  })
  cleanups.push(() => service.close())
  return {
    ...boundary,
    service,
    setMachines: (next: Machines) => {
      machines = next
    },
  }
}

export async function recordedRemoteProcess(
  remoteRoot: string,
  owner: string,
  processId: string = crypto.randomUUID(),
) {
  const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  return recordProcess(remoteRoot, owner, child, 31001, processId)
}

/** A managed server that answers /health with `protocolVersion`, recorded as `owner`'s lease. */
export async function servingRemoteProcess(
  remoteRoot: string,
  owner: string,
  protocolVersion: number,
) {
  const port = await reserveForwardPort()
  const child = Bun.spawn([process.execPath, '-e', healthServerSource(protocolVersion)], {
    env: { ...process.env, PORT: String(port) },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  await waitForHealth(port)
  return recordProcess(remoteRoot, owner, child, port, crypto.randomUUID())
}

async function recordProcess(
  remoteRoot: string,
  owner: string,
  child: Bun.Subprocess,
  port: number,
  processId: string,
) {
  cleanups.push(async () => {
    child.kill()
    await child.exited
  })
  const descriptor = await parseDescriptor(descriptorValue)
  const record: RemoteRecord = {
    leaseId: crypto.randomUUID(),
    processId,
    kind: 'managed',
    pid: child.pid,
    port,
    environmentId: descriptor.environmentId,
    startedAt: processStart(child.pid),
  }
  await writeRemoteRecord(remoteRoot, owner, record)
  return { child, record }
}

function processStart(pid: number) {
  return Bun.spawnSync(['ps', '-p', String(pid), '-o', 'lstart='])
    .stdout.toString()
    .trim()
}

function healthServerSource(
  protocolVersion: number,
  serverVersion = descriptorValue.serverVersion,
) {
  const body = JSON.stringify({ ...descriptorValue, protocolVersion, serverVersion })
  return `Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT), fetch: () => Response.json(${body}) })`
}

async function waitForHealth(port: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null)
    if (response?.ok) return
    await Bun.sleep(50)
  }
  throw new TypeError(`The fixture server on port ${port} never answered /health.`)
}

/** Links the real contracts declaration, so the launch script's parse of it is pinned. */
export async function linkCheckoutProtocol(remoteRoot: string) {
  await symlink(
    path.join(repositoryRoot, 'packages/contracts/src/orchestration-ws.ts'),
    path.join(remoteRoot, 'packages/contracts/src/orchestration-ws.ts'),
  )
}

/** The checkout's own protocol constant, as the launch script reads it. */
export async function writeCheckoutProtocol(remoteRoot: string, protocolVersion: number) {
  await writeFile(
    path.join(remoteRoot, 'packages/contracts/src/orchestration-ws.ts'),
    `export const ORCHESTRATION_WS_PROTOCOL_VERSION = ${protocolVersion}\n`,
  )
}

/** The checkout's server entry, which a fresh launch starts: it answers /health with `protocolVersion`. */
export async function writeCheckoutServer(remoteRoot: string, protocolVersion: number) {
  await mkdir(path.join(remoteRoot, 'apps/server/src'), { recursive: true })
  await writeFile(
    path.join(remoteRoot, 'apps/server/src/index.ts'),
    healthServerSource(protocolVersion),
  )
  await writeFile(path.join(remoteRoot, '.env'), '')
}

/** Stops a server the launch script started detached, so a failed assertion cannot leak it. */
export function stopLaunchedServer(pid: number) {
  cleanups.push(async () => {
    try {
      process.kill(pid)
    } catch {
      // Already stopped by the test's own stop script.
    }
  })
}

const cleanupsAfterFile: Array<() => Promise<unknown>> = []
afterAll(async () => {
  await Promise.allSettled(cleanupsAfterFile.map((cleanup) => cleanup()))
})
let remoteSupport: Promise<string> | null = null

/** The real remote-support entry, bundled once per test file the way the server build bundles it. */
function remoteSupportBundle() {
  remoteSupport ??= (async () => {
    const outdir = await mkdtemp(path.join(tmpdir(), 'platform-remote-support-'))
    cleanupsAfterFile.push(() => rm(outdir, { recursive: true, force: true }))
    const result = await Bun.build({
      entrypoints: [path.join(repositoryRoot, 'apps/server/src/installation/remote-support.ts')],
      target: 'bun',
      outdir,
      naming: REMOTE_SUPPORT,
    })
    if (!result.success) throw new AggregateError(result.logs, 'remote-support did not bundle')
    return path.join(outdir, REMOTE_SUPPORT)
  })()
  return remoteSupport
}

/**
 * `<serverRoot>/releases/<name>`: its server/index.js answers /health with `protocolVersion` and
 * reports `name` as its serverVersion, beside the real remote-support.js. A `supportProtocol`
 * other than this server's wraps that bundle so the release claims the older constant.
 */
export async function writeRelease(
  serverRoot: string,
  name: string,
  protocolVersion: number,
  supportProtocol: number = ORCHESTRATION_WS_PROTOCOL_VERSION,
) {
  const server = path.join(serverRoot, 'releases', name, 'server')
  await mkdir(server, { recursive: true })
  await writeFile(path.join(server, 'index.js'), healthServerSource(protocolVersion, name))
  if (supportProtocol === ORCHESTRATION_WS_PROTOCOL_VERSION) {
    await copyFile(await remoteSupportBundle(), path.join(server, REMOTE_SUPPORT))
    return
  }
  await copyFile(await remoteSupportBundle(), path.join(server, 'remote-support.bundle.js'))
  await writeFile(
    path.join(server, REMOTE_SUPPORT),
    `export { createError, healthDescriptorSchema } from './remote-support.bundle.js';\nexport const ORCHESTRATION_WS_PROTOCOL_VERSION = ${supportProtocol};\n`,
  )
}

/** A release whose server/index.js exits at once, as a crashing server does. */
export async function writeCrashingRelease(serverRoot: string, name: string) {
  const server = path.join(serverRoot, 'releases', name, 'server')
  await mkdir(server, { recursive: true })
  await writeFile(path.join(server, 'index.js'), 'process.exit(3)')
  await copyFile(await remoteSupportBundle(), path.join(server, REMOTE_SUPPORT))
}

/** Swaps `current` the way an update does: a new link renamed over the old one. */
export async function pointCurrent(serverRoot: string, name: string) {
  const staging = path.join(serverRoot, 'current.next')
  await symlink(path.join('releases', name), staging)
  await rename(staging, path.join(serverRoot, 'current'))
}

export function releaseInstallation(serverRoot: string): ReleaseInstallation {
  return {
    kind: 'release',
    directory: path.join(serverRoot, 'current'),
    executable: process.execPath,
  }
}

/** Runs a launch or stop command the way SSH does: through `sh -c`. */
export async function runRemoteCommand(command: string) {
  const child = Bun.spawn(['sh', '-c', command], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

export async function writeRemoteRecord(remoteRoot: string, owner: string, record: RemoteRecord) {
  await mkdir(path.join(remoteRoot, '.platform-ssh-launch'), { recursive: true })
  await writeFile(
    path.join(remoteRoot, '.platform-ssh-launch', `${owner}.json`),
    JSON.stringify(record),
  )
  if (record.kind !== 'managed') return
  const { leaseId: _leaseId, ...processRecord } = record
  await writeFile(
    path.join(remoteRoot, '.platform-ssh-launch', `${record.processId}.process`),
    JSON.stringify(processRecord),
  )
}

export async function runRemoteScript(remoteRoot: string, source: string) {
  const child = Bun.spawn([process.execPath, '-e', source], {
    cwd: remoteRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

export function remoteHealthResponse() {
  return `import networkBoundary from 'node:net';
networkBoundary.createServer = () => { throw new TypeError('A managed server should be reused without a new listener.'); };
globalThis.fetch = async () => Response.json(${JSON.stringify(descriptorValue)});\n`
}

function fakeProcessScript(
  command: string[],
  record: unknown,
  options: {
    probeFails?: boolean
    forwardFails?: boolean
    slowProbe?: boolean
    launchFailure?: Record<string, unknown>
    installation?: ServerInstallation
  },
) {
  if (command.includes('-N'))
    return options.forwardFails ? 'process.exit(42)' : 'setInterval(() => {}, 1000)'
  const remote = command.at(-1) ?? ''
  if (remote.includes('command -v platform-server')) return fakeProbe(options)
  if (!remote.includes('await withLeaseLock(launch);')) return ''
  if (options.launchFailure)
    return `process.stderr.write(${JSON.stringify(JSON.stringify(options.launchFailure) + '\n')}); process.exit(1)`
  return `process.stdout.write(${JSON.stringify(JSON.stringify(record) + '\n')})`
}

function fakeProbe(options: {
  probeFails?: boolean
  slowProbe?: boolean
  installation?: ServerInstallation
}) {
  if (options.probeFails)
    return 'process.stderr.write("Permission denied (publickey)."); process.exit(255)'
  const described = options.installation ?? installation
  const output = `process.stdout.write(${JSON.stringify(JSON.stringify(described))})`
  return options.slowProbe ? `await Bun.sleep(1000); ${output}` : output
}

export const test = base.extend<{ remoteRoot: string }>({
  remoteRoot: async ({ task }, provide) => {
    void task
    const directory = await mkdtemp(path.join(tmpdir(), 'platform-ssh-'))
    await mkdir(path.join(directory, 'packages/contracts/src'), { recursive: true })
    await symlink(
      path.join(repositoryRoot, 'packages/contracts/src/health.ts'),
      path.join(directory, 'packages/contracts/src/health.ts'),
    )
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(directory, 'node_modules'))
    try {
      await provide(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
})
