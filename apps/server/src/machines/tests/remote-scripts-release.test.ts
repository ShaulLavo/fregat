import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect } from 'vitest'
import { launchCommand, launchFailureFix, remoteLayout, stopCommand } from '../remote-scripts'
import { parseRemoteRecord, remoteFailure } from '../records'
import {
  clientId,
  machine,
  pointCurrent,
  releaseInstallation,
  runRemoteCommand,
  servingRemoteProcess,
  sourceInstallation,
  stopLaunchedServer,
  test,
  writeCrashingRelease,
  writeRelease,
} from '../../../test/factories/ssh'

const expected = ORCHESTRATION_WS_PROTOCOL_VERSION
const webOrigin = 'http://127.0.0.1:5173'

async function serverRootIn(remoteRoot: string) {
  const serverRoot = path.join(remoteRoot, '.platform/server')
  await mkdir(serverRoot, { recursive: true })
  return serverRoot
}

async function launch(serverRoot: string) {
  const installation = releaseInstallation(serverRoot)
  const launched = await runRemoteCommand(
    launchCommand({ machine, installation, clientId, webOrigin }),
  )
  expect(launched.exitCode, launched.stderr).toBe(0)
  const record = await parseRemoteRecord(launched.stdout)
  stopLaunchedServer(record.pid!)
  return { record, descriptor: JSON.parse(launched.stdout).descriptor }
}

test('each kind starts its own entry and keeps lease state outside any release', () => {
  const release = remoteLayout(releaseInstallation('/home/u/.platform/server'))
  expect(release).toMatchObject({
    workingDirectory: '/home/u/.platform/server',
    entry: ['/home/u/.platform/server/current/server/index.js'],
    env: { NODE_ENV: 'production' },
  })
  expect(release.imports).toContain('"/home/u/.platform/server/current/server/remote-support.js"')
  const source = remoteLayout(sourceInstallation('/home/u/platform'))
  expect(source).toMatchObject({
    workingDirectory: '/home/u/platform',
    entry: ['--env-file=.env', 'apps/server/src/index.ts'],
    env: {},
  })
  expect(source.imports).toContain('./packages/contracts/src/health.ts')
})

test('a release launches, survives a current swap, is reused and stops', async ({ remoteRoot }) => {
  const serverRoot = await serverRootIn(remoteRoot)
  await writeRelease(serverRoot, 'first', expected)
  await pointCurrent(serverRoot, 'first')
  const launched = await launch(serverRoot)
  expect(launched.record.kind).toBe('managed')
  expect(launched.descriptor.serverVersion).toBe('first')
  const launchState = await readdir(path.join(serverRoot, '.platform-ssh-launch'))
  expect(launchState).toContain(`${clientId}.json`)
  expect(launchState).toContain(`${launched.record.processId}.process`)
  expect(await Bun.file(path.join(serverRoot, 'logs/ssh-launch.log')).exists()).toBe(true)
  expect(await readdir(path.join(serverRoot, 'releases/first'))).toEqual(['server'])

  await writeRelease(serverRoot, 'second', expected)
  await pointCurrent(serverRoot, 'second')
  expect(await realpath(path.join(serverRoot, 'current'))).toBe(
    await realpath(path.join(serverRoot, 'releases/second')),
  )
  const reused = await launch(serverRoot)
  expect(reused.record).toEqual(launched.record)
  expect(reused.descriptor.serverVersion).toBe('first')

  const stopped = await runRemoteCommand(
    stopCommand({ installation: releaseInstallation(serverRoot), clientId }, reused.record),
  )
  expect(stopped.exitCode, stopped.stderr).toBe(0)
  expect(() => process.kill(launched.record.pid!, 0)).toThrow()
  expect(await readdir(path.join(serverRoot, '.platform-ssh-launch'))).not.toContain(
    `${clientId}.json`,
  )
})

test('a stale release server is replaced by the release current names', async ({ remoteRoot }) => {
  const serverRoot = await serverRootIn(remoteRoot)
  const stale = await servingRemoteProcess(serverRoot, clientId, expected - 1)
  await writeRelease(serverRoot, 'next', expected)
  await pointCurrent(serverRoot, 'next')
  const replaced = await launch(serverRoot)
  await stale.child.exited
  expect(replaced.record).toMatchObject({ kind: 'managed', processId: stale.record.processId })
  expect(replaced.record.pid).not.toBe(stale.record.pid)
  expect(replaced.descriptor).toMatchObject({ serverVersion: 'next', protocolVersion: expected })
  const stopped = await runRemoteCommand(
    stopCommand({ installation: releaseInstallation(serverRoot), clientId }, replaced.record),
  )
  expect(stopped.exitCode, stopped.stderr).toBe(0)
})

test('a stale release server is refused when current names a release on its protocol', async ({
  remoteRoot,
}) => {
  const serverRoot = await serverRootIn(remoteRoot)
  const stale = await servingRemoteProcess(serverRoot, clientId, expected - 1)
  await writeRelease(serverRoot, 'old', expected - 1, expected - 1)
  await pointCurrent(serverRoot, 'old')
  const installation = releaseInstallation(serverRoot)
  const launched = await runRemoteCommand(
    launchCommand({ machine, installation, clientId, webOrigin }),
  )
  const error = remoteFailure('launch', launched.stderr, launched.exitCode)
  expect(error.code).toBe('machines.SSH_PROTOCOL')
  expect(error.fix).toBe('Install this server’s release on that machine, then Retry.')
  expect(error.internal).toEqual({
    expected,
    running: expected - 1,
    installed: expected - 1,
    installation: 'release',
    kind: 'managed',
    otherLeases: 0,
  })
  expect(stale.child.exitCode).toBeNull()
})

test('a failed release launch names the log it wrote', async ({ remoteRoot }) => {
  const serverRoot = await serverRootIn(remoteRoot)
  await writeCrashingRelease(serverRoot, 'broken')
  await pointCurrent(serverRoot, 'broken')
  const installation = releaseInstallation(serverRoot)
  const launched = await runRemoteCommand(
    launchCommand({ machine, installation, clientId, webOrigin }),
  )
  const fix = launchFailureFix(installation)
  const error = remoteFailure('launch', launched.stderr, launched.exitCode, fix)
  expect(error.code).toBe('machines.SSH_LAUNCH')
  expect(error.fix).toBe(fix)
  const log = /^Inspect (\S+) on that machine/.exec(fix)?.[1]
  expect(log).toBe(path.join(serverRoot, 'logs/ssh-launch.log'))
  expect((await stat(log!)).isFile()).toBe(true)
  expect(await readdir(path.join(serverRoot, '.platform-ssh-launch'))).not.toContain(
    `${clientId}.json`,
  )
})
