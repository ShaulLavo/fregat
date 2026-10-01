import { expect, test } from 'vitest'
import { existsSync, fstatSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { launchChromium } from '../chromium'
import { cdpPipe } from '../cdp'
import { liveSingletonOwner } from '../singleton'
import type { BrowserCandidate } from '../browser'

async function fixture(mode: string) {
  const root = await mkdtemp(
    path.join(existsSync('/work/tmp') ? '/work/tmp' : tmpdir(), 'polaron-owner-'),
  )
  const pidFile = path.join(root, 'pid')
  const candidate: BrowserCandidate = {
    kind: 'chromium',
    executable: process.execPath,
    args: [path.join(import.meta.dirname, 'fixtures/browser.mjs'), mode, pidFile],
    confinement: 'none',
    source: 'setting',
    family: 'fixture',
  }
  return { root, pidFile, candidate }
}
function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test.each(Array.from({ length: 30 }, (_, run) => run))(
  'singleton process exits after pipe EOF; successful handoff run %i',
  async () => {
    const f = await fixture('handoff')
    const profile = path.join(f.root, 'desktop/chromium')
    await mkdir(profile, { recursive: true })
    const other = Bun.spawn(
      [
        process.execPath,
        '-e',
        'setInterval(() => {}, 1000)',
        '--',
        `--user-data-dir=${profile}`,
        '--profile-directory=Platform',
        '--remote-debugging-pipe',
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    await symlink(`${hostname()}-${other.pid}`, path.join(profile, 'SingletonLock'))
    try {
      const result = await launchChromium({
        candidate: f.candidate,
        stateHome: f.root,
        home: f.root,
        url: 'http://localhost:123/',
        onOpen: () => {},
        onFailure: () => {},
      })
      expect(result).toEqual({ kind: 'handoff' })
      expect(processExists(other.pid)).toBe(true)
      expect(processExists(Number(await readFile(f.pidFile, 'utf8')))).toBe(false)
    } finally {
      other.kill('SIGTERM')
      await other.exited
      await rm(f.root, { recursive: true, force: true })
    }
  },
)
test.each(['old-version', 'exit-failure', 'silent'])(
  'rejected browser %s is reaped and another owned process/service stays alive',
  async (mode) => {
    const f = await fixture(mode)
    const other = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('fixture service'),
    })
    try {
      await expect(
        launchChromium({
          candidate: f.candidate,
          stateHome: f.root,
          home: f.root,
          url: 'http://localhost:123/',
          onOpen: () => {},
          onFailure: () => {},
        }),
      ).rejects.toThrow()
      expect(processExists(Number(await readFile(f.pidFile, 'utf8')))).toBe(false)
      expect(processExists(other.pid)).toBe(true)
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe('fixture service')
    } finally {
      other.kill('SIGTERM')
      await other.exited
      server.stop(true)
      await rm(f.root, { recursive: true, force: true })
    }
  },
  10_000,
)
test('abort during startup closes only the child that this launcher started', async () => {
  const f = await fixture('silent')
  const controller = new AbortController()
  try {
    const pending = launchChromium({
      candidate: f.candidate,
      stateHome: f.root,
      home: f.root,
      url: 'http://localhost:123/',
      signal: controller.signal,
      onOpen: () => {},
      onFailure: () => {},
    })
    while (!existsSync(f.pidFile)) await Bun.sleep(5)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(processExists(Number(await readFile(f.pidFile, 'utf8')))).toBe(false)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('a configured zero-exit executable without a controlled singleton is rejected', async () => {
  const f = await fixture('exit-failure')
  try {
    await expect(
      launchChromium({
        candidate: { ...f.candidate, executable: '/bin/true', args: [] },
        stateHome: f.root,
        home: f.root,
        url: 'http://localhost:123/',
        onOpen: () => {},
        onFailure: () => {},
      }),
    ).rejects.toThrow('desktop window could not open')
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test.each(Array.from({ length: 30 }, (_, run) => run))(
  'CDP close releases both owned descriptors run %i',
  async () => {
    const f = await fixture('old-version')
    const child = Bun.spawn([f.candidate.executable, ...f.candidate.args], {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    })
    const writeFd = child.stdio[3] as number
    const readFd = child.stdio[4] as number
    const cdp = cdpPipe(writeFd, readFd)
    try {
      await expect(cdp.request('Browser.getVersion')).resolves.toMatchObject({
        product: 'Chrome/125.0.1',
      })
      cdp.close()
      cdp.close()
      expect(() => fstatSync(writeFd)).toThrow()
      expect(() => fstatSync(readFd)).toThrow()
      await child.exited
    } finally {
      cdp.close()
      if (child.exitCode === null) child.kill('SIGTERM')
      await child.exited
      await rm(f.root, { recursive: true, force: true })
    }
  },
)

test('/bin/true with an existing valid profile owner is rejected and preserves that owner', async () => {
  const f = await fixture('handoff')
  const profile = path.join(f.root, 'desktop/chromium')
  await mkdir(profile, { recursive: true })
  const other = Bun.spawn(
    [
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
      '--',
      `--user-data-dir=${profile}`,
      '--profile-directory=Platform',
      '--remote-debugging-pipe',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
  await symlink(`${hostname()}-${other.pid}`, path.join(profile, 'SingletonLock'))
  try {
    expect(liveSingletonOwner(profile, process.execPath)).toBe(true)
    await expect(
      launchChromium({
        candidate: { ...f.candidate, executable: '/bin/true', args: [] },
        stateHome: f.root,
        home: f.root,
        url: 'http://localhost:123/',
        onOpen: () => {},
        onFailure: () => {},
      }),
    ).rejects.toThrow('desktop window could not open')
    expect(processExists(other.pid)).toBe(true)
  } finally {
    other.kill('SIGTERM')
    await other.exited
    await rm(f.root, { recursive: true, force: true })
  }
})
