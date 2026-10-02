import { expect, test } from 'vitest'
import { resolveBrowserCandidates } from '../browser'
import { closeLastMacPage } from '../mac-lifecycle'
import { startupProcessCounters } from '../diagnostics'
import { startupSupervisor } from '../startup'
import { shellBridge } from '../shell-bridge'
import { hasMacSingletonOwner } from '../singleton'
import type { CdpEvent } from '../cdp'

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
      family: 'helium',
      source: 'default',
      executable: '/Applications/Helium.app/Contents/MacOS/Helium',
    },
    {
      family: 'chrome',
      source: 'scan',
      executable: '/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    },
    {
      family: 'brave',
      source: 'scan',
      executable: '/Volumes/Apps/Brave Browser.app/Contents/MacOS/Brave Browser',
    },
  ])
  expect(result.slice(-2)).toEqual([{ kind: 'webview' }, { kind: 'tab' }])
  expect(resolveBrowserCandidates('/custom/browser', 'compositor', env, fs)[0]).toMatchObject({
    source: 'setting',
    executable: '/custom/browser',
  })
  expect(resolveBrowserCandidates('auto', 'window', env, fs)).toEqual([
    { kind: 'webview' },
    { kind: 'tab' },
  ])
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

test('macOS closes its owned browser once after last page, ignoring workers and unknown destruction', async () => {
  const handlers = new Map<string, (event: CdpEvent) => void>()
  const calls: string[] = []
  const cdp = {
    on: (name: string, handler: (event: CdpEvent) => void) => {
      handlers.set(name, handler)
      return () => {
        handlers.delete(name)
      }
    },
    request: async (name: string) => {
      calls.push(name)
      return {}
    },
  }
  const stop = closeLastMacPage(cdp, () => expect.fail('close failed'))
  const create = (targetId: string, type = 'page') =>
    handlers.get('Target.targetCreated')!({
      method: 'Target.targetCreated',
      params: { targetInfo: { targetId, type } },
    })
  const destroy = (targetId: string) =>
    handlers.get('Target.targetDestroyed')!({
      method: 'Target.targetDestroyed',
      params: { targetId },
    })
  create('one')
  create('two')
  create('worker', 'service_worker')
  destroy('worker')
  destroy('unknown')
  destroy('one')
  expect(calls).toEqual([])
  destroy('two')
  destroy('two')
  expect(calls).toEqual(['Browser.close'])
  stop()
  expect(handlers.size).toBe(0)
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

test('Mac singleton handoff proves same executable, local host, profile and CDP ownership without signalling', () => {
  let command =
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --app=http://localhost --user-data-dir=/scratch/profile --profile-directory=Platform --remote-debugging-pipe'
  const fs = {
    readLink: () => 'fixture-host-123',
    realPath: (file: string) => file,
    readFile: () => undefined,
  }
  const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const run = () => command
  expect(hasMacSingletonOwner('/scratch/profile', 'fixture-host', executable, fs, run)).toBe(true)
  expect(hasMacSingletonOwner('/other', 'fixture-host', executable, fs, run)).toBe(false)
  expect(hasMacSingletonOwner('/scratch/profile', 'other-host', executable, fs, run)).toBe(false)
  command =
    '/other/browser --user-data-dir=/scratch/profile --profile-directory=Platform --remote-debugging-pipe'
  expect(hasMacSingletonOwner('/scratch/profile', 'fixture-host', executable, fs, run)).toBe(false)
})

test('WKWebView reports its own transparent overlay while Chromium keeps native titlebar and opaque floor', () => {
  const native = shellBridge('http://localhost:123', 'wkwebview', 'token', 'darwin', true)
  expect(native).toContain('"backdrop":"transparent"')
  expect(native).toContain('"titlebar":"overlay"')
  expect(native).toContain('"platform":"darwin"')
  expect(native).toContain('[data-native-window-drag-region]')
  expect(native).toContain('[data-native-window-no-drag]')
  expect(shellBridge('http://localhost:123', 'chromium', undefined, 'darwin')).toContain(
    '"titlebar":"native"',
  )
  expect(shellBridge('http://localhost:123', 'chromium', undefined, 'darwin')).toContain(
    '"backdrop":"app"',
  )
})
