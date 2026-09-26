import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, onTestFinished, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { authenticateWebSocketData, createAuthConfig } from '../../auth'
import { DeviceStore } from '../device-store'
import { DevicePairing } from '../service'
import { createAgentTerminalFixture } from '../../../test/factories/agent-terminal'
import { createInProcessTerminalSocket } from '../../../test/terminal-socket'
import { machineProxyAdapter } from '../../../test/machine-proxy'
import { machineProxyHeaders } from '../../machines/proxy-http'

const ORIGIN = 'https://omarchy.mesh.example'
const PHONE = '100.64.0.9'
const THIS_MACHINE = '100.64.0.1'
const homes: string[] = []

afterEach(async () => {
  await closeTestApps()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function pairingApp() {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const filePath = path.join(home, 'devices.json')
  const app = createTestApp({
    auth: { allowedOrigins: [ORIGIN] },
    settings: testSettingsOptions(home),
    workspaceRoot: home,
    devices: {
      filePath,
      cookieName: 'platform_device_test',
      ownAddresses: () => new Set([THIS_MACHINE]),
    },
  })
  return { app, filePath }
}

/** A request as the mesh proxy forwards it from `client`; null for one made on this machine. */
function request(url: string, client: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('origin', ORIGIN)
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

async function claim(app: ReturnType<typeof pairingApp>['app'], code: string) {
  return app.handle(
    request('/pairing/claim', PHONE, {
      method: 'POST',
      body: JSON.stringify({ code, label: 'iPhone · Safari' }),
      headers: { 'content-type': 'application/json' },
    }),
  )
}

test('this machine passes, directly or through the proxy; another device is refused until paired', async () => {
  const { app } = pairingApp()

  expect((await app.handle(request('/health', null))).status).toBe(200)
  expect((await app.handle(request('/health', '127.0.0.1'))).status).toBe(200)
  expect((await app.handle(request('/health', THIS_MACHINE))).status).toBe(200)
  const refused = await app.handle(request('/health', PHONE))
  expect(refused.status).toBe(401)
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
    'DEVICE_NOT_PAIRED',
  )
  const status = await app.handle(request('/pairing/status', PHONE))
  expect(await status.json()).toEqual({ trust: 'unpaired', required: true })
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

test('only this machine makes links, and a device cannot remove itself', async () => {
  const { app } = pairingApp()
  const credential = (await claim(app, await issueCode(app))).headers
    .get('set-cookie')!
    .split(';')[0]!
  const asPhone = { headers: { cookie: credential } }

  const link = await app.handle(request('/pairing/links', PHONE, { method: 'POST', ...asPhone }))
  expect(link.status).toBe(403)
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
    ownAddresses: () => new Set([THIS_MACHINE]),
  })
  const auth = createAuthConfig({ allowedOrigins: [ORIGIN] }, devices)
  const { code } = devices.issueLink(() => null)
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
    ownAddresses: () => new Set([THIS_MACHINE]),
    now: () => now,
  })
  const { code } = devices.issueLink(() => null)
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

test('through the machine proxy, an admitted device reaches the machine and an unpaired one stops here', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'platform-pairing-'))
  homes.push(home)
  const machineOrigin = 'http://localhost:5173'
  const machine = createTestApp({
    auth: { allowedOrigins: [machineOrigin] },
    settings: testSettingsOptions(path.join(home, 'machine')),
    workspaceRoot: home,
  })
  const devices = new DevicePairing({
    store: new DeviceStore(path.join(home, 'devices.json')),
    required: () => true,
    cookieName: 'platform_device_test',
    ownAddresses: () => new Set([THIS_MACHINE]),
  })
  const auth = createAuthConfig({ allowedOrigins: [ORIGIN] }, devices)
  const { app } = machineProxyAdapter({
    auth,
    resolve: () => ({ origin: 'http://machine', webOrigin: machineOrigin }),
    fetcher: (url, init) => machine.handle(new Request(url, init)),
  })
  const { code } = devices.issueLink(() => null)
  const cookie = devices.claim({ code, label: 'iPhone · Safari' }, true).cookie.split(';')[0]!
  const through = (headers: Record<string, string>) =>
    app.handle(
      new Request('http://local/platform-api/machines/mac/proxy/health', {
        headers: { origin: ORIGIN, 'x-forwarded-for': PHONE, ...headers },
      }),
    )

  expect((await through({ cookie })).status).toBe(200)
  expect((await through({})).status).toBe(401)
  // The socket relay sends the same headers: the machine admits it as its own hop.
  const upgrade = new Request('http://local/machines/mac/proxy/orchestration/rpc', {
    headers: { origin: ORIGIN, 'x-forwarded-for': PHONE, cookie, upgrade: 'websocket' },
  })
  const relayed = Object.fromEntries(machineProxyHeaders(upgrade, machineOrigin))
  const machineAuth = createAuthConfig(
    { allowedOrigins: [machineOrigin] },
    new DevicePairing({
      store: new DeviceStore(path.join(home, 'machine-devices.json')),
      required: () => true,
      cookieName: 'platform_device_test',
      ownAddresses: () => new Set(),
    }),
  )
  expect(authenticateWebSocketData({ headers: relayed }, machineAuth)).toBeNull()
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
