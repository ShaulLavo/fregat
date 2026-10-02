import { expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { launchChromium } from '../chromium'
import type { BrowserCandidate } from '../browser'
import { installedIdentity } from '../installed-app'
import { chromiumArguments } from '../profile'

// Chromium's POSIX singleton and flock require Linux or macOS.
const posixTest = test.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')

async function fixture(mode: string, initialManifest?: string) {
  let manifest = initialManifest
  const root = await mkdtemp(path.join(tmpdir(), 'fregat-arbitration-'))
  const pidFile = path.join(root, 'pid')
  const profile = path.join(root, 'desktop/chromium')
  await mkdir(profile, { recursive: true })
  const candidate: BrowserCandidate = {
    kind: 'chromium',
    executable: process.execPath,
    args:
      mode === 'review'
        ? [path.join(import.meta.dirname, 'fixtures/review-race-browser.mjs'), pidFile]
        : [path.join(import.meta.dirname, 'fixtures/browser.mjs'), mode, pidFile],
    confinement: 'none',
    source: 'setting',
    family: 'fixture',
  }
  const launch = (subject: string) =>
    launchChromium({
      candidate,
      stateHome: root,
      home: root,
      url: `http://localhost:123/?subject=${subject}`,
      manifest,
      startup: { idleMs: 1000, limitMs: 4000 },
      onOpen: () => {},
    })
  const cleanup = async () => {
    const pids = await readFile(pidFile + '.pids', 'utf8').catch(async () =>
      readFile(pidFile, 'utf8').catch(() => ''),
    )
    for (const pid of pids.trim().split('\n').map(Number)) {
      if (!pid) continue
      try {
        process.kill(pid, 'SIGTERM')
      } catch {}
    }
    await rm(root, { recursive: true, force: true })
  }
  const closeApp = async () => {
    const owner = await readlink(path.join(profile, 'SingletonLock'))
    process.kill(Number(owner.slice(hostname().length + 1)), 'SIGTERM')
    const deadline = Date.now() + 2000
    while (existsSync(path.join(profile, 'SingletonLock')) && Date.now() < deadline)
      await Bun.sleep(5)
    expect(existsSync(path.join(profile, 'SingletonLock'))).toBe(false)
  }
  return {
    root,
    pidFile,
    profile,
    candidate,
    launch,
    cleanup,
    closeApp,
    setManifest: (next: string) => {
      manifest = next
    },
  }
}

async function until(file: string) {
  const deadline = Date.now() + 2000
  while (!existsSync(file) && Date.now() < deadline) await Bun.sleep(5)
  expect(existsSync(file)).toBe(true)
}

async function assertConverged(pidFile: string) {
  const requests = (await readFile(pidFile + '.requests', 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(requests.filter((request) => request.method === 'PWA.install')).toHaveLength(1)
  const forwarded = await readFile(pidFile + '.forwarded', 'utf8').catch(() => '')
  expect(forwarded).not.toContain('controller')
  const deliveries = await readFile(pidFile + '.deliveries', 'utf8')
  expect(deliveries).toContain('subject=one')
  expect(deliveries).toContain('subject=two')
}

posixTest(
  'simultaneous idle launchers converge to one install and deliver both URLs to the app',
  async () => {
    const box = await fixture('race-simultaneous')
    try {
      const results = await Promise.allSettled([box.launch('one'), box.launch('two')])
      expect(results).toEqual([
        { status: 'fulfilled', value: { kind: 'handoff' } },
        { status: 'fulfilled', value: { kind: 'handoff' } },
      ])
      await assertConverged(box.pidFile)
    } finally {
      await box.cleanup()
    }
  },
)

posixTest(
  'a second launcher waits while the first controller is installing and never forwards to it',
  async () => {
    const box = await fixture('race-paused')
    const first = box.launch('one')
    let second: ReturnType<typeof box.launch> | undefined
    try {
      await until(box.pidFile + '.paused')
      second = box.launch('two')
      const settled = second.then(
        () => 'done',
        () => 'failed',
      )
      expect(await Promise.race([settled, Bun.sleep(100).then(() => 'waiting')])).toBe('waiting')
      expect(existsSync(box.pidFile + '.forwarded')).toBe(false)
      await writeFile(box.pidFile + '.release', 'go')
      expect(await first).toEqual({ kind: 'handoff' })
      expect(await second).toEqual({ kind: 'handoff' })
      await assertConverged(box.pidFile)
    } finally {
      await writeFile(box.pidFile + '.release', 'go')
      await Promise.allSettled([first, ...(second ? [second] : [])])
      await box.cleanup()
    }
  },
)

posixTest('a Dock-shim owner with only user-data-dir accepts a repeat launch', async () => {
  const box = await fixture('handoff')
  const owner = Bun.spawn(
    [
      process.execPath,
      '-e',
      'setInterval(() => {}, 1000)',
      '--',
      `--user-data-dir=${box.profile}`,
      '--no-startup-window',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
  await symlink(`${hostname()}-${owner.pid}`, path.join(box.profile, 'SingletonLock'))
  try {
    expect(await box.launch('one')).toEqual({ kind: 'handoff' })
    expect(existsSync(box.pidFile + '.controller')).toBe(false)
    expect(() => process.kill(owner.pid, 0)).not.toThrow()
  } finally {
    owner.kill('SIGTERM')
    await owner.exited
    await box.cleanup()
  }
})

posixTest(
  'a confined owner with a foreign namespace pid and different executable is identified by its singleton socket',
  async () => {
    const box = await fixture('handoff')
    const socketPath = path.join(box.root, 'socket')
    const socket = createServer((connection) => connection.end())
    await new Promise<void>((resolve) => socket.listen(socketPath, resolve))
    await symlink('sandbox-host-1', path.join(box.profile, 'SingletonLock'))
    await symlink(socketPath, path.join(box.profile, 'SingletonSocket'))
    await symlink('fixture-cookie', path.join(box.profile, 'SingletonCookie'))
    await symlink('fixture-cookie', path.join(box.root, 'SingletonCookie'))
    try {
      expect(await box.launch('one')).toEqual({ kind: 'handoff' })
      expect(existsSync(box.pidFile + '.controller')).toBe(false)
    } finally {
      await new Promise<void>((resolve) => socket.close(() => resolve()))
      await box.cleanup()
    }
  },
)

posixTest(
  'independent launcher processes share the profile lock and release it before exiting',
  async () => {
    const box = await fixture('race-simultaneous')
    const launchers = ['one', 'two'].map((subject) =>
      Bun.spawn(
        [
          process.execPath,
          path.join(import.meta.dirname, 'fixtures/launch.mjs'),
          box.root,
          'race-simultaneous',
          subject,
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      ),
    )
    try {
      expect(await Promise.all(launchers.map((launcher) => launcher.exited))).toEqual([0, 0])
      expect(await readFile(path.join(box.root, 'returned-one'), 'utf8')).toBe('handoff')
      expect(await readFile(path.join(box.root, 'returned-two'), 'utf8')).toBe('handoff')
      await assertConverged(box.pidFile)
    } finally {
      for (const launcher of launchers) if (launcher.exitCode === null) launcher.kill('SIGTERM')
      await Promise.all(launchers.map((launcher) => launcher.exited))
      await box.cleanup()
    }
  },
)

posixTest(
  'OS shortcuts opened during installation survive controller shutdown with deduplicated URLs',
  async () => {
    const box = await fixture('race-shortcut')
    const first = box.launch('one')
    try {
      await until(box.pidFile + '.paused')
      for (const subject of ['one', 'two', 'three']) {
        const url = `http://localhost:123/?subject=${subject}`
        const shortcut = Bun.spawn(
          [
            box.candidate.executable,
            ...chromiumArguments(box.candidate, box.profile, {
              ...installedIdentity(url),
              url,
            }),
          ],
          { stdio: ['ignore', 'ignore', 'ignore'] },
        )
        expect(await shortcut.exited).toBe(0)
      }
      expect(await readFile(box.pidFile + '.forwarded', 'utf8')).toContain('controller')
      expect(existsSync(box.pidFile + '.deliveries')).toBe(false)
      await writeFile(box.pidFile + '.release', 'go')
      expect(await first).toEqual({ kind: 'handoff' })
      const delivered = (await readFile(box.pidFile + '.deliveries', 'utf8'))
        .trim()
        .split('\n')
        .map((line) =>
          JSON.parse(line).find((arg: string) =>
            arg.startsWith('--app-launch-url-for-shortcuts-menu-item='),
          ),
        )
      expect(delivered).toEqual(
        ['one', 'two', 'three'].map(
          (subject) =>
            `--app-launch-url-for-shortcuts-menu-item=http://localhost:123/?subject=${subject}`,
        ),
      )
      const requests = await readFile(box.pidFile + '.requests', 'utf8')
      expect(requests.indexOf('Target.getTargets')).toBeGreaterThan(requests.indexOf('PWA.install'))
      expect(requests.indexOf('Target.getTargets')).toBeLessThan(
        requests.indexOf('fixture.pipeClosed'),
      )
    } finally {
      await writeFile(box.pidFile + '.release', 'go')
      await Promise.allSettled([first])
      await box.cleanup()
    }
  },
)

posixTest(
  'reviewer OS-shortcut probe preserves every controller app target after handoff',
  async () => {
    const box = await fixture('review')
    const first = box.launch('one')
    try {
      await until(box.pidFile + '.installing')
      for (const subject of ['one', 'two', 'three']) {
        const url = `http://localhost:123/?subject=${subject}`
        const shortcut = Bun.spawn(
          [
            box.candidate.executable,
            ...chromiumArguments(box.candidate, box.profile, { ...installedIdentity(url), url }),
          ],
          { stdio: ['ignore', 'ignore', 'ignore'] },
        )
        expect(await shortcut.exited).toBe(0)
      }
      expect(await readFile(box.pidFile + '.forwarded', 'utf8')).toContain(
        '"ownerPhase":"installing"',
      )
      await writeFile(box.pidFile + '.release', 'go')
      expect(await first).toEqual({ kind: 'handoff' })
      const delivered = (await readFile(box.pidFile + '.deliveries', 'utf8'))
        .trim()
        .split('\n')
        .map((line) =>
          JSON.parse(line).find((arg: string) =>
            arg.startsWith('--app-launch-url-for-shortcuts-menu-item='),
          ),
        )
      expect(delivered).toEqual(
        ['one', 'two', 'three'].map(
          (subject) =>
            `--app-launch-url-for-shortcuts-menu-item=http://localhost:123/?subject=${subject}`,
        ),
      )
    } finally {
      await writeFile(box.pidFile + '.release', 'go')
      await Promise.allSettled([first])
      await box.cleanup()
    }
  },
)

posixTest(
  'a direct OS app winning the singleton after the idle check receives the launcher URL',
  async () => {
    const box = await fixture('review')
    await writeFile(box.pidFile + '.gate', 'gate')
    const first = box.launch('one')
    const settled = first.then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', code: error.code }),
    )
    let owner: ReturnType<typeof Bun.spawn> | undefined
    try {
      await until(box.pidFile + '.spawned')
      const url = 'http://localhost:123/?subject=os-wins'
      owner = Bun.spawn(
        [
          box.candidate.executable,
          ...chromiumArguments(box.candidate, box.profile, { ...installedIdentity(url), url }),
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      )
      await until(box.pidFile + '.app')
      await writeFile(box.pidFile + '.allow', 'go')
      expect(await settled).toEqual({ status: 'fulfilled', value: { kind: 'handoff' } })
      expect(await readFile(box.pidFile + '.deliveries', 'utf8')).toContain('subject=one')
      expect(owner.exitCode).toBe(null)
      expect(existsSync(box.pidFile + '.installing')).toBe(false)
    } finally {
      await writeFile(box.pidFile + '.allow', 'go')
      await settled
      if (owner?.exitCode === null) owner.kill('SIGTERM')
      if (owner) await owner.exited
      await box.cleanup()
    }
  },
)

const firstManifest = JSON.stringify({ id: './', start_url: './', name: 'Fregat' })

posixTest(
  'an idle launch with a matching receipt and Chrome install records skips the controller',
  async () => {
    const box = await fixture('race-simultaneous', firstManifest)
    try {
      await box.launch('one')
      await box.closeApp()
      await box.launch('two')
      const requests = (await readFile(box.pidFile + '.requests', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter((request) => request.method === 'Browser.getVersion')).toHaveLength(1)
      expect(await readFile(box.pidFile + '.deliveries', 'utf8')).toContain('subject=two')
    } finally {
      await box.cleanup()
    }
  },
)

posixTest(
  'a changed manifest invalidates the receipt and triggers one controller pass',
  async () => {
    const box = await fixture('race-simultaneous', firstManifest)
    try {
      await box.launch('one')
      await box.closeApp()
      await box.launch('two')
      await box.closeApp()
      box.setManifest(JSON.stringify({ id: './', start_url: './', name: 'Fregat updated' }))
      await box.launch('three')
      const requests = (await readFile(box.pidFile + '.requests', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter((request) => request.method === 'Browser.getVersion')).toHaveLength(2)
    } finally {
      await box.cleanup()
    }
  },
)

posixTest(
  'a failed receipt app launch repairs registration once before retrying the app',
  async () => {
    const box = await fixture('race-simultaneous', firstManifest)
    try {
      await box.launch('one')
      await box.closeApp()
      await writeFile(box.pidFile + '.fail-next-app', 'fail')
      expect(await box.launch('two')).toEqual({ kind: 'handoff' })
      const requests = (await readFile(box.pidFile + '.requests', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter((request) => request.method === 'Browser.getVersion')).toHaveLength(2)
      expect(await readFile(box.pidFile + '.deliveries', 'utf8')).toContain('subject=two')
    } finally {
      await box.cleanup()
    }
  },
)

posixTest(
  'Chrome uninstall resource removal overrides a matching receipt and runs setup',
  async () => {
    const box = await fixture('race-simultaneous', firstManifest)
    try {
      await box.launch('one')
      await box.closeApp()
      const { appId } = installedIdentity('http://localhost:123/')
      await rm(
        path.join(box.profile, 'Platform', 'Web Applications', 'Manifest Resources', appId),
        { recursive: true },
      )
      await rm(box.pidFile + '.installed')
      expect(await box.launch('two')).toEqual({ kind: 'handoff' })
      const requests = (await readFile(box.pidFile + '.requests', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter((request) => request.method === 'PWA.install')).toHaveLength(2)
    } finally {
      await box.cleanup()
    }
  },
)
