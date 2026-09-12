import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, test as base } from 'vitest'
import type { MachineConnectionState, Machines } from '@workspace/contracts'
import { createSshLauncher } from '../../src/machines/launcher'
import { parseDescriptor, type RemoteRecord } from '../../src/machines/records'
import type { SshChild, SshSpawner } from '../../src/machines/forward'
import { MachineService } from '../../src/machines/service'

export const descriptorValue = {
  ok: true,
  environmentId: '00000000-0000-4000-8000-000000000078',
  label: 'fixture',
  protocolVersion: 1,
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
    port: 31001,
    environmentId: descriptor.environmentId,
    startedAt: Bun.spawnSync(['ps', '-p', String(child.pid), '-o', 'lstart='])
      .stdout.toString()
      .trim(),
  }
  await writeRemoteRecord(remoteRoot, owner, record)
  return { child, record }
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
  options: { probeFails?: boolean; forwardFails?: boolean; slowProbe?: boolean },
) {
  if (command.includes('-N'))
    return options.forwardFails ? 'process.exit(42)' : 'setInterval(() => {}, 1000)'
  const remote = command.at(-1) ?? ''
  if (remote.includes('command -v platform-server')) return fakeProbe(options)
  if (remote.includes('await withLeaseLock(launch);'))
    return `process.stdout.write(${JSON.stringify(JSON.stringify(record) + '\n')})`
  return ''
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
    const root = path.resolve(import.meta.dirname, '../../../..')
    await mkdir(path.join(directory, 'packages/contracts/src'), { recursive: true })
    await symlink(
      path.join(root, 'packages/contracts/src/health.ts'),
      path.join(directory, 'packages/contracts/src/health.ts'),
    )
    await symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'))
    try {
      await provide(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
})
