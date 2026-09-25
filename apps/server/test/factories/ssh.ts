import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test as base } from 'vitest'
import {
  ORCHESTRATION_WS_PROTOCOL_VERSION,
  type MachineConnectionState,
  type Machines,
} from '@workspace/contracts'
import { createSshLauncher } from '../../src/machines/launcher'
import { parseDescriptor, type RemoteRecord } from '../../src/machines/records'
import { reserveForwardPort, type SshChild, type SshSpawner } from '../../src/machines/forward'
import { MachineService } from '../../src/machines/service'

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
const installation = {
  kind: 'source',
  directory: "/work/space ' $(touch unwanted)",
  executable: process.execPath,
} as const
export const clientId = '00000000-0000-4000-8000-000000000001'
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

function healthServerSource(protocolVersion: number) {
  const body = JSON.stringify({ ...descriptorValue, protocolVersion })
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

function fakeProbe(options: { probeFails?: boolean; slowProbe?: boolean }) {
  if (options.probeFails)
    return 'process.stderr.write("Permission denied (publickey)."); process.exit(255)'
  const output = `process.stdout.write(${JSON.stringify(JSON.stringify(installation))})`
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
