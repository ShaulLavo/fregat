import { expect, test } from 'vitest'
import { defaultDevStateHome } from '../../../../../scripts/state-home'
import { assertChromiumVersion } from '../chromium'
import { browserProfile, chromiumArguments, desktopStateHome } from '../profile'
import type { BrowserCandidate } from '../browser'

const candidate: BrowserCandidate = {
  kind: 'chromium',
  executable: '/usr/bin/chromium',
  args: [],
  confinement: 'none',
  source: 'scan',
  family: 'chromium',
}

test.each(['Chrome/126.0.1', 'Chrome/151.0.1'])('accept Chromium floor %s', (version) => {
  expect(() => assertChromiumVersion(version)).not.toThrow()
})
test.each(['Chrome/125.1', 'Firefox/140.0', 'Chrome/nope', null, {}, 'Chrome/125.0 Chrome/151.0'])(
  'reject old/malformed engine %s',
  (version) => {
    expect(() => assertChromiumVersion(version)).toThrow('engine needs an update')
  },
)
test('dev, production and explicit fixture homes isolate browser profiles', () => {
  const roots = [
    desktopStateHome({}, '/home/test', 'dev'),
    desktopStateHome({}, '/home/test', 'production'),
    desktopStateHome({ PLATFORM_HOME: '/fixtures/test' }, '/home/test', 'dev'),
  ]
  expect(new Set(roots.map((root) => browserProfile(candidate, root, '/home/test'))).size).toBe(3)
  expect(roots).toEqual([
    defaultDevStateHome('/home/test'),
    '/home/test/.platform',
    '/fixtures/test',
  ])
})
test('snap keeps state-home namespaces isolated and flatpak grants only chosen profile', () => {
  const snap = { ...candidate, executable: '/snap/bin/chromium', confinement: 'snap' as const }
  expect(browserProfile(snap, '/a', '/home/test')).not.toEqual(
    browserProfile(snap, '/b', '/home/test'),
  )
  expect(browserProfile(snap, '/a', '/home/test')).toMatch(
    /^\/home\/test\/snap\/chromium\/common\/platform\//,
  )
  const flatpak = {
    ...candidate,
    executable: '/usr/bin/flatpak',
    args: ['run', 'org.chromium.Chromium'],
    confinement: 'flatpak' as const,
  }
  expect(chromiumArguments(flatpak, '/fixtures/profile').slice(0, 5)).toEqual([
    'run',
    '--filesystem=/fixtures/profile',
    '--forward-fd=3',
    '--forward-fd=4',
    'org.chromium.Chromium',
  ])
  expect(chromiumArguments(candidate, '/fixtures/profile')).toContain('--disable-extensions')
})
test('production Mac Chromium keeps real keychain and system proxy arguments', () => {
  const mac = {
    ...candidate,
    executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    family: 'chrome',
  }
  expect(chromiumArguments(mac, '/fixtures/profile')).toEqual([
    'about:blank',
    '--headless=new',
    '--user-data-dir=/fixtures/profile',
    '--profile-directory=Platform',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--window-size=1440,960',
  ])
})

test('installed handoff uses app id and launch URL with no CDP or plain app fallback', () => {
  const args = chromiumArguments(candidate, '/fixtures/profile', {
    appId: 'abcdef',
    url: 'http://localhost:123/platform/?workspace=two',
  })
  expect(args).toContain('--app-id=abcdef')
  expect(args).toContain(
    '--app-launch-url-for-shortcuts-menu-item=http://localhost:123/platform/?workspace=two',
  )
  expect(args).not.toContain('--remote-debugging-pipe')
  expect(args.some((arg) => arg.startsWith('--headless'))).toBe(false)
  expect(args.some((arg) => arg.startsWith('--app='))).toBe(false)
})
