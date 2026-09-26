import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { expect, onTestFinished } from 'vitest'
import {
  clientId,
  descriptorValue,
  fakeSsh,
  machine,
  noRelease,
  releaseInstallation,
  sourceInstallation,
  test,
} from '../../../test/factories/ssh'
import { createSshLauncher } from '../launcher'
import { openForward } from '../forward'

test('launches, forwards, confirms identity and stops its managed record in order', async () => {
  const fixture = await fakeSsh()
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result).toMatchObject({
    name: 'fixture',
    phase: 'live',
    localPort: 51078,
    origin: 'http://127.0.0.1:51078',
    descriptor: descriptorValue,
  })
  expect(fixture.launcher.stateFor('fixture')).toEqual(result)
  expect(fixture.launcher.listStates()).toEqual([result])
  expect(fixture.phases.map((state) => state.phase)).toEqual(['launching', 'connecting', 'live'])
  expect(fixture.commands).toHaveLength(3)
  expect(fixture.commands[0]?.at(-1)).toContain('command -v platform-server')
  expect(fixture.commands[1]?.at(-1)).toContain('await withLeaseLock(launch);')
  expect(fixture.commands[2]).toContain('127.0.0.1:51078:127.0.0.1:31001')
  expect(
    fixture.commands.every(
      (command) =>
        command.includes('BatchMode=yes') && command.includes('StrictHostKeyChecking=yes'),
    ),
  ).toBe(true)
  await fixture.launcher.disconnectMachine('fixture')
  expect(fixture.forwardChildren[0]?.signalCode).not.toBeNull()
  expect(fixture.commands[3]?.at(-1)).toContain('await withLeaseLock(stop);')
  expect(fixture.events.map((event) => event.action)).toEqual([
    'machines.ssh.connect',
    'machines.ssh.disconnect',
  ])
  expect(fixture.events[0]?.fields).toMatchObject({
    machine: 'fixture',
    target: 'fixture',
    step: 'identity',
    outcome: 'success',
    managed: true,
  })
  expect(fixture.phases.at(-1)?.phase).toBe('idle')
  expect(fixture.launcher.stateFor('fixture')).toEqual({ name: 'fixture', phase: 'idle' })
  expect(fixture.launcher.listStates()).toEqual([])
})

test('reuses one connection for concurrent requests and retains its local endpoint on reconnect', async () => {
  const fixture = await fakeSsh({ kind: 'external' })
  const [first, same] = await Promise.all([
    fixture.launcher.connectMachine('fixture'),
    fixture.launcher.connectMachine('fixture'),
  ])
  expect(first).toEqual(same)
  expect(fixture.commands).toHaveLength(3)
  await fixture.launcher.disconnectMachine('fixture')
  await fixture.launcher.connectMachine('fixture')
  expect(fixture.requestedPorts).toEqual([undefined, 51078])
  expect(fixture.events[0]?.fields.managed).toBe(false)
})

test('refuses changed identities and closes the newly opened forward', async () => {
  const fixture = await fakeSsh()
  await fixture.launcher.connectMachine('fixture')
  await fixture.launcher.disconnectMachine('fixture')
  fixture.changeHealth({
    ...descriptorValue,
    environmentId: '00000000-0000-4000-8000-000000000079',
  })
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result.phase).toBe('identity-drift')
  expect(fixture.forwardChildren.at(-1)?.signalCode).not.toBeNull()
  expect(fixture.events.at(-1)?.fields).toMatchObject({ step: 'identity', outcome: 'failed' })
})

test('reports SSH refusal without attempting a remote launch or cleanup', async () => {
  const fixture = await fakeSsh({ probeFails: true })
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_PROBE',
      message: expect.stringContaining('Permission denied'),
      why: expect.any(String),
      fix: expect.any(String),
    },
  })
  expect(fixture.commands).toHaveLength(1)
})

test('publishes loss of an established forward without affecting the launcher process', async () => {
  const fixture = await fakeSsh()
  await fixture.launcher.connectMachine('fixture')
  fixture.forwardChildren[0]?.kill()
  await expect.poll(() => fixture.phases.at(-1)?.phase).toBe('offline')
  expect(fixture.events.at(-1)?.action).toBe('machines.ssh.forward.exited')
  const retried = await fixture.launcher.connectMachine('fixture')
  expect(retried.phase).toBe('live')
  expect(
    fixture.commands.filter((command) => command.at(-1)?.includes('await withLeaseLock(stop);')),
  ).toHaveLength(0)
  expect(fixture.requestedPorts).toEqual([undefined, 51078])
})

test('releases a failed forwarding handle before publishing offline for a retry', async () => {
  const fixture = await fakeSsh()
  const cleanup = Promise.withResolvers<void>()
  let cleaning = false
  const launcher = createSshLauncher({
    clientId,
    webOrigin: 'http://localhost:5173',
    readMachines: async () => ({ fixture: machine }),
    spawn: fixture.spawn,
    fetcher: fixture.fetcher,
    localPort: fixture.localPort,
    releaseSource: noRelease,
    publish: () => {},
    forward: async (options) => {
      const forward = await openForward(options)
      return {
        child: forward.child,
        close: async () => {
          cleaning = true
          await cleanup.promise
          await forward.close()
        },
      }
    },
  })
  onTestFinished(async () => {
    cleanup.resolve()
    await launcher.close()
  })
  expect((await launcher.connectMachine('fixture')).phase).toBe('live')
  fixture.forwardChildren[0]?.kill()
  await expect.poll(() => cleaning).toBe(true)
  expect(launcher.stateFor('fixture').phase).toBe('live')
  cleanup.resolve()
  await expect.poll(() => launcher.stateFor('fixture').phase).toBe('offline')
  expect((await launcher.connectMachine('fixture')).phase).toBe('live')
})

test('relaunches a crashed managed server while its SSH forward is still alive', async () => {
  const fixture = await fakeSsh()
  await fixture.launcher.connectMachine('fixture')
  const previousForward = fixture.forwardChildren[0]
  fixture.crashServer()
  const retried = await fixture.launcher.connectMachine('fixture')
  expect(retried.phase).toBe('live')
  expect(previousForward?.signalCode).not.toBeNull()
  expect(
    fixture.commands.filter((command) => command.at(-1)?.includes('await withLeaseLock(launch);')),
  ).toHaveLength(2)
  expect(fixture.requestedPorts).toEqual([undefined, 51078])
  expect(
    fixture.commands.filter((command) => command.at(-1)?.includes('await withLeaseLock(stop);')),
  ).toHaveLength(0)
})

test('a healthy forwarded server survives a chat connection retry', async () => {
  const fixture = await fakeSsh()
  await fixture.launcher.connectMachine('fixture')
  const previousForward = fixture.forwardChildren[0]
  const retried = await fixture.launcher.connectMachine('fixture')
  expect(retried.phase).toBe('live')
  expect(previousForward?.signalCode).toBeNull()
  expect(fixture.commands).toHaveLength(3)
})

test('disconnect cancels a pending connect before it can publish live', async () => {
  const fixture = await fakeSsh({ slowProbe: true })
  const connect = fixture.launcher.connectMachine('fixture')
  await expect.poll(() => fixture.phases.length).toBeGreaterThan(0)
  await fixture.launcher.disconnectMachine('fixture')
  await connect
  expect(fixture.phases.at(-1)?.phase).toBe('idle')
  expect(fixture.phases.some((state) => state.phase === 'live')).toBe(false)
})

test('rejects invalid machine names before spawning any process', async () => {
  const fixture = await fakeSsh()
  await expect(fixture.launcher.connectMachine('-oProxyCommand=bad')).rejects.toMatchObject({
    code: 'machines.SSH_SETTINGS',
  })
  expect(fixture.commands).toHaveLength(0)
})

test('machine aliases use separate stable launch records and clean up independently', async () => {
  const fixture = await fakeSsh({ machines: { fixture: machine, alias: machine } })
  await Promise.all([
    fixture.launcher.connectMachine('fixture'),
    fixture.launcher.connectMachine('alias'),
  ])
  const launches = fixture.commands.filter((command) =>
    command.at(-1)?.includes('await withLeaseLock(launch);'),
  )
  expect(launches.some((command) => command.at(-1)?.includes(`${clientId}-fixture`))).toBe(true)
  expect(launches.some((command) => command.at(-1)?.includes(`${clientId}-alias`))).toBe(true)
  await fixture.launcher.disconnectMachine('fixture')
  const stop = fixture.commands.at(-1)?.at(-1)
  expect(stop).toContain(`${clientId}-fixture`)
  expect(stop).not.toContain(`${clientId}-alias`)
  expect(fixture.phases.filter((state) => state.name === 'alias').at(-1)?.phase).toBe('live')
})

test('a server on another protocol blocks the connection at the protocol step', async () => {
  const running = ORCHESTRATION_WS_PROTOCOL_VERSION - 1
  const fixture = await fakeSsh({ descriptor: { ...descriptorValue, protocolVersion: running } })
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_PROTOCOL',
      message: `The remote server speaks protocol ${running}, and this Platform needs protocol ${ORCHESTRATION_WS_PROTOCOL_VERSION}.`,
      fix: expect.stringContaining("/work/space ' $(touch unwanted)"),
    },
  })
  expect(fixture.events.at(-1)).toMatchObject({
    action: 'machines.ssh.connect',
    fields: {
      step: 'protocol',
      outcome: 'failed',
      errorCode: 'machines.SSH_PROTOCOL',
      errorInternal: { expected: ORCHESTRATION_WS_PROTOCOL_VERSION, running, kind: 'managed' },
    },
  })
  expect(fixture.forwardChildren[0]?.signalCode).not.toBeNull()
})

test('a live connection whose server changes protocol is blocked on the next connect', async () => {
  const fixture = await fakeSsh()
  expect((await fixture.launcher.connectMachine('fixture')).phase).toBe('live')
  fixture.changeHealth({
    ...descriptorValue,
    protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION + 1,
  })
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_PROTOCOL',
      fix: 'Update this Platform server to the version on that machine, then Retry.',
    },
  })
  expect(fixture.events.at(-1)?.fields).toMatchObject({ step: 'protocol', outcome: 'failed' })
})

const expectedProtocol = ORCHESTRATION_WS_PROTOCOL_VERSION
const remoteDirectory = "/work/space ' $(touch unwanted)"

test.for([
  {
    name: 'an older checkout',
    report: {
      installation: 'source',
      installed: expectedProtocol - 1,
      kind: 'managed',
      otherLeases: 0,
    },
    fix: `Update the Platform checkout at ${remoteDirectory} to this server’s version, run bun install there, then Retry.`,
  },
  {
    name: 'another lease',
    report: {
      installation: 'source',
      installed: expectedProtocol,
      kind: 'managed',
      otherLeases: 1,
    },
    fix: 'Disconnect the 1 other connection to that machine’s server, then Retry.',
  },
  {
    name: 'an external server',
    report: {
      installation: 'source',
      installed: expectedProtocol,
      kind: 'external',
      otherLeases: 0,
    },
    fix: 'Restart the Platform server on remote port 31001 from a checkout at this server’s version, then Retry.',
  },
  {
    name: 'an external server on a release machine',
    report: {
      installation: 'release',
      installed: expectedProtocol,
      kind: 'external',
      otherLeases: 0,
    },
    fix: 'Restart the Platform server on remote port 31001 from this server’s release, then Retry.',
  },
] as const)(
  'a launch script refusing $name blocks at the protocol step and releases the lease',
  async ({ report, fix }) => {
    const running = expectedProtocol - 1
    const fixture = await fakeSsh({
      launchFailure: {
        code: 'machines.SSH_PROTOCOL',
        message: `The remote server speaks protocol ${running}, and this Platform needs protocol ${expectedProtocol}.`,
        expected: expectedProtocol,
        running,
        port: 31001,
        directory: remoteDirectory,
        ...report,
      },
    })
    const result = await fixture.launcher.connectMachine('fixture')
    expect(result).toMatchObject({
      phase: 'blocked',
      lastError: {
        code: 'machines.SSH_PROTOCOL',
        message: `The remote server speaks protocol ${running}, and this Platform needs protocol ${expectedProtocol}.`,
        fix,
      },
    })
    expect(fixture.events.at(-1)).toMatchObject({
      action: 'machines.ssh.connect',
      fields: {
        step: 'protocol',
        outcome: 'failed',
        errorCode: 'machines.SSH_PROTOCOL',
        errorInternal: { expected: expectedProtocol, running, ...report },
      },
    })
    const remote = fixture.commands.map((command) => command.at(-1) ?? '')
    expect(remote).toHaveLength(3)
    expect(remote[1]).toContain('await withLeaseLock(launch);')
    expect(remote[2]).toContain('await withLeaseLock(stop);')
    expect(fixture.forwardChildren).toHaveLength(0)
  },
)

test('a release installation launches its own support bundle and the connect event names it', async () => {
  const installation = releaseInstallation('/home/remote/.platform/server')
  const fixture = await fakeSsh({ installation })
  expect((await fixture.launcher.connectMachine('fixture')).phase).toBe('live')
  const launch = fixture.commands[1]?.at(-1) ?? ''
  expect(launch).toContain('/home/remote/.platform/server/current/server/remote-support.js')
  expect(fixture.events[0]).toMatchObject({
    action: 'machines.ssh.connect',
    fields: {
      outcome: 'success',
      installationKind: 'release',
      installationDirectory: installation.directory,
      serverVersion: descriptorValue.serverVersion,
    },
  })
})

test('a release server on another protocol names the release fix', async () => {
  const fixture = await fakeSsh({
    installation: releaseInstallation('/home/remote/.platform/server'),
    descriptor: { ...descriptorValue, protocolVersion: expectedProtocol - 1 },
  })
  const result = await fixture.launcher.connectMachine('fixture')
  expect(result).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_PROTOCOL',
      fix: 'Install this server’s release on that machine, then Retry.',
    },
  })
  expect(fixture.events.at(-1)?.fields).toMatchObject({
    step: 'protocol',
    installationKind: 'release',
    errorInternal: { installation: 'release', installed: null },
  })
})

test.for([
  {
    kind: 'source',
    installation: sourceInstallation('/home/remote/platform'),
    log: '/home/remote/platform/logs/ssh-launch.log',
  },
  {
    kind: 'release',
    installation: releaseInstallation('/home/remote/.platform/server'),
    log: '/home/remote/.platform/server/logs/ssh-launch.log',
  },
] as const)(
  'a failed $kind launch names the log the launch wrote',
  async ({ installation, log }) => {
    const fixture = await fakeSsh({
      installation,
      launchFailure: {
        code: 'machines.SSH_REMOTE',
        message: 'The remote server did not become ready within 30 seconds.',
      },
    })
    const result = await fixture.launcher.connectMachine('fixture')
    expect(result).toMatchObject({
      lastError: {
        code: 'machines.SSH_LAUNCH',
        fix: `Inspect ${log} on that machine and verify its dependencies are installed, then Retry.`,
      },
    })
  },
)
