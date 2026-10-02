import { expect, test } from 'vitest'
import { resolveBrowserCandidates } from '../browser'
import { startupProcessCounters } from '../diagnostics'
import { startupSupervisor } from '../startup'
import { shellBridge } from '../shell-bridge'

function macFixture(preferred = 'net.imput.helium') {
  const plists: Record<string, unknown> = {
    '/Users/test/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist':
      {
        LSHandlers: [{ LSHandlerURLScheme: 'https', LSHandlerRoleAll: preferred }],
      },
    '/Applications/Helium.app/Contents/Info.plist': {
      CFBundleIdentifier: 'net.imput.helium',
      CFBundleExecutable: 'Helium',
    },
    '/Users/test/Applications/Google Chrome.app/Contents/Info.plist': {
      CFBundleIdentifier: 'com.google.Chrome',
      CFBundleExecutable: 'Google Chrome',
    },
    '/Volumes/Apps/Brave Browser.app/Contents/Info.plist': {
      CFBundleIdentifier: 'com.brave.Browser',
      CFBundleExecutable: 'Brave Browser',
    },
  }
  const executable = (file: string) =>
    file.endsWith('/Contents/MacOS/Helium') ||
    file.endsWith('/Contents/MacOS/Google Chrome') ||
    file.endsWith('/Contents/MacOS/Brave Browser') ||
    file === '/custom/browser'
  const runMac = (args: readonly string[]) => {
    if (args[0] === '/usr/bin/plutil') return JSON.stringify(plists[args.at(-1)!])
    if (args[1]?.includes('com.brave.Browser')) return '/Volumes/Apps/Brave Browser.app\n'
    return ''
  }
  const env = { home: '/Users/test', path: '/usr/bin', platform: 'darwin' as const, runMac }
  const fs = { readFile: () => undefined, exists: executable }
  return { env, fs, plists }
}

test('macOS supports default bundle, per-user Applications, Spotlight and absolute override', () => {
  const { env, fs } = macFixture()
  const result = resolveBrowserCandidates('auto', 'compositor', env, fs)
  expect(result.slice(0, 3)).toMatchObject([
    {
      family: 'chrome',
      source: 'scan',
      executable: '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
    {
      family: 'helium',
      source: 'default',
      executable: '/Applications/Helium.app/Contents/MacOS/Helium',
    },
    {
      family: 'brave',
      source: 'scan',
      executable: '/Volumes/Apps/Brave Browser.app/Contents/MacOS/Brave Browser',
    },
  ])
  expect(result.slice(-2)).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
  expect(resolveBrowserCandidates('auto', 'window', env, fs)).toEqual([
    { kind: 'webview' },
    { kind: 'tab' },
  ])
  expect(resolveBrowserCandidates('/custom/browser', 'compositor', env, fs)[0]).toMatchObject({
    source: 'setting',
    executable: '/custom/browser',
  })
})

test('macOS without Chrome selects the supported default before scan', () => {
  const { env, fs } = macFixture()
  const withoutChrome = {
    ...fs,
    exists: (file: string) => !file.endsWith('/Google Chrome') && fs.exists(file),
  }
  expect(resolveBrowserCandidates('auto', 'compositor', env, withoutChrome)).toMatchObject([
    { family: 'helium', source: 'default' },
    { family: 'brave', source: 'scan' },
    { kind: 'webview' },
    { kind: 'tab' },
  ])
})

test('macOS without Chrome or supported default scans before webview', () => {
  const { env, fs } = macFixture('org.mozilla.firefox')
  const withoutChrome = {
    ...fs,
    exists: (file: string) => !file.endsWith('/Google Chrome') && fs.exists(file),
  }
  expect(resolveBrowserCandidates('auto', 'compositor', env, withoutChrome)[0]).toMatchObject({
    family: 'brave',
    source: 'scan',
  })
  expect(
    resolveBrowserCandidates('auto', 'compositor', env, { ...fs, exists: () => false }),
  ).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
})

test('unsupported defaults, malformed metadata and escaped bundle executables are ignored', () => {
  const { env, fs, plists } = macFixture('org.mozilla.firefox')
  plists['/Applications/Helium.app/Contents/Info.plist'] = {
    CFBundleIdentifier: 'net.imput.helium',
    CFBundleExecutable: '../escape',
  }
  plists['/Volumes/Apps/Brave Browser.app/Contents/Info.plist'] = {
    CFBundleIdentifier: 'other',
    CFBundleExecutable: 'Brave Browser',
  }
  expect(resolveBrowserCandidates('auto', 'compositor', env, fs).slice(0, -2)).toMatchObject([
    { family: 'chrome', source: 'scan' },
  ])
  expect(
    resolveBrowserCandidates('auto', 'compositor', { ...env, runMac: () => 'invalid' }, fs),
  ).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
})

test('missing Linux proc has no process progress; only incoming CDP renews idle and never the cap', () => {
  expect(startupProcessCounters(123, 'darwin')).toEqual({})
  let now = 0
  const monitor = startupSupervisor({ idleMs: 100, limitMs: 300 }, () => now)
  const check = (readBytes: number) =>
    monitor.check({ ...startupProcessCounters(123, 'darwin'), cdpReadBytes: readBytes })
  expect(check(0)).toBe('progressing')
  now = 90
  expect(check(1)).toBe('progressing')
  now = 180
  expect(check(2)).toBe('progressing')
  now = 280
  expect(check(2)).toBe('startup-stalled')
  now = 300
  expect(check(3)).toBe('startup-limit')
})

test('WKWebView reports its own transparent overlay', () => {
  const native = shellBridge('http://localhost:123', 'wkwebview', 'token', 'darwin', true)
  expect(native).toContain('"backdrop":"transparent"')
  expect(native).toContain('"titlebar":"overlay"')
  expect(native).toContain('"platform":"darwin"')
  expect(native).toContain('[data-native-window-drag-region]')
  expect(native).toContain('[data-native-window-no-drag]')
})

test('WK drag listener sends only primary presses on non-interactive regions', () => {
  const messages: unknown[] = []
  const listeners = new Map<string, (event: unknown) => void>()
  class Element {
    constructor(
      readonly region: boolean,
      readonly interactive: boolean,
    ) {}
    closest(selector: string) {
      return selector === '[data-native-window-drag-region]' ? this.region : this.interactive
    }
  }
  const global: Record<string, unknown> = {}
  const window = { top: undefined as unknown }
  window.top = window
  const script = new Function(
    'globalThis',
    'window',
    'location',
    'document',
    'addEventListener',
    'setTimeout',
    'requestAnimationFrame',
    'webkit',
    'Element',
    shellBridge('http://localhost:123', 'wkwebview', 'fixture-token', 'darwin', true),
  )
  script(
    global,
    window,
    { origin: 'http://localhost:123' },
    { readyState: 'loading' },
    (name: string, callback: (event: unknown) => void) => listeners.set(name, callback),
    () => {},
    () => {},
    { messageHandlers: { platformShell: { postMessage: (body: unknown) => messages.push(body) } } },
    Element,
  )
  expect(global.platformBridge).toMatchObject({
    titlebar: 'overlay',
    platform: 'darwin',
    backdrop: 'transparent',
    capabilities: { displayCapture: false },
  })
  const down = listeners.get('mousedown')!
  down({ button: 1, target: new Element(true, false) })
  down({ button: 0, target: new Element(false, false) })
  down({ button: 0, target: new Element(true, true) })
  expect(messages).toEqual([])
  down({ button: 0, target: new Element(true, false) })
  expect(messages).toEqual([
    { method: 'drag', origin: 'http://localhost:123', token: 'fixture-token' },
  ])
  expect(shellBridge('http://localhost:123', 'webkitgtk', undefined, 'linux', true)).toContain(
    '"backdrop":"compositor"',
  )
})

test.each([
  ['wkwebview', 'darwin', true, true],
  ['wkwebview', 'darwin', false, false],
  ['webkitgtk', 'linux', true, false],
  ['webkitgtk', 'linux', false, false],
] as const)(
  '%s on %s with vibrancy %s exposes surface opacity: %s',
  (engine, platform, vibrancy, available) => {
    const messages: unknown[] = []
    const global: Record<string, unknown> = {}
    const window = { top: undefined as unknown }
    window.top = window
    new Function(
      'globalThis',
      'window',
      'location',
      'document',
      'addEventListener',
      'webkit',
      shellBridge('http://localhost:123', engine, 'fixture-token', platform, vibrancy),
    )(global, window, { origin: 'http://localhost:123' }, { readyState: 'loading' }, () => {}, {
      messageHandlers: { platformShell: { postMessage: (body: unknown) => messages.push(body) } },
    })
    const bridge = global.platformBridge as { setSurfaceOpacity?: (opacity: number) => void }
    if (!available) {
      expect(bridge).not.toHaveProperty('setSurfaceOpacity')
      expect(messages).toEqual([])
      return
    }
    expect(bridge.setSurfaceOpacity).toBeTypeOf('function')
    bridge.setSurfaceOpacity!(20)
    bridge.setSurfaceOpacity!(80)
    expect(messages).toEqual([
      {
        method: 'setSurfaceOpacity',
        opacity: 20,
        origin: 'http://localhost:123',
        token: 'fixture-token',
      },
      {
        method: 'setSurfaceOpacity',
        opacity: 80,
        origin: 'http://localhost:123',
        token: 'fixture-token',
      },
    ])
  },
)
