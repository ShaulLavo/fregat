import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { shellQuote } from '../../utils/shell'
import { mkdir, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { launchScript, stopCommand, stopScript } from '../remote-scripts'
import { parseDescriptor, parseRemoteRecord, remoteFailure, type RemoteRecord } from '../records'
import {
  clientId,
  descriptorValue,
  linkCheckoutProtocol,
  machine,
  test,
  recordedRemoteProcess,
  runRemoteScript,
  remoteHealthResponse,
  servingRemoteProcess,
  sourceInstallation,
  stopLaunchedServer,
  writeCheckoutProtocol,
  writeCheckoutServer,
  writeRemoteRecord,
} from '../../../test/factories/ssh'

type SourceLaunch = Omit<Parameters<typeof launchScript>[0], 'installation'>

function sourceLaunch(remoteRoot: string, options: SourceLaunch) {
  return launchScript({ ...options, installation: sourceInstallation(remoteRoot) })
}

function sourceStop(remoteRoot: string, owner: string, record: RemoteRecord | null) {
  return stopScript({ installation: sourceInstallation(remoteRoot), clientId: owner }, record)
}

test('shell quoting preserves spaces, substitutions and single quotes literally', async ({
  remoteRoot,
}) => {
  const input = `${remoteRoot}/space ' ; $(touch ${remoteRoot}/injected) \`id\``
  const child = Bun.spawn(['sh', '-c', `printf %s ${shellQuote(input)}`], { stdout: 'pipe' })
  expect(await new Response(child.stdout).text()).toBe(input)
  expect(await child.exited).toBe(0)
  expect(await Bun.file(path.join(remoteRoot, 'injected')).exists()).toBe(false)
})

test('launch script keeps all caller values as data', async () => {
  const source = sourceLaunch('/remote', {
    machine: { ...machine, remotePort: 32001 },
    clientId,
    webOrigin: 'http://127.0.0.1:5173',
  })
  expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(source)).not.toThrow()
  expect(source).toContain('"remotePort":32001')
  expect(source).toContain("FS_HOST: '127.0.0.1'")
  expect(source).toContain('await rename(temporary, file)')
  expect(source).not.toContain('curl')
})

test('stop removes an external record and leaves its process running', async ({ remoteRoot }) => {
  await checkStop(remoteRoot, 'external')
})

test('stop removes a managed record and stops its process', async ({ remoteRoot }) => {
  await checkStop(remoteRoot, 'managed')
})

test('managed aliases retain the shared process until their final concurrent disconnect', async ({
  remoteRoot,
}) => {
  const { child, record } = await recordedRemoteProcess(remoteRoot, 'first')
  const aliases = await Promise.all(
    ['second', 'third'].map((owner) =>
      runRemoteScript(
        remoteRoot,
        remoteHealthResponse() +
          sourceLaunch(remoteRoot, {
            machine: { ...machine, remotePort: record.port },
            clientId: owner,
            webOrigin: 'http://127.0.0.1:5173',
          }),
      ),
    ),
  )
  for (const alias of aliases) {
    expect(alias.exitCode, alias.stderr).toBe(0)
    expect(JSON.parse(alias.stdout)).toMatchObject({ ...record, leaseId: expect.any(String) })
    expect(JSON.parse(alias.stdout).leaseId).not.toBe(record.leaseId)
  }
  const first = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, 'first', record))
  expect(first.exitCode, first.stderr).toBe(0)
  expect(child.signalCode).toBeNull()
  const remaining = await Promise.all(
    ['second', 'third'].map(async (owner, index) =>
      runRemoteScript(
        remoteRoot,
        sourceStop(remoteRoot, owner, await parseRemoteRecord(aliases[index]!.stdout)),
      ),
    ),
  )
  for (const stopped of remaining) expect(stopped.exitCode, stopped.stderr).toBe(0)
  await child.exited
  expect(child.signalCode).not.toBeNull()
  const repeated = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, 'third', record))
  expect(repeated.exitCode, repeated.stderr).toBe(0)
})

test('alias leases follow a restarted managed process and disconnect with their retained ownership', async ({
  remoteRoot,
}) => {
  const original = await recordedRemoteProcess(remoteRoot, 'first')
  const options = {
    machine: { ...machine, remotePort: original.record.port },
    clientId: 'second',
    webOrigin: 'http://127.0.0.1:5173',
  }
  const connected = await runRemoteScript(
    remoteRoot,
    remoteHealthResponse() + sourceLaunch(remoteRoot, options),
  )
  expect(connected.exitCode, connected.stderr).toBe(0)
  const retainedAlias = await parseRemoteRecord(connected.stdout)
  original.child.kill()
  await original.child.exited
  const replacement = await recordedRemoteProcess(
    remoteRoot,
    'replacement',
    original.record.processId!,
  )
  const restarted = await runRemoteScript(
    remoteRoot,
    remoteHealthResponse() + sourceLaunch(remoteRoot, { ...options, clientId: 'first' }),
  )
  expect(restarted.exitCode, restarted.stderr).toBe(0)
  const first = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, 'first', original.record))
  expect(first.exitCode, first.stderr).toBe(0)
  const other = await runRemoteScript(
    remoteRoot,
    sourceStop(remoteRoot, 'replacement', replacement.record),
  )
  expect(other.exitCode, other.stderr).toBe(0)
  expect(replacement.child.signalCode).toBeNull()
  const final = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, 'second', retainedAlias))
  expect(final.exitCode, final.stderr).toBe(0)
  await replacement.child.exited
  expect(replacement.child.signalCode).not.toBeNull()
})

test('an interrupted first lease publication leaves an adoptable managed process', async ({
  remoteRoot,
}) => {
  const { child, record } = await recordedRemoteProcess(remoteRoot, 'interrupted')
  await unlink(path.join(remoteRoot, '.platform-ssh-launch/interrupted.json'))
  const source =
    remoteHealthResponse() +
    sourceLaunch(remoteRoot, {
      machine: { ...machine },
      clientId: 'next',
      webOrigin: 'http://127.0.0.1:5173',
    })
  const connected = await runRemoteScript(remoteRoot, source)
  expect(connected.exitCode, connected.stderr).toBe(0)
  const adopted = await parseRemoteRecord(connected.stdout)
  expect(adopted).toMatchObject({ kind: 'managed', pid: record.pid, processId: record.processId })
  const stopped = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, 'next', adopted))
  expect(stopped.exitCode, stopped.stderr).toBe(0)
  await child.exited
  expect(child.signalCode).not.toBeNull()
})

async function checkStop(remoteRoot: string, kind: 'external' | 'managed') {
  const descriptor = await parseDescriptor(descriptorValue)
  const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const record = {
    leaseId: clientId,
    processId: kind === 'managed' ? clientId : null,
    kind,
    pid: kind === 'managed' ? child.pid : null,
    port: 31001,
    environmentId: descriptor.environmentId,
    startedAt:
      kind === 'managed'
        ? Bun.spawnSync(['ps', '-p', String(child.pid), '-o', 'lstart='])
            .stdout.toString()
            .trim()
        : null,
  }
  const recordPath = path.join(remoteRoot, '.platform-ssh-launch', `${clientId}.json`)
  await writeRemoteRecord(remoteRoot, clientId, record)
  try {
    const stop = Bun.spawn(
      [
        'sh',
        '-c',
        stopCommand(
          {
            installation: sourceInstallation(remoteRoot),
            clientId,
          },
          record,
        ),
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stderr = await new Response(stop.stderr).text()
    expect(await stop.exited, stderr).toBe(0)
    expect(await Bun.file(recordPath).exists()).toBe(false)
    expect(child.signalCode === null).toBe(kind === 'external')
  } finally {
    child.kill()
    await child.exited
  }
}

test('stop refuses a record replaced by another launch', async ({ remoteRoot }) => {
  const descriptor = await parseDescriptor(descriptorValue)
  const record = {
    leaseId: clientId,
    processId: null,
    kind: 'external' as const,
    pid: null,
    port: 31001,
    environmentId: descriptor.environmentId,
    startedAt: null,
  }
  const recordPath = path.join(remoteRoot, '.platform-ssh-launch', `${clientId}.json`)
  await mkdir(path.dirname(recordPath), { recursive: true })
  await writeFile(
    recordPath,
    JSON.stringify({ ...record, port: 31002, leaseId: crypto.randomUUID() }),
  )
  const stop = Bun.spawn(
    [
      'sh',
      '-c',
      stopCommand(
        {
          installation: sourceInstallation(remoteRoot),
          clientId,
        },
        record,
      ),
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  expect(await stop.exited).not.toBe(0)
  expect(await new Response(stop.stderr).text()).toContain('refusing to stop another process')
  expect(JSON.parse(await readFile(recordPath, 'utf8')).port).toBe(31002)
})

test('a stale PID record cannot stop an unrelated live process', async ({ remoteRoot }) => {
  const descriptor = await parseDescriptor(descriptorValue)
  const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
    stdout: 'ignore',
    stderr: 'ignore',
  })
  const record = {
    leaseId: clientId,
    processId: clientId,
    kind: 'managed' as const,
    pid: child.pid,
    port: 31001,
    environmentId: descriptor.environmentId,
    startedAt: 'a different process start time',
  }
  const recordPath = path.join(remoteRoot, '.platform-ssh-launch', `${clientId}.json`)
  try {
    await writeRemoteRecord(remoteRoot, clientId, record)
    const stop = Bun.spawn(
      [
        'sh',
        '-c',
        stopCommand(
          {
            installation: sourceInstallation(remoteRoot),
            clientId,
          },
          record,
        ),
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await stop.exited).not.toBe(0)
    expect(await new Response(stop.stderr).text()).toContain('PID was reused')
    expect(child.signalCode).toBeNull()
    expect(await Bun.file(recordPath).exists()).toBe(true)
  } finally {
    child.kill()
    await child.exited
  }
})

test('a remote catalog error reads as its sentence, not its JSON envelope', () => {
  const stderr = `${JSON.stringify({
    code: 'machines.SSH_REMOTE',
    message: 'The recorded managed server is still running but its health endpoint is unavailable.',
  })}\n`
  const error = remoteFailure('launch', stderr, 1)
  expect(error.message).toBe(
    'The remote server could not start. The recorded managed server is still running but its health endpoint is unavailable.',
  )
  expect(remoteFailure('probe', 'ssh: connect to host mac port 22: timed out\n', 255).message).toBe(
    'The SSH machine could not be reached. ssh: connect to host mac port 22: timed out',
  )
})

const expected = ORCHESTRATION_WS_PROTOCOL_VERSION
const webOrigin = 'http://127.0.0.1:5173'

test('a stale managed server is replaced when the checkout already matches', async ({
  remoteRoot,
}) => {
  await linkCheckoutProtocol(remoteRoot)
  await writeCheckoutServer(remoteRoot, expected)
  const stale = await servingRemoteProcess(remoteRoot, clientId, expected - 1)
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  expect(launched.exitCode, launched.stderr).toBe(0)
  const record = await parseRemoteRecord(launched.stdout)
  stopLaunchedServer(record.pid!)
  await stale.child.exited
  expect(record).toMatchObject({ kind: 'managed', processId: stale.record.processId })
  expect(record.pid).not.toBe(stale.record.pid)
  expect(JSON.parse(launched.stdout).descriptor.protocolVersion).toBe(expected)
  const stopped = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, clientId, record))
  expect(stopped.exitCode, stopped.stderr).toBe(0)
})

test('a stale managed server with an older checkout is refused by the launch script', async ({
  remoteRoot,
}) => {
  await writeCheckoutProtocol(remoteRoot, expected - 1)
  const stale = await servingRemoteProcess(remoteRoot, clientId, expected - 1)
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error).toMatchObject({
    code: 'machines.SSH_PROTOCOL',
    message: `The remote server speaks protocol ${expected - 1}, and this Platform needs protocol ${expected}.`,
    fix: `Update the Platform checkout at ${await realpath(remoteRoot)} to this server’s version, run bun install there, then Retry.`,
  })
  expect(error.internal).toEqual({
    expected,
    running: expected - 1,
    installed: expected - 1,
    installation: 'source',
    kind: 'managed',
    otherLeases: 0,
  })
  expect(stale.child.exitCode).toBeNull()
})

test('a stale managed server another lease holds is refused and left running', async ({
  remoteRoot,
}) => {
  await writeCheckoutProtocol(remoteRoot, expected)
  const stale = await servingRemoteProcess(remoteRoot, clientId, expected - 1)
  await writeRemoteRecord(remoteRoot, 'other', { ...stale.record, leaseId: crypto.randomUUID() })
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error).toMatchObject({
    code: 'machines.SSH_PROTOCOL',
    fix: 'Disconnect the 1 other connection to that machine’s server, then Retry.',
  })
  expect(error.internal).toMatchObject({ installed: expected, otherLeases: 1 })
  expect(stale.child.exitCode).toBeNull()
})

test('a stale external server is refused and left running', async ({ remoteRoot }) => {
  await writeCheckoutProtocol(remoteRoot, expected)
  const external = await servingRemoteProcess(remoteRoot, 'unrelated', expected - 1)
  await unlink(path.join(remoteRoot, '.platform-ssh-launch/unrelated.json'))
  await unlink(
    path.join(remoteRoot, '.platform-ssh-launch', `${external.record.processId}.process`),
  )
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, {
      machine: { ...machine, remotePort: external.record.port },
      clientId,
      webOrigin,
    }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error).toMatchObject({
    code: 'machines.SSH_PROTOCOL',
    fix: `Restart the Platform server on remote port ${external.record.port} from a checkout at this server’s version, then Retry.`,
  })
  expect(error.internal).toMatchObject({ kind: 'external', running: expected - 1 })
  expect(external.child.exitCode).toBeNull()
})

test('a freshly launched server on another protocol is refused and stopped', async ({
  remoteRoot,
}) => {
  await writeCheckoutProtocol(remoteRoot, expected)
  await writeCheckoutServer(remoteRoot, expected + 1)
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error).toMatchObject({
    code: 'machines.SSH_PROTOCOL',
    fix: `Run bun install in ${await realpath(remoteRoot)} so the server’s dependencies match that checkout, then Retry.`,
  })
  expect(error.internal).toMatchObject({ running: expected + 1, installed: expected })
  const launchDirectory = path.join(remoteRoot, '.platform-ssh-launch')
  expect(await Bun.file(path.join(launchDirectory, `${clientId}.json`)).exists()).toBe(false)
  const [processFile] = (await readdir(launchDirectory)).filter((name) => name.endsWith('.process'))
  const { pid } = JSON.parse(await readFile(path.join(launchDirectory, processFile!), 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
})

test('an orphaned stale managed server is stopped and replaced by a fresh launch', async ({
  remoteRoot,
}) => {
  await linkCheckoutProtocol(remoteRoot)
  await writeCheckoutServer(remoteRoot, expected)
  const stale = await servingRemoteProcess(remoteRoot, 'other', expected - 1)
  await unlink(path.join(remoteRoot, '.platform-ssh-launch/other.json'))
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  expect(launched.exitCode, launched.stderr).toBe(0)
  const record = await parseRemoteRecord(launched.stdout)
  stopLaunchedServer(record.pid!)
  await stale.child.exited
  expect(record.pid).not.toBe(stale.record.pid)
  expect(record.processId).not.toBe(stale.record.processId)
  expect(JSON.parse(launched.stdout).descriptor.protocolVersion).toBe(expected)
  const staleFile = `.platform-ssh-launch/${stale.record.processId}.process`
  expect(await Bun.file(path.join(remoteRoot, staleFile)).exists()).toBe(false)
  const stopped = await runRemoteScript(remoteRoot, sourceStop(remoteRoot, clientId, record))
  expect(stopped.exitCode, stopped.stderr).toBe(0)
})

test('a stale managed server only another client holds is refused and left running', async ({
  remoteRoot,
}) => {
  await writeCheckoutProtocol(remoteRoot, expected)
  const stale = await servingRemoteProcess(remoteRoot, 'other', expected - 1)
  const launched = await runRemoteScript(
    remoteRoot,
    sourceLaunch(remoteRoot, { machine, clientId, webOrigin }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error).toMatchObject({
    code: 'machines.SSH_PROTOCOL',
    fix: 'Disconnect the 1 other connection to that machine’s server, then Retry.',
  })
  expect(error.internal).toMatchObject({ installed: expected, otherLeases: 1, kind: 'managed' })
  expect(stale.child.exitCode).toBeNull()
  const staleFile = `.platform-ssh-launch/${stale.record.processId}.process`
  expect(await Bun.file(path.join(remoteRoot, staleFile)).exists()).toBe(true)
})
