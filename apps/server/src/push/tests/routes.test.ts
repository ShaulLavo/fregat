import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pushDeviceId, type PushDevices } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../../test/server'
import {
  createPushSubscriber,
  verifyVapidAuthorization,
  type PushSubscriber,
} from '../../../test/factories/push-subscriber'
import type { App } from '../../app'
import type { PushFetcher } from '../delivery'
import { testSettingsOptions } from '../../settings/testing'

const LOCAL_ORIGIN = 'http://localhost:5173'
const MESH_ORIGIN = 'https://omarchy.example.test'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-one'

type PushedRequest = { url: string; headers: Headers; body: Uint8Array }

const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('push routes', () => {
  it('generates one VAPID key into the secret store and serves only its public half', async () => {
    const root = await tempRoot()
    const first = await readDevices(pushApp(root).app)
    const again = await readDevices(pushApp(root).app)

    expect(Buffer.from(first.publicKey, 'base64url')).toHaveLength(65)
    expect(again.publicKey).toBe(first.publicKey)
    const secretsFile = path.join(root, '.platform-test', 'secrets.json')
    const secrets = JSON.parse(await readFile(secretsFile, 'utf8'))
    expect(Object.keys(secrets)).toEqual(['push.vapid.privateKey'])
    expect(JSON.stringify(first)).not.toContain(secrets['push.vapid.privateKey'])
    expect((await stat(secretsFile)).mode & 0o777).toBe(0o600)
  })

  it('registers a device once per endpoint, keeps its first date, and removes it', async () => {
    const { app } = pushApp(await tempRoot())
    const first = await register(app, createPushSubscriber(ENDPOINT), 'Chrome on Linux')
    const renewed = await register(app, createPushSubscriber(ENDPOINT), 'Chrome on Linux')

    expect(renewed.id).toBe(await pushDeviceId(ENDPOINT))
    expect(renewed).toMatchObject({ id: first.id, createdAt: first.createdAt, service: 'google' })
    expect((await readDevices(app)).devices).toEqual([renewed])

    expect(await removeDevice(app, first.id)).toEqual({ removed: true })
    expect(await removeDevice(app, first.id)).toEqual({ removed: false })
    expect((await readDevices(app)).devices).toEqual([])
  })

  it('refuses bad keys and http beyond loopback, and accepts a loopback stand-in', async () => {
    const { app } = pushApp(await tempRoot())
    const subscriber = createPushSubscriber(ENDPOINT)
    const offCurve = Buffer.alloc(65, 7)
    offCurve[0] = 4

    const badKey = await post(app, '/push/devices', {
      label: 'Broken',
      subscription: {
        ...subscriber.subscription,
        keys: { ...subscriber.subscription.keys, p256dh: offCurve.toString('base64url') },
      },
    })
    const plainHttp = await post(app, '/push/devices', {
      label: 'Broken',
      subscription: { ...subscriber.subscription, endpoint: 'http://push.example.test/one' },
    })
    const shortAuth = await post(app, '/push/devices', {
      label: 'Broken',
      subscription: {
        ...subscriber.subscription,
        keys: { ...subscriber.subscription.keys, auth: Buffer.alloc(12, 1).toString('base64url') },
      },
    })

    for (const response of [badKey, plainHttp, shortAuth]) {
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatchObject({ code: 'push.SUBSCRIPTION_INVALID' })
    }
    expect((await readDevices(app)).devices).toEqual([])

    const loopback = await register(
      app,
      createPushSubscriber('http://127.0.0.1:9/push/x'),
      'Local stand-in',
    )
    expect(loopback.service).toBe('other')
    expect((await readDevices(app)).devices).toEqual([loopback])
  })

  it('refuses a malformed registration with the push catalog and echoes no key', async () => {
    const { app } = pushApp(await tempRoot())
    const subscriber = createPushSubscriber(`${ENDPOINT}-echo-marker`)
    const { auth, p256dh } = subscriber.subscription.keys
    const bodies = [
      { label: 'Broken', subscription: { ...subscriber.subscription, endpoint: 'not a url' } },
      {
        label: 'Broken',
        subscription: { ...subscriber.subscription, keys: { auth, p256dh: 'A'.repeat(200) } },
      },
      {
        label: 'Broken',
        subscription: { ...subscriber.subscription, keys: { auth: `${auth}+/`, p256dh } },
      },
      { label: 'L'.repeat(81), subscription: subscriber.subscription },
      { label: '   ', subscription: subscriber.subscription },
    ]

    for (const body of bodies) {
      const response = await post(app, '/push/devices', body)
      const text = await response.text()
      expect(response.status).toBe(400)
      expect(JSON.parse(text).error).toMatchObject({ code: 'push.SUBSCRIPTION_INVALID' })
      for (const secret of [subscriber.subscription.endpoint, auth, p256dh])
        expect(text).not.toContain(secret)
    }
    expect((await readDevices(app)).devices).toEqual([])
  })

  it('sends a test push signed with the VAPID key and encrypted for the device', async () => {
    const pushed: PushedRequest[] = []
    const { app } = pushApp(await tempRoot(), async (url, init) => {
      pushed.push(await capture(url, init))
      return new Response(null, { status: 201 })
    })
    const subscriber = createPushSubscriber(ENDPOINT)
    const device = await register(app, subscriber, 'Safari on iPhone', MESH_ORIGIN)
    const { publicKey } = await readDevices(app)

    const response = await post(app, `/push/devices/${device.id}/test`, undefined, MESH_ORIGIN)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 201 })
    expect(pushed).toHaveLength(1)
    const [request] = pushed
    expect(request?.url).toBe(ENDPOINT)
    expect(request?.headers.get('content-encoding')).toBe('aes128gcm')
    expect(request?.headers.get('ttl')).toBe('300')
    expect(request?.headers.get('urgency')).toBe('high')
    expect(request?.headers.get('topic')).toBe('push-test')
    const claims = await verifyVapidAuthorization(
      request?.headers.get('authorization') ?? null,
      publicKey,
    )
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: MESH_ORIGIN })
    expect(JSON.parse(subscriber.decrypt(request?.body ?? new Uint8Array()))).toEqual({
      title: 'Test notification',
      body: 'Push notifications from this server reach this device.',
      tag: 'push-test',
      path: '',
    })
  })

  it('reports an expired device when the push service answers 404 or 410, and removes the row', async () => {
    for (const status of [404, 410]) {
      const { app } = pushApp(await tempRoot(), async () => new Response('gone', { status }))
      const device = await register(app, createPushSubscriber(ENDPOINT), 'Firefox on Linux')

      const response = await post(app, `/push/devices/${device.id}/test`)

      expect(response.status).toBe(410)
      const { error } = await response.json()
      expect(error).toMatchObject({ code: 'push.SUBSCRIPTION_EXPIRED' })
      expect(error.fix).toBe('Turn push notifications on again on that device.')
      expect((await readDevices(app)).devices).toEqual([])
    }
  })

  it('reports a push service that refuses or cannot be reached', async () => {
    let answer: () => Promise<Response> = async () => new Response(null, { status: 403 })
    const { app } = pushApp(await tempRoot(), () => answer())
    const device = await register(app, createPushSubscriber(ENDPOINT), 'Chrome on Linux')

    const refused = await post(app, `/push/devices/${device.id}/test`)
    answer = async () => {
      throw new TypeError('fetch failed')
    }
    const unreachable = await post(app, `/push/devices/${device.id}/test`)
    const unknown = await post(app, '/push/devices/missing/test')

    expect(refused.status).toBe(502)
    expect((await refused.json()).error).toMatchObject({
      code: 'push.PUSH_SERVICE_REJECTED',
      message: 'The push service refused the notification (HTTP 403)',
    })
    expect(unreachable.status).toBe(502)
    expect((await unreachable.json()).error.code).toBe('push.PUSH_SERVICE_UNREACHABLE')
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).error.code).toBe('push.DEVICE_NOT_FOUND')
  })
})

async function tempRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'push-routes-'))
  roots.push(root)
  return root
}

function pushApp(root: string, fetcher?: PushFetcher) {
  const app = createTestApp({
    auth: { allowedOrigins: [LOCAL_ORIGIN, MESH_ORIGIN] },
    push: { fetcher: fetcher ?? (async () => new Response(null, { status: 201 })) },
    settings: testSettingsOptions(root),
    workspaceRoot: root,
  })
  return { app }
}

async function capture(url: string, init: RequestInit): Promise<PushedRequest> {
  const request = new Request(url, init)
  return {
    url,
    headers: request.headers,
    body: new Uint8Array(await request.arrayBuffer()),
  }
}

async function readDevices(app: App): Promise<PushDevices> {
  const response = await app.handle(request('/push/devices', { method: 'GET' }))
  expect(response.status).toBe(200)
  return response.json()
}

async function register(
  app: App,
  subscriber: PushSubscriber,
  label: string,
  origin = LOCAL_ORIGIN,
): Promise<PushDevices['devices'][number]> {
  const response = await post(
    app,
    '/push/devices',
    { label, subscription: subscriber.subscription },
    origin,
  )
  expect(response.status).toBe(200)
  return (await response.json()).device
}

async function removeDevice(app: App, id: string) {
  const response = await app.handle(request(`/push/devices/${id}`, { method: 'DELETE' }))
  expect(response.status).toBe(200)
  return response.json()
}

function post(app: App, pathname: string, body?: unknown, origin = LOCAL_ORIGIN) {
  return app.handle(
    request(
      pathname,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      origin,
    ),
  )
}

function request(pathname: string, init: RequestInit, origin = LOCAL_ORIGIN) {
  const headers = new Headers(init.headers)
  headers.set('origin', origin)
  return new Request(`http://localhost${pathname}`, { ...init, headers })
}
