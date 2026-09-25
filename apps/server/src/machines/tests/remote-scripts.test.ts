import { shellQuote } from '../../utils/shell'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { launchScript, stopCommand, stopScript } from '../remote-scripts'
import { parseDescriptor, parseRemoteRecord, remoteFailure } from '../records'
import {
  clientId,
  descriptorValue,
  machine,
  test,
  recordedRemoteProcess,
  runRemoteScript,
  remoteHealthResponse,
  writeRemoteRecord,
} from '../../../test/factories/ssh'

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
  const source = launchScript({
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
          launchScript({
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
  const first = await runRemoteScript(remoteRoot, stopScript('first', record))
  expect(first.exitCode, first.stderr).toBe(0)
  expect(child.signalCode).toBeNull()
  const remaining = await Promise.all(
    ['second', 'third'].map(async (owner, index) =>
      runRemoteScript(
        remoteRoot,
        stopScript(owner, await parseRemoteRecord(aliases[index]!.stdout)),
      ),
    ),
  )
  for (const stopped of remaining) expect(stopped.exitCode, stopped.stderr).toBe(0)
  await child.exited
  expect(child.signalCode).not.toBeNull()
  const repeated = await runRemoteScript(remoteRoot, stopScript('third', record))
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
    remoteHealthResponse() + launchScript(options),
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
    remoteHealthResponse() + launchScript({ ...options, clientId: 'first' }),
  )
  expect(restarted.exitCode, restarted.stderr).toBe(0)
  const first = await runRemoteScript(remoteRoot, stopScript('first', original.record))
  expect(first.exitCode, first.stderr).toBe(0)
  const other = await runRemoteScript(remoteRoot, stopScript('replacement', replacement.record))
  expect(other.exitCode, other.stderr).toBe(0)
  expect(replacement.child.signalCode).toBeNull()
  const final = await runRemoteScript(remoteRoot, stopScript('second', retainedAlias))
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
    launchScript({
      machine: { ...machine },
      clientId: 'next',
      webOrigin: 'http://127.0.0.1:5173',
    })
  const connected = await runRemoteScript(remoteRoot, source)
  expect(connected.exitCode, connected.stderr).toBe(0)
  const adopted = await parseRemoteRecord(connected.stdout)
  expect(adopted).toMatchObject({ kind: 'managed', pid: record.pid, processId: record.processId })
  const stopped = await runRemoteScript(remoteRoot, stopScript('next', adopted))
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
            installation: { kind: 'source', directory: remoteRoot, executable: process.execPath },
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
          installation: { kind: 'source', directory: remoteRoot, executable: process.execPath },
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
            installation: { kind: 'source', directory: remoteRoot, executable: process.execPath },
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
