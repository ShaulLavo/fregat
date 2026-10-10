import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, onTestFinished, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { authenticateWebSocketData, createAuthConfig } from '../../auth'
import { DeviceStore } from '../device-store'
import { DevicePairing } from '../service'
import { TailnetOwners, type TailnetLookup, type TailnetNode } from '../tailnet-owner'
import { pairServerAddress, pairingCodeText, requestPairingCode } from '../pair-command'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { createInProcessTerminalSocket } from '../../../test/terminal-socket'
import { machineProxyAdapter } from '../../../test/machine-proxy'
import { captureRequestHeaders, headersReader } from '../trust'
import { pairMachineRelay } from '../../machines/pairing'
import type { MachineProxyTarget } from '../../machines/proxy'
import { machineProxyHeaders } from '../../machines/proxy-http'

const ORIGIN = 'https://fregat.example'
const PHONE = '100.64.0.9'
const THIS_MACHINE = '100.64.0.1'
const TABLET = '100.64.0.10'
const LOOPBACK = 'http://127.0.0.1:3301'
const homes: string[] = []

afterEach(async () => {
  await closeTestApps()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const OWNER: TailnetNode = { login: 'owner@example.com', tagged: false, shared: false }

/** A tailnet where this machine is the owner's, and `nodes` names every other address's node. */
function fakeTailnet(nodes: Record<string, TailnetNode>) {
  const asked: string[] = []
  const lookup: TailnetLookup = {
    selfAddress: () => Promise.resolve(THIS_MACHINE),
    whois: (address) => {
      asked.push(address)
      const node = address === THIS_MACHINE ? OWNER : nodes[address]
      return Promise.resolve(node ?? { failure: 'no-such-node' })
    },
  }
  return { lookup, asked }
}

function pairingApp(tailnet?: TailnetLookup) {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const filePath = path.join(home, 'devices.json')
  const settings = testSettingsOptions(home)
  mkdirSync(path.dirname(settings.userFilePath!), { recursive: true })
  writeFileSync(
    settings.userFilePath!,
    JSON.stringify({ 'environments.trustedProxyHosts': [new URL(ORIGIN).host] }),
  )
  const app = createTestApp({
    // The server's own loopback origin is allowed, as `index.ts` allows it.
    auth: { allowedOrigins: [ORIGIN, LOOPBACK] },
    webOrigin: ORIGIN,
    system: { webBase: '/platform/' },
    settings,
    workspaceRoot: home,
    devices: {
      filePath,
      cookieName: 'platform_device_test',

      tailnet: tailnet ?? fakeTailnet({}).lookup,
    },
  })
  return { app, filePath }
}

/** A request through a configured reverse proxy; null for a direct local request. */
function request(url: string, client: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('origin', ORIGIN)
  headers.set('host', client ? new URL(ORIGIN).host : new URL(LOOPBACK).host)
  if (client) {
    headers.set('x-forwarded-for', client)
    headers.set('x-forwarded-proto', 'https')
  }
  return new Request(`http://local${url}`, { ...init, headers })
}

async function issueCode(app: ReturnType<typeof pairingApp>['app']) {
  const response = await app.handle(request('/pairing/links', null, { method: 'POST' }))
  return ((await response.json()) as { code: string }).code
}

async function claim(app: ReturnType<typeof pairingApp>['app'], code: string, client = PHONE) {
  return app.handle(
    request('/pairing/claim', client, {
      method: 'POST',
      body: JSON.stringify({ code, label: 'iPhone · Safari' }),
      headers: { 'content-type': 'application/json' },
    }),
  )
}

test('a public proxy without forwarding metadata needs pairing', async () => {
  const { app } = pairingApp()
  const incoming = request('/pairing/status', PHONE)
  incoming.headers.delete('x-forwarded-for')
  incoming.headers.delete('x-forwarded-proto')
  expect(await (await app.handle(incoming)).json()).toMatchObject({ trust: 'unpaired' })
  const guarded = request('/health', PHONE)
  guarded.headers.delete('x-forwarded-for')
  guarded.headers.delete('x-forwarded-proto')
  expect((await app.handle(guarded)).status).toBe(401)
})

test('forwarded addresses require a configured proxy and a real loopback socket', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const fake = fakeTailnet({ [PHONE]: OWNER })
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',

    trustedProxyHosts: () => [new URL(ORIGIN).host],
    tailnet: new TailnetOwners({ lookup: fake.lookup, enabled: () => true }),
  })
  for (const peer of [null, '203.0.113.9']) {
    for (const claimed of [PHONE, '127.0.0.1', THIS_MACHINE]) {
      const headers = captureRequestHeaders(request('/health', claimed), peer)
      await devices.identify(headers)
      expect(devices.admit(headers).trust).toBe('unpaired')
    }
  }
  const unknownProxy = request('/health', PHONE)
  unknownProxy.headers.set('host', 'unknown.example')
  const headers = captureRequestHeaders(unknownProxy, '127.0.0.1')
  await devices.identify(headers)
  expect(devices.admit(headers).trust).toBe('unpaired')
  expect(fake.asked).toEqual([])
  expect(
    devices.admit(captureRequestHeaders(request('/pairing/status', null), '127.0.0.1')).trust,
  ).toBe('host')
  expect(devices.admit(headersReader(new Headers())).trust).toBe('unpaired')
  const missingHost = request('/pairing/status', null)
  missingHost.headers.delete('host')
  expect(devices.admit(captureRequestHeaders(missingHost, '127.0.0.1')).trust).toBe('unpaired')
})

test('a proxy without explicit trust uses pairing even for an owner device', async () => {
  const { app } = pairingApp(fakeTailnet({ [PHONE]: OWNER }).lookup)
  const written = await app.handle(
    request('/settings/write', null, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'user',
        mutationId: crypto.randomUUID(),
        operations: [{ kind: 'set', key: 'environments.trustedProxyHosts', value: [] }],
      }),
    }),
  )
  expect(written.status).toBe(200)
  expect((await app.handle(request('/health', PHONE))).status).toBe(401)
})

test('proxy markers prevent local host trust even when the proxy rewrites Host', async () => {
  const { app } = pairingApp()
  for (const marker of ['via', 'forwarded', 'x-real-ip', 'x-forwarded-custom']) {
    const incoming = request('/pairing/status', null, { headers: { [marker]: 'proxy' } })
    expect(await (await app.handle(incoming)).json()).toMatchObject({ trust: 'unpaired' })
  }
})

test('direct local access passes; forwarded requests use tailnet identity or pairing', async () => {
  const { app } = pairingApp()

  expect((await app.handle(request('/health', null))).status).toBe(200)
  expect((await app.handle(request('/health', '127.0.0.1'))).status).toBe(401)
  expect((await app.handle(request('/health', THIS_MACHINE))).status).toBe(200)
  const refused = await app.handle(request('/health', PHONE))
  expect(refused.status).toBe(401)
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
    'DEVICE_NOT_PAIRED',
  )
  const status = await app.handle(request('/pairing/status', PHONE))
  // Reachable before pairing, so it names the machine and nothing more.
  expect(await status.json()).toEqual({ trust: 'unpaired', required: true, machine: hostname() })
})

test('a claimed link pairs the device with an HttpOnly cookie that works from then on', async () => {
  const { app, filePath } = pairingApp()
  const code = await issueCode(app)
  const claimed = await claim(app, code)
  const cookie = claimed.headers.get('set-cookie') ?? ''

  expect(claimed.status).toBe(200)
  expect(cookie).toMatch(/^platform_device_test=[^;]+; Path=\/; HttpOnly; SameSite=Strict/)
  expect(cookie).toContain('Secure')
  const credential = cookie.split(';')[0]!
  const paired = await app.handle(request('/health', PHONE, { headers: { cookie: credential } }))
  expect(paired.status).toBe(200)
  // The file holds a hash of the secret, never the secret, and only its owner reads it.
  const secret = credential.split('.')[1]!
  expect(readFileSync(filePath, 'utf8')).not.toContain(secret)
  expect(statSync(filePath).mode & 0o777).toBe(0o600)
  expect((await claim(app, code)).status).toBe(400)
})

test('a paired device makes a code that pairs the next device; an unpaired one is refused', async () => {
  const { app } = pairingApp()
  const credential = (await claim(app, await issueCode(app))).headers
    .get('set-cookie')!
    .split(';')[0]!
  const asPhone = { headers: { cookie: credential } }

  const refused = await app.handle(request('/pairing/links', TABLET, { method: 'POST' }))
  expect(refused.status).toBe(403)
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
    'pairing.PAIRED_ONLY',
  )
  const link = await app.handle(request('/pairing/links', PHONE, { method: 'POST', ...asPhone }))
  expect(link.status).toBe(200)
  const { code, url } = (await link.json()) as { code: string; url: string }
  expect(url).toBe(`${ORIGIN}/platform/pair#token=${code}`)
  const tablet = await claim(app, code, TABLET)
  expect(tablet.status).toBe(200)
  const asTablet = { headers: { cookie: tablet.headers.get('set-cookie')!.split(';')[0]! } }
  expect((await app.handle(request('/health', TABLET, asTablet))).status).toBe(200)
})

test('a device cannot remove itself; another device or the machine can', async () => {
  const { app } = pairingApp()
  const credential = (await claim(app, await issueCode(app))).headers
    .get('set-cookie')!
    .split(';')[0]!
  const asPhone = { headers: { cookie: credential } }

  const listed = await app.handle(request('/pairing/devices', PHONE, asPhone))
  const { devices } = (await listed.json()) as { devices: { id: string; current: boolean }[] }
  expect(devices).toEqual([expect.objectContaining({ current: true, label: 'iPhone · Safari' })])
  const self = await app.handle(
    request(`/pairing/devices/${devices[0]!.id}`, PHONE, { method: 'DELETE', ...asPhone }),
  )
  expect(self.status).toBe(409)

  const removed = await app.handle(
    request(`/pairing/devices/${devices[0]!.id}`, null, { method: 'DELETE' }),
  )
  expect(removed.status).toBe(200)
  expect((await app.handle(request('/health', PHONE, asPhone))).status).toBe(401)
})

test('the setting turned off lets every allowed origin in again', async () => {
  const { app } = pairingApp()
  const written = await app.handle(
    request('/settings/write', null, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'user',
        mutationId: crypto.randomUUID(),
        operations: [{ kind: 'set', key: 'environments.devicePairing', value: false }],
      }),
    }),
  )
  expect(written.status).toBe(200)
  expect((await app.handle(request('/health', PHONE))).status).toBe(200)
})

test('a socket from an unpaired device is refused, and one carrying the cookie is let in', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',
  })
  const auth = createAuthConfig({ allowedOrigins: [ORIGIN] }, devices)
  const { code } = devices.issueLink(
    captureRequestHeaders(request('/pairing/status', null), '127.0.0.1'),
  )
  const { cookie } = devices.claim({ code, label: 'Pixel · Chrome' }, true)
  const socket = (extra: Record<string, string>) => ({
    headers: { origin: ORIGIN, 'x-forwarded-for': PHONE, ...extra },
  })

  expect(authenticateWebSocketData(socket({}), auth)?.code).toBe('DEVICE_NOT_PAIRED')
  expect(authenticateWebSocketData(socket({ cookie: cookie.split(';')[0]! }), auth)).toBeNull()
})

test('removing a device closes the sockets it holds open, such as a terminal', async () => {
  const fixture = await createAgentTerminalFixture()
  onTestFinished(() => fixture.close())
  const origin = 'platform-tui://local'
  const phone = { origin, 'x-forwarded-for': PHONE, 'content-type': 'application/json' }
  const link = await fixture.app.handle(
    new Request('http://local/pairing/links', { method: 'POST', headers: { origin } }),
  )
  const { code } = (await link.json()) as { code: string }
  const claimed = await fixture.app.handle(
    new Request('http://local/pairing/claim', {
      method: 'POST',
      headers: phone,
      body: JSON.stringify({ code, label: 'iPhone · Safari' }),
    }),
  )
  const cookie = claimed.headers.get('set-cookie')!.split(';')[0]!
  const terminal = createInProcessTerminalSocket(
    fixture.app,
    { worktreeId: fixture.worktreeId, terminalId: 'phone-shell' },
    origin,
    { 'x-forwarded-for': PHONE, cookie },
  )
  await terminal.open()
  expect(terminal.closes).toEqual([])

  const devices = await fixture.app.handle(
    new Request('http://local/pairing/devices', { headers: { origin } }),
  )
  const [device] = ((await devices.json()) as { devices: { id: string }[] }).devices
  await fixture.app.handle(
    new Request(`http://local/pairing/devices/${device!.id}`, {
      method: 'DELETE',
      headers: { origin },
    }),
  )

  expect(terminal.closes).toEqual([{ code: 1008, reason: 'device removed' }])
})

test('the idle sweep drops a device unseen for 30 days and closes what it held', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  let now = Date.parse('2026-09-26T12:00:00Z')
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',

    now: () => now,
  })
  const { code } = devices.issueLink(
    captureRequestHeaders(request('/pairing/status', null), '127.0.0.1'),
  )
  const { cookie } = devices.claim({ code, label: 'Pixel · Chrome' }, true)
  const header = (name: string) =>
    ({ 'x-forwarded-for': PHONE, cookie: cookie.split(';')[0]! })[name] ?? null
  const closed: string[] = []
  devices.hold(header, () => closed.push('terminal'))

  now += 31 * 24 * 60 * 60_000
  devices.sweep()

  expect(closed).toEqual(['terminal'])
  expect(devices.list(null)).toEqual([])
})

test('a machine proxy requires admission at both the relay and its destination', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const machineOrigin = 'http://localhost:5173'
  const machine = createTestApp({
    auth: { allowedOrigins: [machineOrigin] },
    settings: testSettingsOptions(path.join(home, 'machine')),
    workspaceRoot: home,
    devices: {
      filePath: path.join(home, 'machine-devices.json'),
      cookieName: 'platform_device_test',
    },
  })
  const destinationFetch: typeof fetch = Object.assign(
    (url: Parameters<typeof fetch>[0], init?: RequestInit) =>
      machine.handle(new Request(String(url), init)),
    { preconnect: fetch.preconnect },
  )
  let relayCookie = await pairMachineRelay(
    'http://127.0.0.1:31001',
    machineOrigin,
    'Fregat relay · workstation',
    'source-environment',
    destinationFetch,
  )
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',
  })
  const auth = createAuthConfig({ allowedOrigins: [ORIGIN] }, devices)
  let renewals = 0
  const resolve = (): MachineProxyTarget => ({
    origin: 'http://127.0.0.1:31001',
    webOrigin: machineOrigin,
    cookie: relayCookie,
    refresh: async () => {
      renewals++
      relayCookie = await pairMachineRelay(
        'http://127.0.0.1:31001',
        machineOrigin,
        'Fregat relay · workstation',
        'source-environment',
        destinationFetch,
      )
      return resolve()
    },
  })
  const { app } = machineProxyAdapter({
    auth,
    resolve,
    fetcher: (url, init) => machine.handle(new Request(url, init)),
  })
  const { code } = devices.issueLink(
    captureRequestHeaders(request('/pairing/status', null), '127.0.0.1'),
  )
  const cookie = devices.claim({ code, label: 'iPhone · Safari' }, true).cookie.split(';')[0]!
  const through = (headers: Record<string, string>) =>
    app.handle(
      new Request('http://local/platform-api/machines/mac/proxy/health', {
        headers: { origin: ORIGIN, 'x-forwarded-for': PHONE, ...headers },
      }),
    )

  expect((await through({ cookie })).status).toBe(200)
  expect((await through({})).status).toBe(401)
  // A relay hop also needs admission at its destination.
  const upgrade = new Request('http://local/machines/mac/proxy/orchestration/rpc', {
    headers: {
      origin: ORIGIN,
      'x-forwarded-for': PHONE,
      'x-forwarded-custom': 'client-metadata',
      authorization: 'Bearer source-only',
      cookie,
      upgrade: 'websocket',
    },
  })
  const relayed = Object.fromEntries(machineProxyHeaders(upgrade, machineOrigin, relayCookie))
  const machineAuth = createAuthConfig(
    { allowedOrigins: [machineOrigin] },
    new DevicePairing({
      store: new DeviceStore(path.join(home, 'machine-devices.json')),
      required: () => true,
      cookieName: 'platform_device_test',
    }),
  )
  expect(relayed['x-forwarded-custom']).toBeUndefined()
  expect(relayed.authorization).toBeUndefined()
  expect(relayed.cookie).toBe(relayCookie)
  expect(relayed.cookie).not.toBe(cookie)
  expect(authenticateWebSocketData({ headers: relayed }, machineAuth)).toBeNull()
  delete relayed.cookie
  expect(authenticateWebSocketData({ headers: relayed }, machineAuth)?.code).toBe(
    'DEVICE_NOT_PAIRED',
  )
  const previousCookie = relayCookie
  relayCookie = await pairMachineRelay(
    'http://127.0.0.1:31001',
    machineOrigin,
    'Fregat relay · renamed-workstation',
    'source-environment',
    destinationFetch,
  )
  const listed = await destinationFetch('http://127.0.0.1:31001/pairing/devices', {
    headers: { origin: machineOrigin },
  })
  const listing = (await listed.json()) as { devices: Array<{ id: string }> }
  expect(listing).toMatchObject({
    devices: [{ label: 'Fregat relay · renamed-workstation' }],
  })
  const stored = JSON.parse(readFileSync(path.join(home, 'machine-devices.json'), 'utf8')) as {
    devices: unknown[]
  }
  expect(stored.devices).toHaveLength(1)
  const refused = await destinationFetch('http://127.0.0.1:31001/health', {
    headers: { origin: machineOrigin, via: '1.1 fregat', cookie: previousCookie },
  })
  expect(refused.status).toBe(401)
  expect((await through({ cookie })).status).toBe(200)
  const removed = await destinationFetch(
    `http://127.0.0.1:31001/pairing/devices/${listing.devices[0]!.id}`,
    {
      method: 'DELETE',
      headers: { origin: machineOrigin },
    },
  )
  expect(removed.status).toBe(200)
  expect((await through({ cookie })).status).toBe(200)
  expect(renewals).toBe(1)

  const link = await destinationFetch('http://127.0.0.1:31001/pairing/links', {
    method: 'POST',
    headers: { origin: machineOrigin },
  })
  const linkBody = (await link.json()) as { code: string }
  const claimedThroughRelay = await app.handle(
    new Request('http://local/platform-api/machines/mac/proxy/pairing/claim', {
      method: 'POST',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: linkBody.code, label: 'Another browser' }),
    }),
  )
  expect(claimedThroughRelay.status).toBe(200)
  expect(claimedThroughRelay.headers.has('set-cookie')).toBe(false)
  expect((await through({ cookie })).status).toBe(200)
})

test('a claim from a page on another origin is refused before the code is looked at', async () => {
  const { app } = pairingApp()
  const code = await issueCode(app)
  const foreign = await app.handle(
    new Request('http://local/pairing/claim', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-forwarded-for': PHONE,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ code, label: 'iPhone · Safari' }),
    }),
  )

  expect(foreign.status).toBe(403)
  expect((await claim(app, code)).status).toBe(200)
})

test('the owner’s own Tailscale device passes without pairing; other nodes still pair', async () => {
  const tailnet = fakeTailnet({
    [PHONE]: OWNER,
    '100.64.0.20': { login: 'guest@example.com', tagged: false, shared: false },
    '100.64.0.21': { ...OWNER, tagged: true },
    '100.64.0.22': { ...OWNER, shared: true },
  })
  const { app } = pairingApp(tailnet.lookup)

  expect((await app.handle(request('/health', PHONE))).status).toBe(200)
  const status = await app.handle(request('/pairing/status', PHONE))
  expect(await status.json()).toEqual({ trust: 'tailnet', required: true, machine: hostname() })
  for (const other of ['100.64.0.20', '100.64.0.21', '100.64.0.22', '100.64.0.23'])
    expect((await app.handle(request('/health', other))).status).toBe(401)
  // Only tailnet addresses reach Tailscale; a public one never spawns a lookup.
  expect((await app.handle(request('/health', '203.0.113.7'))).status).toBe(401)
  expect(tailnet.asked).not.toContain('203.0.113.7')
  // Answers are kept for a minute: a second request asks nothing.
  const before = tailnet.asked.length
  expect((await app.handle(request('/health', PHONE))).status).toBe(200)
  expect(tailnet.asked.length).toBe(before)
})

test('a forwarded chain or a missing Tailscale leaves the owner’s device pairing', async () => {
  const { app } = pairingApp(fakeTailnet({ [PHONE]: OWNER }).lookup)
  expect((await app.handle(request('/health', `${PHONE}, 203.0.113.7`))).status).toBe(401)
  expect((await app.handle(request('/health', `203.0.113.7, ${PHONE}`))).status).toBe(401)

  const absent = pairingApp({
    selfAddress: () => Promise.resolve({ failure: 'not-installed' }),
    whois: () => Promise.resolve({ failure: 'not-installed' }),
  }).app
  expect((await absent.handle(request('/health', PHONE))).status).toBe(401)
  const throwing = pairingApp({
    selfAddress: () => Promise.reject(new TypeError('boom')),
    whois: () => Promise.reject(new TypeError('boom')),
  }).app
  expect((await throwing.handle(request('/health', PHONE))).status).toBe(401)
})

test('the Tailscale setting turned off makes the owner’s device pair', async () => {
  const { app } = pairingApp(fakeTailnet({ [PHONE]: OWNER }).lookup)
  const written = await app.handle(
    request('/settings/write', null, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'user',
        mutationId: crypto.randomUUID(),
        operations: [{ kind: 'set', key: 'environments.tailnetOwnerDevices', value: false }],
      }),
    }),
  )
  expect(written.status).toBe(200)
  expect((await app.handle(request('/health', PHONE))).status).toBe(401)
})

test('a socket from the owner’s Tailscale device is let in once its address is identified', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  let now = 0
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',

    trustedProxyHosts: () => [new URL(ORIGIN).host],
    tailnet: new TailnetOwners({
      lookup: fakeTailnet({ [PHONE]: OWNER }).lookup,
      enabled: () => true,
      now: () => now,
    }),
  })
  const auth = createAuthConfig({ allowedOrigins: [ORIGIN] }, devices)
  const upgrade = request('/terminal', PHONE)
  const header = captureRequestHeaders(upgrade, '127.0.0.1')
  const data = { request: upgrade, headers: { origin: ORIGIN, 'x-forwarded-for': PHONE } }

  // Unknown until asked: admission never waits on Tailscale, so it refuses.
  expect(authenticateWebSocketData(data, auth)?.code).toBe('DEVICE_NOT_PAIRED')
  await devices.identify(header)
  expect(authenticateWebSocketData(data, auth)).toBeNull()
  // A stale answer is no answer.
  now += 61_000
  expect(authenticateWebSocketData(data, auth)?.code).toBe('DEVICE_NOT_PAIRED')
})

test('a Tailscale-admitted socket closes once Tailscale or the setting stops vouching for it', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  let now = 0
  let enabled = true
  let trustedHosts = [new URL(ORIGIN).host]
  const nodes: Record<string, TailnetNode> = { [PHONE]: OWNER, '100.64.0.30': OWNER }
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',

    trustedProxyHosts: () => trustedHosts,
    tailnet: new TailnetOwners({
      lookup: fakeTailnet(nodes).lookup,
      enabled: () => enabled,
      now: () => now,
    }),
  })
  const header = (address: string) =>
    captureRequestHeaders(request('/terminal', address), '127.0.0.1')
  const closed: string[] = []
  for (const address of [PHONE, '100.64.0.30']) {
    await devices.identify(header(address))
    devices.hold(header(address), () => closed.push(address))
  }

  await devices.recheckTailnet()
  expect(closed).toEqual([])
  nodes['100.64.0.30'] = { ...OWNER, tagged: true }
  now += 61_000
  await devices.recheckTailnet()
  expect(closed).toEqual(['100.64.0.30'])
  trustedHosts = []
  await devices.recheckTailnet()
  expect(closed).toEqual(['100.64.0.30', PHONE])
  trustedHosts = [new URL(ORIGIN).host]
  devices.hold(header(PHONE), () => closed.push('setting-off'))
  enabled = false
  await devices.recheckTailnet()
  expect(closed).toEqual(['100.64.0.30', PHONE, 'setting-off'])
})

test('re-pairing a relay replaces its prior device and closes its sockets', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const store = new DeviceStore(path.join(home, 'devices.json'))
  const devices = new DevicePairing({ store, required: () => true, cookieName: 'relay_device' })
  const host = captureRequestHeaders(request('/pairing/status', null), '127.0.0.1')
  const browser = devices.claim({ code: devices.issueLink(host).code, label: 'Browser' }, false)
  const other = devices.claim(
    { code: devices.issueLink(host).code, label: 'Other relay', relaySourceId: 'other-source' },
    false,
  )
  const first = devices.claim(
    {
      code: devices.issueLink(host).code,
      label: 'Fregat relay · workstation',
      relaySourceId: 'source-server',
    },
    false,
  )
  const cookie = first.cookie.split(';')[0]!
  const header = headersReader(new Headers({ cookie }))
  let closed = false
  devices.hold(header, () => {
    closed = true
  })
  const second = devices.claim(
    {
      code: devices.issueLink(host).code,
      label: 'Fregat relay · renamed-workstation',
      relaySourceId: 'source-server',
    },
    false,
  )
  expect(store.list()).toHaveLength(3)
  expect(store.list().map((device) => device.id)).toEqual([
    browser.deviceId,
    other.deviceId,
    second.deviceId,
  ])
  expect(store.list()[2]).toMatchObject({
    id: second.deviceId,
    label: 'Fregat relay · renamed-workstation',
    relaySourceId: 'source-server',
  })
  expect(second.deviceId).not.toBe(first.deviceId)
  expect(closed).toBe(true)
  expect(devices.admit(header).trust).toBe('unpaired')
  expect(
    devices.admit(headersReader(new Headers({ cookie: second.cookie.split(';')[0]! }))).trust,
  ).toBe('device')
})

test('the pair command prints a code the server made over loopback, and its link', async () => {
  const { app } = pairingApp()
  const link = await requestPairingCode(LOOPBACK, (url, init) => app.handle(new Request(url, init)))

  expect(link.url).toBe(`${ORIGIN}/platform/pair#token=${link.code}`)
  const text = pairingCodeText(link)
  expect(text).toContain(`Pairing code: ${link.code.match(/.{4}/g)!.join(' ')}`)
  expect(text).toContain(`Link: ${link.url}`)
  expect((await claim(app, link.code)).status).toBe(200)
})

test('the pair command reports a server that refuses it', async () => {
  const { app } = pairingApp()
  // Through the proxy from another device: the server refuses, and the command says so.
  const forwarded = (url: string, init: RequestInit) =>
    app.handle(
      new Request(url, { ...init, headers: { origin: LOOPBACK, 'x-forwarded-for': PHONE } }),
    )
  await expect(requestPairingCode(LOOPBACK, forwarded)).rejects.toMatchObject({
    code: 'pairing.SERVER_REFUSED',
  })
})

test('the pair command finds the server through --address, then the server.address setting', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pair-command-'))
  homes.push(home)

  expect(pairServerAddress([], home)).toBe(LOOPBACK)
  writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ 'server.address': 'http://127.0.0.1:4100' }),
  )
  expect(pairServerAddress([], home)).toBe('http://127.0.0.1:4100')
  expect(pairServerAddress(['--address=http://127.0.0.1:3001/'], home)).toBe(
    'http://127.0.0.1:3001',
  )
})
