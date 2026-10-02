import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { installBundledRelease } from '../bundled-release'
import { cleanup, scratch, fregatServer, freePort, recordingHost } from './fixtures'
import { approveRestart } from '../../../apps/server/src/update/staged-release'
import { promote, checkReadiness } from '../../deploy/systemd/promote'

const commit = 'a'.repeat(40)
afterEach(cleanup)

function payload(root: string, name: string, revision = commit) {
  const source = path.join(root, name)
  for (const part of ['server/node_modules', 'node_modules', 'web'])
    mkdirSync(path.join(source, part), { recursive: true })
  writeFileSync(path.join(source, 'server/index.js'), '')
  writeFileSync(path.join(source, 'web/index.html'), 'bundled')
  writeFileSync(
    path.join(source, 'build-config.json'),
    JSON.stringify({ commit: revision, release: name, source: '/absent/checkout' }),
  )
  return source
}

function intent(root: string) {
  return { stateHome: root, address: 'http://127.0.0.1:3301', webBase: '/', expected: null }
}

test('missing current installs a complete bundled release under the supplied root', () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'Application Support', 'releases')
  const source = payload(root, 'bundle')
  const result = installBundledRelease(source, releaseRoot, intent(root))
  expect(result.disposition).toBe('installed')
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(result.release.directory)
  expect(result.release.directory.startsWith(path.join(releaseRoot, 'releases') + path.sep)).toBe(
    true,
  )
  expect(readFileSync(path.join(result.release.web, 'index.html'), 'utf8')).toBe('bundled')
  expect(existsSync(path.join(releaseRoot, 'pending'))).toBe(false)
})

test('same commit is a no-op, preserving the running release and pending timestamp', () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const source = payload(root, 'bundle')
  const first = installBundledRelease(source, releaseRoot, intent(root))
  const result = installBundledRelease(source, releaseRoot, intent(root))
  expect(result.disposition).toBe('unchanged')
  expect(result.release.directory).toBe(first.release.directory)
  expect(existsSync(path.join(releaseRoot, 'pending'))).toBe(false)
})

test('installed web documents identify the release the server reports', () => {
  const root = scratch()
  const source = payload(root, 'bundle')
  const document = '<html><head><meta name="platform-release" content="bundle"></head></html>'
  for (const name of ['index.html', 'dev.html'])
    writeFileSync(path.join(source, 'web', name), document)
  const installed = installBundledRelease(source, path.join(root, 'installed'), intent(root))
  const config = JSON.parse(
    readFileSync(path.join(installed.release.directory, 'build-config.json'), 'utf8'),
  )
  for (const name of ['index.html', 'dev.html']) {
    const html = readFileSync(path.join(installed.release.web, name), 'utf8')
    expect(html.match(/<meta name="platform-release"[^>]*>/g)).toEqual([
      `<meta name="platform-release" content="${config.release}">`,
    ])
    expect(readFileSync(path.join(source, 'web', name), 'utf8')).toBe(document)
  }
})

test('different commit stages once, preserving current until exact restart approval', () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, intent(root))
  const source = payload(root, 'new', 'b'.repeat(40))
  const staged = installBundledRelease(source, releaseRoot, intent(root))
  expect(staged.disposition).toBe('staged')
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
  expect(installBundledRelease(source, releaseRoot, intent(root)).release.directory).toBe(
    staged.release.directory,
  )
  expect(promote(releaseRoot, () => true)).toBe('none')
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
})

test('first-install readiness failure retains current and records a failed verdict', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const port = await freePort()
  const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
  const installed = installBundledRelease(payload(root, 'first'), releaseRoot, requested, {
    readinessMs: 1000,
  })
  const commands: string[][] = []
  expect(
    await checkReadiness(releaseRoot, installed.release.directory, null, (argv) => {
      commands.push([...argv])
      return true
    }),
  ).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(installed.release.directory)
  expect(commands).toHaveLength(0)
  expect(
    JSON.parse(readFileSync(path.join(installed.release.directory, 'live-check.json'), 'utf8')),
  ).toMatchObject({
    release: installed.release.name,
    status: 'failed',
    fresh: ['Server identity readiness failed'],
  })
  fregatServer({ port, stateHome: root })
  const { checkCurrentReadiness } = await import('../../deploy/systemd/promote')
  expect(await checkCurrentReadiness(releaseRoot, () => true)).toBe(true)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(installed.release.directory)
})

test('failed post-promotion identity readiness restores previous release without a mesh live check', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const requested = { ...intent(root), address: `http://127.0.0.1:${await freePort()}` }
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, requested)
  const staged = installBundledRelease(
    payload(root, 'new', 'b'.repeat(40)),
    releaseRoot,
    requested,
    { readinessMs: 1 },
  )
  approveRestart(releaseRoot, {
    release: staged.release.name,
    stagedAt: lstatSync(path.join(releaseRoot, 'pending')).mtime.toISOString(),
  })
  const launches: string[][] = []
  expect(
    promote(releaseRoot, (argv) => {
      launches.push([...argv])
      return true
    }),
  ).toBe('promoted')
  expect(
    launches.flat().some((arg) => arg.includes('systemd-run') || arg.includes('live-check.mjs')),
  ).toBe(false)
  const result = await checkReadiness(
    releaseRoot,
    staged.release.directory,
    first.release.directory,
    () => true,
  )
  expect(result).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
})

test('post-promotion readiness accepts the state-home identity proof and records the verdict', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const port = await freePort()
  const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
  const installed = installBundledRelease(payload(root, 'first'), releaseRoot, requested)
  fregatServer({ port, stateHome: root })
  expect(await checkReadiness(releaseRoot, installed.release.directory, null, () => true)).toBe(
    true,
  )
  const verdict = JSON.parse(
    readFileSync(path.join(installed.release.directory, 'live-check.json'), 'utf8'),
  )
  expect(verdict.status).toBe('passed')
  expect(verdict.release).toBe(installed.release.name)
})

test('seeding preserves runtime configuration, dotfiles, and internal relative symlinks', () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const source = payload(root, 'bundle')
  rmSync(path.join(source, 'server/node_modules'), { recursive: true })
  rmSync(path.join(source, 'node_modules'), { recursive: true })
  mkdirSync(path.join(source, 'runtime/node_modules'), { recursive: true })
  writeFileSync(path.join(source, 'runtime/bunfig.toml'), '[install]\nglobalStore=false\n')
  writeFileSync(path.join(source, 'runtime/.config'), 'retained')
  symlinkSync('../runtime/node_modules', path.join(source, 'server/node_modules'))
  symlinkSync('runtime/node_modules', path.join(source, 'node_modules'))
  const result = installBundledRelease(source, releaseRoot, intent(root))
  expect(readFileSync(path.join(result.release.directory, 'runtime/bunfig.toml'), 'utf8')).toBe(
    '[install]\nglobalStore=false\n',
  )
  expect(readFileSync(path.join(result.release.directory, 'runtime/.config'), 'utf8')).toBe(
    'retained',
  )
  for (const part of ['server/node_modules', 'node_modules']) {
    const link = path.join(result.release.directory, part)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe(
      part === 'node_modules' ? 'runtime/node_modules' : '../runtime/node_modules',
    )
    expect(realpathSync(link).startsWith(releaseRoot + path.sep)).toBe(true)
  }
})

test('a readiness failure cannot roll back a newer current chosen meanwhile', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, intent(root))
  const staged = installBundledRelease(
    payload(root, 'new', 'b'.repeat(40)),
    releaseRoot,
    intent(root),
    { readinessMs: 1 },
  )
  expect(
    await checkReadiness(
      releaseRoot,
      staged.release.directory,
      first.release.directory,
      () => true,
    ),
  ).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
})

test('failed recovery keeps the previous release and requests only one restart', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const requested = { ...intent(root), address: `http://127.0.0.1:${await freePort()}` }
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, requested, {
    readinessMs: 1,
  })
  const staged = installBundledRelease(
    payload(root, 'new', 'b'.repeat(40)),
    releaseRoot,
    requested,
    { readinessMs: 1 },
  )
  approveRestart(releaseRoot, {
    release: staged.release.name,
    stagedAt: lstatSync(path.join(releaseRoot, 'pending')).mtime.toISOString(),
  })
  promote(releaseRoot, () => true)
  const commands: string[][] = []
  const launch = (argv: readonly string[]) => {
    commands.push([...argv])
    return true
  }
  const { checkCurrentReadiness } = await import('../../deploy/systemd/promote')
  expect(await checkCurrentReadiness(releaseRoot, launch)).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
  expect(await checkCurrentReadiness(releaseRoot, launch)).toBe(false)
  expect(await checkCurrentReadiness(releaseRoot, launch)).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
  expect(commands).toHaveLength(1)
})

test('an activation that exited leaves no verdict or rollback from its stale helper', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, intent(root), {
    readinessMs: 1,
  })
  const commands: string[][] = []
  const result = await checkReadiness(
    releaseRoot,
    first.release.directory,
    null,
    (argv) => {
      commands.push([...argv])
      return true
    },
    fetch,
    { isActive: () => false },
  )
  expect(result).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
  expect(existsSync(path.join(first.release.directory, 'live-check.json'))).toBe(false)
  expect(commands).toHaveLength(0)
})

test('a listener with another state-home key cannot satisfy readiness', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const other = scratch()
  const port = await freePort()
  const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
  const installed = installBundledRelease(payload(root, 'first'), releaseRoot, requested, {
    readinessMs: 5,
  })
  fregatServer({ port, stateHome: root, keyHome: other })
  expect(await checkReadiness(releaseRoot, installed.release.directory, null, () => true)).toBe(
    false,
  )
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(installed.release.directory)
})

test.each(['linux', 'darwin'] as const)(
  'failed first activation keeps the %s registration target usable on retry',
  async (platform) => {
    const root = scratch()
    const releaseRoot = path.join(root, 'installed')
    const port = await freePort()
    const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
    const source = payload(root, 'first')
    mkdirSync(path.join(source, 'bin'))
    writeFileSync(path.join(source, 'bin/promote.js'), '')
    const forger = scratch()
    let failedServer: ReturnType<typeof fregatServer> | undefined
    const { host, commands } = recordingHost(root, platform, (argv) => {
      if (argv.includes('print')) return { code: 1 }
      if (argv.includes('bootstrap') || argv.includes('enable'))
        failedServer = fregatServer({ port, stateHome: root, keyHome: forger })
    })
    const { ensureMachineService } = await import('../ensure-machine-service')
    const { ensureInstalledService } =
      await import('../../../apps/desktop/src/launcher/installation-client')
    const options: Parameters<typeof ensureInstalledService>[0] = {
      intent: requested,
      productionRoot: releaseRoot,
      bundledRelease: source,
      signal: new AbortController().signal,
      ensure: (value, setup) => ensureMachineService(value, { ...setup, host, readinessMs: 1000 }),
    }
    await expect(ensureInstalledService(options)).rejects.toMatchObject({
      code: 'service.IDENTITY_UNVERIFIED',
      internal: { reason: 'proof' },
    })
    expect(commands.some((argv) => argv.includes('bootstrap') || argv.includes('enable'))).toBe(
      true,
    )
    expect(existsSync(path.join(releaseRoot, 'current/server/index.js'))).toBe(true)
    const current = realpathSync(path.join(releaseRoot, 'current'))
    expect(existsSync(path.join(root, 'desktop/installation.json'))).toBe(false)
    const registeredCommands = commands.length
    failedServer?.stop(true)
    fregatServer({ port, stateHome: root })
    const result = await ensureInstalledService(options)
    expect(result.disposition).toBe('reused')
    expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(current)
    expect(commands).toHaveLength(registeredCommands)
    expect(existsSync(path.join(root, 'desktop/installation.json'))).toBe(true)
  },
)

test('overlapping launches serialize activation before same-commit reuse', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const port = await freePort()
  const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
  const server = fregatServer({ stateHome: root, port })
  const identity = await (await fetch(new URL('/system/identity', server.url))).json()
  const { ensureInstalledService } =
    await import('../../../apps/desktop/src/launcher/installation-client')
  const { serviceErrors } = await import('../structured-errors')
  let started!: () => void
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let fail!: () => void
  const failure = new Promise<void>((resolve) => {
    fail = resolve
  })
  const options = {
    intent: requested,
    productionRoot: releaseRoot,
    bundledRelease: payload(root, 'bundle'),
    signal: new AbortController().signal,
  }
  const first = ensureInstalledService({
    ...options,
    ensure: async () => {
      started()
      await failure
      throw serviceErrors.IDENTITY_UNVERIFIED({ internal: { reason: 'fixture' } })
    },
  }).catch((error) => error)
  await entered
  let secondEntered = false
  const second = ensureInstalledService({
    ...options,
    ensure: async () => {
      secondEntered = true
      return { identity, disposition: 'reused' }
    },
  })
  await Bun.sleep(20)
  const overlapped = secondEntered
  fail()
  expect(await first).toMatchObject({ code: 'service.IDENTITY_UNVERIFIED' })
  await second
  expect(overlapped).toBe(false)
  expect(existsSync(path.join(releaseRoot, 'current'))).toBe(true)
})

test('launcher uses one machine activation budget for copied readiness and service setup', async () => {
  const root = scratch()
  writeFileSync(
    path.join(root, 'settings.json'),
    JSON.stringify({
      'server.activationTimeoutSeconds': 1,
    }),
  )
  const releaseRoot = path.join(root, 'installed')
  const port = await freePort()
  const requested = { ...intent(root), address: `http://127.0.0.1:${port}` }
  const server = fregatServer({ stateHome: root, port })
  const identity = await (await fetch(new URL('/system/identity', server.url))).json()
  const { ensureInstalledService } =
    await import('../../../apps/desktop/src/launcher/installation-client')
  let activationBudget: number | undefined
  await ensureInstalledService({
    intent: requested,
    productionRoot: releaseRoot,
    bundledRelease: payload(root, 'bundle'),
    signal: new AbortController().signal,
    ensure: async (_intent, options) => {
      activationBudget = options.readinessMs
      return { identity, disposition: 'reused' }
    },
  })
  const config = JSON.parse(
    readFileSync(path.join(releaseRoot, 'current/build-config.json'), 'utf8'),
  )
  expect(config.readiness.timeoutMs).toBe(1000)
  expect(activationBudget).toBe(1000)
})

test('rejected recovery restart compensates current and records an actionable terminal failure', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const requested = { ...intent(root), address: `http://127.0.0.1:${await freePort()}` }
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, requested)
  const staged = installBundledRelease(
    payload(root, 'new', 'b'.repeat(40)),
    releaseRoot,
    requested,
    {
      readinessMs: 1,
    },
  )
  approveRestart(releaseRoot, {
    release: staged.release.name,
    stagedAt: lstatSync(path.join(releaseRoot, 'pending')).mtime.toISOString(),
  })
  promote(releaseRoot, () => true)
  let commands = 0
  const rejected = () => {
    commands++
    return false
  }
  expect(
    await checkReadiness(releaseRoot, staged.release.directory, first.release.directory, rejected),
  ).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(staged.release.directory)
  const recovery = JSON.parse(
    readFileSync(path.join(releaseRoot, 'readiness-recovery.json'), 'utf8'),
  )
  expect(recovery).toMatchObject({
    release: staged.release.directory,
    status: 'failed',
    error: {
      code: 'service.RECOVERY_RESTART_FAILED',
      why: expect.any(String),
      fix: expect.any(String),
    },
  })
  const { checkCurrentReadiness } = await import('../../deploy/systemd/promote')
  expect(await checkCurrentReadiness(releaseRoot, rejected)).toBe(false)
  expect(commands).toBe(1)
})

test('a rejected restart after the candidate exits leaves recovery with the next activation', async () => {
  const root = scratch()
  const releaseRoot = path.join(root, 'installed')
  const requested = { ...intent(root), address: `http://127.0.0.1:${await freePort()}` }
  const first = installBundledRelease(payload(root, 'old'), releaseRoot, requested)
  const staged = installBundledRelease(
    payload(root, 'new', 'b'.repeat(40)),
    releaseRoot,
    requested,
    { readinessMs: 1 },
  )
  approveRestart(releaseRoot, {
    release: staged.release.name,
    stagedAt: lstatSync(path.join(releaseRoot, 'pending')).mtime.toISOString(),
  })
  promote(releaseRoot, () => true)
  let active = true
  let ownedRecovery: string | undefined
  const rejected = () => {
    active = false
    ownedRecovery = readFileSync(path.join(releaseRoot, 'readiness-recovery.json'), 'utf8')
    return false
  }
  expect(
    await checkReadiness(
      releaseRoot,
      staged.release.directory,
      first.release.directory,
      rejected,
      fetch,
      { isActive: () => active },
    ),
  ).toBe(false)
  expect(realpathSync(path.join(releaseRoot, 'current'))).toBe(first.release.directory)
  expect(readFileSync(path.join(releaseRoot, 'readiness-recovery.json'), 'utf8')).toBe(
    ownedRecovery,
  )
})
