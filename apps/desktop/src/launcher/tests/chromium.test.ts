import { expect, test } from 'vitest'
import { assertChromiumVersion, attachChromium, chromiumBridge } from '../chromium'
import type { CdpEvent } from '../cdp'
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
  expect(roots).toEqual(['/work/platform-dev/home', '/home/test/.platform', '/fixtures/test'])
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
  expect(
    chromiumArguments(flatpak, '/fixtures/profile', 'http://localhost:123/').slice(0, 5),
  ).toEqual([
    'run',
    '--filesystem=/fixtures/profile',
    '--forward-fd=3',
    '--forward-fd=4',
    'org.chromium.Chromium',
  ])
  expect(chromiumArguments(candidate, '/fixtures/profile', 'http://localhost:123/')).toContain(
    '--disable-extensions',
  )
})
test('production Mac Chromium keeps real keychain and system proxy arguments', () => {
  const mac = {
    ...candidate,
    executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    family: 'chrome',
  }
  expect(chromiumArguments(mac, '/fixtures/profile', 'http://127.0.0.1:123/')).toEqual([
    '--app=http://127.0.0.1:123/',
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
test('handlers precede discovery and bridge is installed before debugger resumes current and new pages', async () => {
  const calls: string[] = []
  const handlers = new Map<string, (event: CdpEvent) => void>()
  const cdp = {
    on: (method: string, callback: (event: CdpEvent) => void) => {
      calls.push(`on:${method}`)
      handlers.set(method, callback)
      return () => {}
    },
    request: async (method: string, _params: Record<string, unknown> = {}, session?: string) => {
      calls.push(`${session || 'browser'}:${method}`)
      if (method === 'Target.setAutoAttach')
        handlers.get('Target.attachedToTarget')!({
          method: 'Target.attachedToTarget',
          params: { sessionId: 'current', targetInfo: { type: 'page' } },
        })
      return {}
    },
  }
  const failures: unknown[] = []
  await attachChromium(
    cdp,
    'http://localhost:123/',
    () => {},
    (error) => failures.push(error),
  )
  handlers.get('Target.attachedToTarget')!({
    method: 'Target.attachedToTarget',
    params: { sessionId: 'new', targetInfo: { type: 'page' } },
  })
  for (let i = 0; i < 12; i++) await Promise.resolve()
  expect(calls.indexOf('on:Target.attachedToTarget')).toBeLessThan(
    calls.indexOf('browser:Target.setDiscoverTargets'),
  )
  for (const session of ['current', 'new']) {
    const sequence = calls.filter((call) => call.startsWith(session + ':'))
    expect(sequence).toEqual(
      [
        'Page.enable',
        'Runtime.enable',
        'Runtime.addBinding',
        'Page.addScriptToEvaluateOnNewDocument',
        'Runtime.evaluate',
        'Runtime.runIfWaitingForDebugger',
      ].map((method) => session + ':' + method),
    )
  }
  expect(failures).toEqual([])
})
test('bridge contract has native titlebar, native picker, current document injection and origin guard', () => {
  const script = chromiumBridge('http://localhost:123/platform/')
  expect(script).toContain('location.origin !== "http://localhost:123"')
  expect(script).toContain('"titlebar":"native"')
  expect(script).toContain('pickEntry')
  expect(script).toContain('globalThis.platformBridge =')
})

test('telemetry accepts only the attached app origin default execution context', async () => {
  const handlers = new Map<string, (event: CdpEvent) => void>()
  const opened: unknown[] = []
  const cdp = {
    on: (method: string, handler: (event: CdpEvent) => void) => {
      handlers.set(method, handler)
      return () => {}
    },
    request: async () => ({}),
  }
  await attachChromium(
    cdp,
    'http://localhost:123/',
    (event) => opened.push(event),
    () => {},
  )
  const emit = (method: string, params: Record<string, unknown>, sessionId = 'page') =>
    handlers.get(method)!({ method, params, sessionId })
  emit('Target.attachedToTarget', { sessionId: 'page', targetInfo: { type: 'page' } })
  emit('Runtime.executionContextCreated', {
    context: { id: 1, origin: 'http://foreign.test', auxData: { isDefault: true } },
  })
  emit('Runtime.bindingCalled', {
    executionContextId: 1,
    name: 'platformShellCall',
    payload: JSON.stringify({ origin: 'http://localhost:123', rafPerSecond: 60 }),
  })
  expect(opened).toEqual([])
  emit('Runtime.executionContextCreated', {
    context: { id: 2, origin: 'http://localhost:123', auxData: { isDefault: true } },
  })
  emit('Runtime.bindingCalled', {
    executionContextId: 2,
    name: 'platformShellCall',
    payload: JSON.stringify({ origin: 'http://localhost:123', rafPerSecond: 60 }),
  })
  expect(opened).toEqual([{ engine: 'chromium', rafPerSecond: 60 }])
  emit('Target.detachedFromTarget', { sessionId: 'page' })
  emit('Runtime.bindingCalled', {
    executionContextId: 2,
    name: 'platformShellCall',
    payload: JSON.stringify({ origin: 'http://localhost:123', rafPerSecond: 60 }),
  })
  expect(opened).toHaveLength(1)
})

test('duplicate CDP session binding reports share one native picker request', async () => {
  const handlers = new Map<string, (event: CdpEvent) => void>()
  const pending = Promise.withResolvers<string[]>()
  let picks = 0
  let replies = 0
  const cdp = {
    on: (method: string, callback: (event: CdpEvent) => void) => {
      handlers.set(method, callback)
      return () => {}
    },
    request: async (method: string, params: Record<string, unknown> = {}) => {
      if (
        method === 'Runtime.evaluate' &&
        String(params.expression).includes('__platformShellReply?.')
      )
        replies++
      return {}
    },
  }
  await attachChromium(
    cdp,
    'http://localhost:123/',
    () => {},
    () => {},
    async () => {
      picks++
      return pending.promise
    },
  )
  for (const sessionId of ['owner', 'inspector']) {
    handlers.get('Target.attachedToTarget')!({
      method: 'Target.attachedToTarget',
      params: { sessionId, targetInfo: { type: 'page' } },
    })
    handlers.get('Runtime.executionContextCreated')!({
      method: 'Runtime.executionContextCreated',
      sessionId,
      params: { context: { id: 1, origin: 'http://localhost:123', auxData: { isDefault: true } } },
    })
    handlers.get('Runtime.bindingCalled')!({
      method: 'Runtime.bindingCalled',
      sessionId,
      params: {
        name: 'platformShellCall',
        executionContextId: 1,
        payload: JSON.stringify({
          method: 'pickEntry',
          origin: 'http://localhost:123',
          id: 1,
          documentId: '01234567-0123-4567-8901-012345678901',
          options: { mode: 'folder' },
        }),
      },
    })
  }
  expect(picks).toBe(1)
  pending.resolve(['/fixture/資料'])
  for (let count = 0; count < 20; count++) await Promise.resolve()
  expect(replies).toBe(2)
})

test('startup enrolls pages attached while preparing and later failures keep their ordinary callback', async () => {
  const handlers = new Map<string, (event: CdpEvent) => void>()
  const first = Promise.withResolvers<Record<string, unknown>>()
  const second = Promise.withResolvers<Record<string, unknown>>()
  const later = Promise.withResolvers<Record<string, unknown>>()
  const failures: unknown[] = []
  const attach = (sessionId: string) =>
    handlers.get('Target.attachedToTarget')!({
      method: 'Target.attachedToTarget',
      params: { sessionId, targetInfo: { type: 'page' } },
    })
  const cdp = {
    on: (method: string, callback: (event: CdpEvent) => void) => {
      handlers.set(method, callback)
      return () => {}
    },
    request: async (method: string, _params: Record<string, unknown> = {}, session?: string) => {
      if (method === 'Target.setAutoAttach') attach('first')
      if (method !== 'Page.enable') return {}
      if (session === 'first') return first.promise
      if (session === 'second') return second.promise
      return later.promise
    },
  }
  let ready = false
  const startup = attachChromium(
    cdp,
    'http://localhost:123/',
    () => {},
    (error) => failures.push(error),
  ).then(() => {
    ready = true
  })
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(ready).toBe(false)
  attach('second')
  first.resolve({})
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(ready).toBe(false)
  second.resolve({})
  await startup
  expect(ready).toBe(true)
  attach('later')
  later.reject('fixture later failure')
  for (let i = 0; i < 4; i++) await Promise.resolve()
  expect(failures).toEqual(['fixture later failure'])
})
