import { readFile, readlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { expect, test } from 'vitest'
import { installServerLauncher } from '../../installation/install'
import { releaseSource } from '../update'
import {
  localSsh,
  remotePath,
  shippableRelease,
  updateFixture,
  updateLauncher,
} from '../../../test/factories/remote-server-update'
import { pointCurrent, releaseInstallation, writeRelease } from '../../../test/factories/ssh'

const expected = ORCHESTRATION_WS_PROTOCOL_VERSION
const updateFix =
  'Select Update server to install this server’s release on that machine and reconnect.'

/** A machine whose installed release speaks the previous protocol. */
async function outdatedMachine() {
  const fixture = await updateFixture()
  await writeRelease(fixture.serverRoot, 'old', expected - 1, expected - 1)
  await pointCurrent(fixture.serverRoot, 'old')
  await installServerLauncher({
    homeDirectory: fixture.home,
    installation: releaseInstallation(fixture.serverRoot),
  })
  return fixture
}

function updateEvent(events: ReturnType<typeof updateLauncher>['events']) {
  return events.find((event) => event.action === 'machines.server.update')?.fields
}

function probes(commands: readonly string[]) {
  return commands.filter((command) => command.includes('present=')).length
}

test('an outdated server is updated, restarted and reconnected live', async () => {
  const { home, local } = await outdatedMachine()
  const ssh = localSsh({ home })
  const { launcher, events } = updateLauncher(ssh, await shippableRelease(local, 'new'))

  expect(await launcher.connectMachine('fixture')).toMatchObject({
    phase: 'blocked',
    lastError: { code: 'machines.SSH_PROTOCOL', fix: updateFix, action: 'update' },
  })
  const updated = await launcher.updateMachine('fixture')
  expect(updated).toMatchObject({
    phase: 'live',
    descriptor: { serverVersion: 'new', protocolVersion: expected },
  })
  expect(updateEvent(events)).toMatchObject({
    machine: 'fixture',
    target: 'fixture',
    fromRelease: 'old',
    toRelease: 'new',
    bunVersion: Bun.version,
    runtimeReused: false,
    outcome: 'success',
    steps: {
      source: expect.any(Number),
      probe: expect.any(Number),
      transfer: expect.any(Number),
      runtime: expect.any(Number),
      swap: expect.any(Number),
      restart: expect.any(Number),
      connect: expect.any(Number),
    },
  })
  expect(updateEvent(events)?.bytesSent).toBeGreaterThan(0)
  expect(updateEvent(events)?.platform).toMatch(/\S+ \S+/)
})

test('a machine without a server is installed from this server’s release', async () => {
  const { home, local } = await updateFixture()
  const ssh = localSsh({ home })
  const { launcher } = updateLauncher(ssh, await shippableRelease(local, 'first'))
  expect(await launcher.connectMachine('fixture')).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_NOT_INSTALLED',
      fix: 'Select Install server to put this server’s release on that machine.',
      action: 'install',
    },
  })
  expect(await launcher.updateMachine('fixture')).toMatchObject({
    phase: 'live',
    descriptor: { serverVersion: 'first' },
  })
})

test('a live machine is moved to the new release by an update', async () => {
  const { home, local } = await updateFixture()
  const ssh = localSsh({ home })
  const first = updateLauncher(ssh, await shippableRelease(local, 'first'))
  expect((await first.launcher.updateMachine('fixture')).phase).toBe('live')
  await first.launcher.close()
  const second = updateLauncher(ssh, await shippableRelease(local, 'second'))
  expect(await second.launcher.connectMachine('fixture')).toMatchObject({
    descriptor: { serverVersion: 'first' },
  })
  expect(await second.launcher.updateMachine('fixture')).toMatchObject({
    phase: 'live',
    descriptor: { serverVersion: 'second' },
  })
})

test('a newer server is offered no update, and an update request is refused', async () => {
  const fixture = await updateFixture()
  await writeRelease(fixture.serverRoot, 'newer', expected + 1, expected + 1)
  await pointCurrent(fixture.serverRoot, 'newer')
  await installServerLauncher({
    homeDirectory: fixture.home,
    installation: releaseInstallation(fixture.serverRoot),
  })
  const ssh = localSsh({ home: fixture.home })
  const { launcher } = updateLauncher(ssh, await shippableRelease(fixture.local, 'new'))
  const blocked = await launcher.connectMachine('fixture')
  expect(blocked).toMatchObject({ phase: 'blocked', lastError: { code: 'machines.SSH_PROTOCOL' } })
  expect(blocked).not.toHaveProperty('lastError.action')
  await expect(launcher.updateMachine('fixture')).rejects.toMatchObject({
    code: 'machines.SSH_UPDATE_REFUSED',
  })
  expect(await readlink(path.join(fixture.serverRoot, 'current'))).toContain('newer')
})

test('concurrent updates and a connect during one join a single update', async () => {
  const { home, local } = await outdatedMachine()
  const ssh = localSsh({ home })
  const { launcher, events } = updateLauncher(ssh, await shippableRelease(local, 'new'))
  const [first, second, connect] = await Promise.all([
    launcher.updateMachine('fixture'),
    launcher.updateMachine('fixture'),
    launcher.connectMachine('fixture'),
  ])
  expect(first.phase).toBe('live')
  expect(second).toBe(first)
  expect(connect).toBe(first)
  expect(probes(ssh.commands)).toBe(2)
  expect(events.filter((event) => event.action === 'machines.server.update')).toHaveLength(1)
})

test('a refusal is published with its catalog code and the event records it', async () => {
  const { home, local } = await outdatedMachine()
  const ssh = localSsh({ home, path: remotePath(home, false) })
  const { launcher, events } = updateLauncher(ssh, await shippableRelease(local, 'new'))
  expect(await launcher.updateMachine('fixture')).toMatchObject({
    phase: 'blocked',
    lastError: { code: 'machines.SSH_UPDATE_NO_BUN' },
  })
  expect(launcher.stateFor('fixture')).toMatchObject({ phase: 'blocked' })
  expect(updateEvent(events)).toMatchObject({
    step: 'probe',
    outcome: 'failed',
    errorCode: 'machines.SSH_UPDATE_NO_BUN',
    fromRelease: 'old',
  })
})

test('a server running from source looks for its own dev channel and offers to build its tree', async () => {
  const { home } = await outdatedMachine()
  const ssh = localSsh({ home })
  const { launcher } = updateLauncher(ssh, releaseSource(import.meta.dirname))
  const blocked = await launcher.connectMachine('fixture')
  expect(blocked).toMatchObject({
    lastError: {
      code: 'machines.SSH_NOT_INSTALLED',
      fix: 'Select Install server to build this working tree and put it on that machine.',
    },
  })
  expect(ssh.commands.some((command) => command.includes('platform-server-dev --describe'))).toBe(
    true,
  )
})

test('an update resolves the machine from settings and rejects an unknown name', async () => {
  const { home, local } = await updateFixture()
  const ssh = localSsh({ home })
  const { launcher } = updateLauncher(ssh, await shippableRelease(local, 'first'))
  await expect(launcher.updateMachine('elsewhere')).rejects.toMatchObject({
    code: 'machines.SSH_SETTINGS',
  })
  await expect(launcher.updateMachine('../fixture')).rejects.toMatchObject({
    code: 'machines.SSH_SETTINGS',
  })
  expect(ssh.commands).toEqual([])
  expect(launcher.listStates()).toEqual([])
})

test('another client holding the previous release defers activation explicitly', async () => {
  const { home, local } = await updateFixture()
  const first = updateLauncher(localSsh({ home }), await shippableRelease(local, 'first'))
  expect((await first.launcher.updateMachine('fixture')).phase).toBe('live')
  const second = updateLauncher(
    localSsh({ home }),
    await shippableRelease(local, 'second'),
    undefined,
    '00000000-0000-4000-8000-000000000002',
  )
  const result = await second.launcher.updateMachine('fixture')
  expect(result).toMatchObject({
    phase: 'blocked',
    lastError: { code: 'machines.SSH_UPDATE_IN_USE' },
  })
  expect(updateEvent(second.events)).toMatchObject({ outcome: 'failed' })
})

test('a candidate that fails only on activation restores a working connection to the prior release', async () => {
  const { home, local, serverRoot } = await updateFixture()
  const ssh = localSsh({ home })
  const first = updateLauncher(ssh, await shippableRelease(local, 'first'))
  expect((await first.launcher.updateMachine('fixture')).phase).toBe('live')
  await first.launcher.close()
  const candidate = await shippableRelease(local, 'second')
  const entry = path.join(local, 'releases/second/server/index.js')
  await writeFile(
    entry,
    `if (!process.env.PLATFORM_HOME?.includes('.candidate-')) process.exit(3);\n${await readFile(entry, 'utf8')}`,
  )
  const second = updateLauncher(ssh, candidate)
  expect((await second.launcher.connectMachine('fixture')).phase).toBe('live')
  expect((await second.launcher.updateMachine('fixture')).phase).toBe('blocked')
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/first')
  expect(await second.launcher.connectMachine('fixture')).toMatchObject({
    phase: 'live',
    descriptor: { release: 'first' },
  })
})
