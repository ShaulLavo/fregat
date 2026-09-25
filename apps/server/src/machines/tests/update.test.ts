import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'
import { launchCommand } from '../remote-scripts'
import { parseRemoteRecord } from '../records'
import {
  installRelease,
  releaseSource,
  swapScript,
  type ReleaseSupply,
  type UpdateEvent,
} from '../update'
import { releaseLauncherSource } from '../../installation/install'
import {
  localSsh,
  remotePath,
  shippableRelease,
  updateFixture,
} from '../../../test/factories/remote-server-update'
import {
  clientId,
  machine,
  releaseInstallation,
  runRemoteCommand,
  stopLaunchedServer,
} from '../../../test/factories/ssh'

function newEvent(): UpdateEvent {
  return { machine: 'fixture', step: 'source', steps: {}, bytesSent: 0, outcome: 'pending' }
}

async function install(home: string, supply: ReleaseSupply, pathValue?: string) {
  const ssh = localSsh({ home, path: pathValue })
  const event = newEvent()
  const remote = { spawn: ssh.spawn, target: 'fixture', signal: AbortSignal.timeout(60_000) }
  await installRelease(remote, supply, event)
  return { event }
}

async function runtimeInstalls(home: string) {
  const log = await readFile(path.join(home, 'runtime-installs.log'), 'utf8').catch(() => '')
  return log.split('\n').filter(Boolean).length
}

async function describeLauncher(home: string) {
  const described = await runRemoteCommand(
    `HOME=${JSON.stringify(home)} ${JSON.stringify(path.join(home, '.local/bin/platform-server'))} --describe`,
  )
  expect(described.exitCode, described.stderr).toBe(0)
  return JSON.parse(described.stdout)
}

test('a first install ships the release, installs its runtime and writes the release launcher', async () => {
  const { home, local, serverRoot } = await updateFixture()
  const supply = await shippableRelease(local, 'first')
  const { event } = await install(home, supply)

  expect(event).toMatchObject({
    toRelease: 'first',
    fromRelease: null,
    directory: serverRoot,
    bunVersion: Bun.version,
    runtimeReused: false,
    pruned: [],
  })
  expect(event.bytesSent).toBeGreaterThan(0)
  expect(Object.keys(event.steps)).toEqual(['source', 'probe', 'transfer', 'runtime', 'swap'])
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/first')
  const nodeModules = path.join(serverRoot, 'releases/first/server/node_modules')
  expect((await lstat(nodeModules)).isSymbolicLink()).toBe(true)
  const runtime = await readdir(path.join(serverRoot, 'runtime'))
  expect(runtime).toEqual([(await supply.prepare()).manifestSha])
  expect(await realpath(nodeModules)).toBe(
    await realpath(path.join(serverRoot, 'runtime', runtime[0]!, 'node_modules')),
  )
  expect(await runtimeInstalls(home)).toBe(1)
  expect(await describeLauncher(home)).toEqual({
    kind: 'release',
    directory: path.join(serverRoot, 'current'),
    executable: process.execPath,
  })
})

test('a second release reuses the runtime, keeps the one before it and prunes older ones', async () => {
  const { home, local, serverRoot } = await updateFixture()
  await install(home, await shippableRelease(local, 'first'))
  const second = await install(home, await shippableRelease(local, 'second'))
  expect(second.event).toMatchObject({
    fromRelease: 'first',
    toRelease: 'second',
    runtimeReused: true,
    pruned: [],
  })
  expect(await runtimeInstalls(home)).toBe(1)

  const third = await install(home, await shippableRelease(local, 'third'))
  expect(third.event).toMatchObject({
    fromRelease: 'second',
    runtimeReused: true,
    pruned: ['first'],
  })
  expect((await readdir(path.join(serverRoot, 'releases'))).toSorted()).toEqual(['second', 'third'])
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/third')
  expect(await runtimeInstalls(home)).toBe(1)
})

test('a release already on the machine is not sent again', async () => {
  const { home, local } = await updateFixture()
  const supply = await shippableRelease(local, 'first')
  await install(home, supply)
  const again = await install(home, supply)
  expect(again.event.bytesSent).toBe(0)
  expect(again.event.steps.transfer).toBeUndefined()
  expect(again.event.runtimeReused).toBe(true)
})

test('a manifest change installs a new runtime and prunes the one no kept release links', async () => {
  const { home, local, serverRoot } = await updateFixture()
  await install(home, await shippableRelease(local, 'first'))
  const changed = async (name: string) => {
    const supply = await shippableRelease(local, name)
    const manifest = path.join(local, 'releases', name, 'server/runtime/package.json')
    const next = { ...JSON.parse(await readFile(manifest, 'utf8')), description: 'changed' }
    await writeFile(manifest, JSON.stringify(next))
    return supply
  }
  const second = await changed('second')
  expect((await install(home, second)).event.runtimeReused).toBe(false)
  expect(await readdir(path.join(serverRoot, 'runtime'))).toHaveLength(2)
  expect((await install(home, await changed('third'))).event.runtimeReused).toBe(true)
  expect(await readdir(path.join(serverRoot, 'runtime'))).toEqual([
    (await second.prepare()).manifestSha,
  ])
  expect(await runtimeInstalls(home)).toBe(2)
})

test('a current swap interrupted halfway leaves the old release runnable', async () => {
  const { home, local, serverRoot } = await updateFixture()
  await install(home, await shippableRelease(local, 'first'))
  const next = await shippableRelease(local, 'second')
  const preload = path.join(local, 'crash-at-swap.ts')
  await writeFile(
    preload,
    `const fs = require('node:fs/promises');
const rename = fs.rename;
fs.rename = (from, to) => (to === 'current' ? process.exit(9) : rename(from, to));`,
  )
  const installation = releaseInstallation(serverRoot)
  const script = swapScript({
    name: 'second',
    launcher: path.join(home, '.local/bin/platform-server'),
    launcherSource: releaseLauncherSource(installation),
  })
  const interrupted = Bun.spawnSync({
    cmd: [process.execPath, '--preload', preload, '-e', script],
    cwd: serverRoot,
  })
  expect(interrupted.exitCode).toBe(9)
  expect((await readdir(serverRoot)).some((entry) => /^current\.\d+\.tmp$/.test(entry))).toBe(true)
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/first')

  const launched = await runRemoteCommand(
    launchCommand({ machine, installation, clientId, webOrigin: 'http://127.0.0.1:5173' }),
  )
  expect(launched.exitCode, launched.stderr).toBe(0)
  const record = await parseRemoteRecord(launched.stdout)
  stopLaunchedServer(record.pid!)
  expect(JSON.parse(launched.stdout).descriptor.serverVersion).toBe('first')

  await install(home, next)
  expect((await readdir(serverRoot)).some((entry) => /^current\.\d+\.tmp$/.test(entry))).toBe(false)
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/second')
})

test('bun in ~/.bun/bin is found when PATH has none', async () => {
  const { home, local } = await updateFixture()
  await mkdir(path.join(home, '.bun/bin'), { recursive: true })
  await symlink(process.execPath, path.join(home, '.bun/bin/bun'))
  const { event } = await install(
    home,
    await shippableRelease(local, 'first'),
    remotePath(home, false),
  )
  expect(event.bunVersion).toBe(Bun.version)
  expect((await describeLauncher(home)).executable).toBe(path.join(home, '.bun/bin/bun'))
})

test('a machine without bun is refused before anything is sent', async () => {
  const { home, local, serverRoot } = await updateFixture()
  const supply = await shippableRelease(local, 'first')
  const attempt = install(home, supply, remotePath(home, false))
  await expect(attempt).rejects.toMatchObject({
    code: 'machines.SSH_UPDATE_NO_BUN',
    fix: expect.stringContaining('curl -fsSL https://bun.sh/install | bash'),
  })
  await expect(readdir(serverRoot)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('a bun older than the repository’s is refused with bun upgrade', async () => {
  const { home, local } = await updateFixture()
  await mkdir(path.join(home, '.bun/bin'), { recursive: true })
  await writeFile(path.join(home, '.bun/bin/bun'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o755 })
  const attempt = install(home, await shippableRelease(local, 'first'), remotePath(home, false))
  await expect(attempt).rejects.toMatchObject({
    code: 'machines.SSH_UPDATE_OLD_BUN',
    message: expect.stringContaining('Bun 1.0.0'),
    fix: 'Run bun upgrade on that machine, then select Update server again.',
  })
})

test('a server running from source ships a build of its tree on the dev channel', async () => {
  let builds = 0
  const supply = releaseSource(import.meta.dirname, async () => {
    builds++
    await Bun.sleep(10)
    return { directory: '/built', name: 'dev-x', manifestSha: 'sha', origin: 'dev-build' }
  })
  expect(supply.channel).toBe('dev')
  expect(await supply.available()).toBe(true)
  const [first, second] = await Promise.all([supply.prepare(), supply.prepare()])
  expect(first).toBe(second)
  expect(builds).toBe(1)
})

test('a dev build installs beside production with its own launcher and state', async () => {
  const { home, local, serverRoot } = await updateFixture()
  await install(home, await shippableRelease(local, 'first'))
  const built = await shippableRelease(local, 'dev-20260925T000000Z-abcdef12-dirty')
  const devSupply: ReleaseSupply = { ...built, channel: 'dev' }
  const { event } = await install(home, devSupply)

  const devRoot = path.join(serverRoot, 'dev')
  expect(event).toMatchObject({ channel: 'dev', directory: devRoot, fromRelease: null })
  expect(await readlink(path.join(devRoot, 'current'))).toBe(
    'releases/dev-20260925T000000Z-abcdef12-dirty',
  )
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/first')
  expect(await describeLauncher(home)).toMatchObject({
    directory: path.join(serverRoot, 'current'),
  })
  const dev = await runRemoteCommand(
    `HOME=${JSON.stringify(home)} ${JSON.stringify(path.join(home, '.local/bin/platform-server-dev'))} --describe`,
  )
  expect(JSON.parse(dev.stdout)).toEqual({
    kind: 'release',
    directory: path.join(devRoot, 'current'),
    executable: process.execPath,
    stateHome: path.join(home, '.platform-dev'),
  })
  const source = await readFile(path.join(home, '.local/bin/platform-server-dev'), 'utf8')
  expect(source).toContain(`PLATFORM_HOME='${path.join(home, '.platform-dev')}'`)
})

test('a failing runtime install reports its log tail and keeps current', async () => {
  const { home, local, serverRoot } = await updateFixture()
  await install(home, await shippableRelease(local, 'first'))
  const broken = await shippableRelease(local, 'second')
  const manifest = path.join(local, 'releases/second/server/runtime/package.json')
  await writeFile(
    manifest,
    JSON.stringify({
      name: 'broken',
      scripts: { postinstall: 'echo nope-from-install >&2; exit 7' },
    }),
  )
  const attempt = install(home, broken)
  await expect(attempt).rejects.toMatchObject({
    code: 'machines.SSH_UPDATE_INSTALL',
    internal: { step: 'runtime', exitCode: 3, log: expect.stringContaining('nope-from-install') },
  })
  expect(await readlink(path.join(serverRoot, 'current'))).toBe('releases/first')
  const runtimes = await readdir(path.join(serverRoot, 'runtime'))
  expect(runtimes.filter((entry) => entry.includes('.partial'))).toEqual([])
})

// The production layout deploy writes: `pending` and `current` link releases/<name>, which holds
// web/, server/ (with a node_modules link), build-config.json and a root node_modules link.
test('a staged release ships itself, and its local links stay behind', async () => {
  const { home, local, serverRoot } = await updateFixture()
  const supply = await shippableRelease(local, '20260925T130447Z-fb16d1cc-lane-l5')
  const release = path.join(local, 'releases/20260925T130447Z-fb16d1cc-lane-l5')
  await mkdir(path.join(release, 'web'))
  await writeFile(path.join(release, 'build-config.json'), '{}')
  await symlink(path.join(release, 'server/node_modules'), path.join(release, 'node_modules'))
  await symlink(release, path.join(local, 'pending'))
  const staged = releaseSource(await realpath(path.join(local, 'pending/server')))
  expect(await staged.prepare()).toEqual(await supply.prepare())

  await install(home, staged)
  const shipped = path.join(serverRoot, 'releases/20260925T130447Z-fb16d1cc-lane-l5')
  expect(await readdir(shipped)).toEqual(['server'])
  expect(await realpath(path.join(shipped, 'server/node_modules'))).toContain(
    path.join(serverRoot, 'runtime'),
  )
})

test('a release deployed before releases carried a runtime manifest cannot be shipped', async () => {
  const { local } = await updateFixture()
  await shippableRelease(local, 'older')
  await rm(path.join(local, 'releases/older/server/runtime'), { recursive: true })
  const source = releaseSource(path.join(local, 'releases/older/server'))
  expect(await source.available()).toBe(false)
  await expect(source.prepare()).rejects.toMatchObject({
    code: 'machines.SSH_UPDATE_NOT_A_RELEASE',
    internal: { missing: ['runtime/package.json'] },
  })
})
