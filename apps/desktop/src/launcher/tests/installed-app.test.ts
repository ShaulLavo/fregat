import { expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installedIdentity } from '../installed-app'
import { launchChromium } from '../chromium'
import { launchInstalledWindow } from '../installed-window'
import type { BrowserCandidate } from '../browser'

async function fixture(mode: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'fregat-pwa-'))
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

async function cleanup(root: string, pidFile: string) {
  const pid = Number(await readFile(pidFile, 'utf8').catch(() => '0'))
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
  await rm(root, { recursive: true, force: true })
}

test.each(['pwa-unknown', 'pwa-installed'])(
  '%s registers only when needed, launches stable identity and releases control',
  async (mode) => {
    const f = await fixture(mode)
    try {
      const window = await launchChromium({
        candidate: f.candidate,
        stateHome: f.root,
        home: f.root,
        url: 'http://localhost:123/platform/?workspace=one',
        startup: { idleMs: 500, limitMs: 2000 },
        onOpen: () => {},
        onFailure: () => {},
      })
      expect(window).toEqual({ kind: 'handoff' })
      const requests = (await readFile(f.pidFile + '.requests', 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(requests.filter((request) => request.method.startsWith('PWA.'))).toEqual([
        {
          id: expect.any(Number),
          method: 'PWA.getOsAppState',
          params: { manifestId: 'http://localhost:123/platform/' },
        },
        ...(mode === 'pwa-unknown'
          ? [
              {
                id: expect.any(Number),
                method: 'PWA.install',
                params: {
                  manifestId: 'http://localhost:123/platform/',
                  installUrlOrBundleUrl: 'http://localhost:123/platform/',
                },
              },
              {
                id: expect.any(Number),
                method: 'PWA.getOsAppState',
                params: { manifestId: 'http://localhost:123/platform/' },
              },
            ]
          : []),
      ])
      expect(
        requests.some((request) =>
          /^(Runtime\.|Page\.|Target\.setAutoAttach)/.test(request.method),
        ),
      ).toBe(false)
      const pid = Number(await readFile(f.pidFile, 'utf8'))
      const controllerPid = Number(await readFile(f.pidFile + '.controller', 'utf8'))
      expect(() => process.kill(controllerPid, 0)).toThrow()
      expect(() => process.kill(pid, 0)).not.toThrow()
      expect(JSON.parse(await readFile(f.pidFile + '.args', 'utf8'))).toContain(
        `--app-id=${installedIdentity('http://localhost:123/platform/').appId}`,
      )
      expect(requests.some((request) => request.method === 'PWA.launch')).toBe(false)
      const deadline = Date.now() + 1000
      while (
        !(await readFile(f.pidFile + '.requests', 'utf8')).includes('fixture.pipeClosed') &&
        Date.now() < deadline
      )
        await Bun.sleep(5)
      expect(await readFile(f.pidFile + '.requests', 'utf8')).toContain('fixture.pipeClosed')
    } finally {
      await cleanup(f.root, f.pidFile)
    }
  },
)

test.each(['pwa-unsupported', 'pwa-install-unsupported', 'pwa-unavailable'])(
  '%s returns structured fallback failure and reaps only setup child',
  async (mode) => {
    const f = await fixture(mode)
    try {
      await expect(
        launchChromium({
          candidate: f.candidate,
          stateHome: f.root,
          home: f.root,
          url: 'http://localhost:123/',
          startup: { idleMs: 500, limitMs: 2000 },
          onOpen: () => {},
          onFailure: () => {},
        }),
      ).rejects.toMatchObject({ code: 'desktop.launcher.PWA_UNSUPPORTED' })
      const pid = Number(await readFile(f.pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await cleanup(f.root, f.pidFile)
    }
  },
)

test.each(['pwa-invalid-params', 'pwa-install-failed', 'pwa-verify-failed'])(
  '%s is an operational error, preserves protocol facts and exposes no private messages',
  async (mode) => {
    const f = await fixture(mode)
    try {
      await expect(
        launchChromium({
          candidate: f.candidate,
          stateHome: f.root,
          home: f.root,
          url: 'http://localhost:123/',
          startup: { idleMs: 500, limitMs: 2000 },
          onOpen: () => {},
          onFailure: () => {},
        }),
      ).rejects.toMatchObject({
        code: 'desktop.launcher.CDP_FAILED',
        internal: { reason: 'request-error' },
      })
      const requests = await readFile(f.pidFile + '.requests', 'utf8')
      if (mode === 'pwa-invalid-params') expect(requests).not.toContain('PWA.install')
      const pid = Number(await readFile(f.pidFile, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      await cleanup(f.root, f.pidFile)
    }
  },
)

test.each(['pwa-unsupported', 'pwa-install-unsupported', 'pwa-unavailable', 'pwa-install-failed'])(
  '%s selects the native host only for unavailable installation capability',
  async (mode) => {
    const f = await fixture(mode)
    const opened: string[] = []
    try {
      const launch = launchInstalledWindow({
        browser: {
          candidate: f.candidate,
          stateHome: f.root,
          home: f.root,
          url: 'http://localhost:123/',
          startup: { idleMs: 500, limitMs: 2000 },
          onOpen: () => {},
          onFailure: () => {},
        },
        native: async () => {
          opened.push('native')
          return { kind: 'native' }
        },
        onUnsupported: () => opened.push('unsupported'),
      })
      if (mode === 'pwa-install-failed') {
        await expect(launch).rejects.toMatchObject({ code: 'desktop.launcher.CDP_FAILED' })
        expect(opened).toEqual([])
        return
      }
      await expect(launch).resolves.toEqual({ kind: 'native' })
      expect(opened).toEqual(['unsupported', 'native'])
    } finally {
      await cleanup(f.root, f.pidFile)
    }
  },
)

test('manifest-relative identity ignores query and hash while keeping the application base', () => {
  expect(installedIdentity('http://localhost:123/platform/?workspace=two#chat')).toEqual(
    installedIdentity('http://localhost:123/platform/'),
  )
  expect(installedIdentity('http://localhost:123/platform/').appId).toMatch(/^[a-p]{32}$/)
  expect(installedIdentity('http://localhost:123/').manifestId).toBe('http://localhost:123/')
})

test('releasing the bootstrap connection preserves the app when Chromium exits on pipe EOF', async () => {
  const f = await fixture('pwa-pipe-exits')
  try {
    expect(
      await launchChromium({
        candidate: f.candidate,
        stateHome: f.root,
        home: f.root,
        url: 'http://localhost:123/',
        startup: { idleMs: 500, limitMs: 2000 },
        onOpen: () => {},
        onFailure: () => {},
      }),
    ).toEqual({ kind: 'handoff' })
    await Bun.sleep(100)
    const pid = Number(await readFile(f.pidFile, 'utf8'))
    expect(() => process.kill(pid, 0)).not.toThrow()
  } finally {
    await cleanup(f.root, f.pidFile)
  }
})

test('the launcher process exits while the installed app remains alive without CDP', async () => {
  const f = await fixture('pwa-unknown')
  const launcher = Bun.spawn(
    [process.execPath, path.join(import.meta.dirname, 'fixtures/launch.mjs'), f.root],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
  try {
    expect(await Promise.race([launcher.exited, Bun.sleep(1000).then(() => 'still-running')])).toBe(
      0,
    )
    expect(await readFile(path.join(f.root, 'returned'), 'utf8')).toBe('handoff')
    const pid = Number(await readFile(f.pidFile, 'utf8'))
    expect(() => process.kill(pid, 0)).not.toThrow()
  } finally {
    if (launcher.exitCode === null) launcher.kill('SIGTERM')
    await launcher.exited
    await cleanup(f.root, f.pidFile)
  }
})

test('app ID matches Chromium OS registration for a known manifest URL', () => {
  expect(installedIdentity('http://127.0.0.1:45731/').appId).toBe(
    'jphlkooipajgapcgmninhlhmhildpdhi',
  )
})
