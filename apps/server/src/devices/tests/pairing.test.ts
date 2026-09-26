import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { authenticateWebSocketData, createAuthConfig } from '../../auth'
import { DeviceStore } from '../device-store'
import { DevicePairing } from '../service'

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
