import { test, expect } from '../../../../test/fixtures'
import { machineProxyClient, remoteMachineSocket } from '../../../../test/factories/machine-proxy'
import { createAuthConfig } from '../../../../../server/src/auth'
import { createMachineProxyRoutes } from '../../../../../server/src/machines/proxy'
import { machineProxyHeaders } from '../../../../../server/src/machines/proxy-http'
import { createMachineProxySocket } from '../../../../../server/src/machines/proxy-socket'
import {
  dispatchMachineProxySocket,
  machineProxyAdapter,
} from '../../../../../server/test/machine-proxy'

const browserOrigin = 'https://platform.example.test'
const remoteWebOrigin = 'http://localhost:5173'

test('relays raw HTTP bodies, query strings, statuses, and headers', async () => {
  const requests: Request[] = []
  const redirects: RequestRedirect[] = []
  const proxy = createMachineProxyRoutes({
    auth: createAuthConfig({ allowedOrigins: [browserOrigin] }),
    resolve: () => ({ origin: 'http://127.0.0.1:9001', webOrigin: remoteWebOrigin }),
    fetcher: async (url, init) => {
      const request = new Request(url, init)
      requests.push(request)
      redirects.push(request.redirect)
      return new Response(request.body, {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          connection: 'x-hop-response',
          'x-hop-response': 'remove',
          'x-fs-path': 'source.bin',
          'access-control-allow-origin': remoteWebOrigin,
        },
      })
    },
  })
  const bytes = new Uint8Array([0, 255, 128, 10])
  const response = await proxy.handle(
    new Request('http://local/machines/dev/proxy/files/a%2Fb?root=%2Frepo&raw=1', {
      method: 'POST',
      headers: {
        origin: browserOrigin,
        'content-type': 'application/octet-stream',
        authorization: 'local-secret',
        cookie: 'session=local-secret',
        connection: 'x-hop-request',
        'x-hop-request': 'remove',
        'x-client-instance': 'browser-tab',
      },
      body: bytes,
    }),
  )

  expect(response.status).toBe(206)
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  expect(requests[0]?.url).toBe('http://127.0.0.1:9001/files/a%2Fb?root=%2Frepo&raw=1')
  expect(requests[0]?.headers.get('origin')).toBe(remoteWebOrigin)
  expect(requests[0]?.headers.get('x-client-instance')).toBe('browser-tab')
  expect(requests[0]?.headers.has('x-hop-request')).toBe(false)
  expect(requests[0]?.headers.has('authorization')).toBe(false)
  expect(requests[0]?.headers.has('cookie')).toBe(false)
  expect(response.headers.get('x-fs-path')).toBe('source.bin')
  expect(response.headers.has('x-hop-response')).toBe(false)
  expect(response.headers.has('access-control-allow-origin')).toBe(false)
  expect(redirects).toEqual(['error'])
})

test('rejects HTTP and WebSocket requests before resolving a machine without a trusted origin', async () => {
  const resolved: string[] = []
  const proxy = createMachineProxyRoutes({
    auth: createAuthConfig({ allowedOrigins: [browserOrigin] }),
    resolve: (name) => {
      resolved.push(name)
      return { origin: 'http://127.0.0.1:9001', webOrigin: remoteWebOrigin }
    },
  })
  for (const upgrade of ['', 'websocket']) {
    const response = await proxy.handle(
      new Request('http://local/machines/dev/proxy/orchestration/rpc', {
        headers: { origin: 'https://untrusted.example.test', upgrade },
      }),
    )
    expect(response.status).toBe(403)
  }
  expect(resolved).toEqual([])
})

test('streams response chunks without waiting for the remote response to finish', async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const proxy = createMachineProxyRoutes({
    auth: createAuthConfig({ allowedOrigins: [browserOrigin] }),
    resolve: () => ({ origin: 'http://127.0.0.1:9001', webOrigin: remoteWebOrigin }),
    fetcher: async () => new Response(stream.readable),
  })
  const response = await proxy.handle(
    new Request('http://local/machines/dev/proxy/settings/events', {
      headers: { origin: browserOrigin },
    }),
  )
  const reader = response.body?.getReader()
  const chunk = new Uint8Array([65, 66])
  const write = writer.write(chunk)
  expect(await reader?.read()).toEqual({ done: false, value: chunk })
  await write
  await writer.close()
  expect(await reader?.read()).toEqual({ done: true, value: undefined })
})

test('relays text and binary WebSocket frames exactly, including input sent before the remote opens', async () => {
  const remote = remoteMachineSocket()
  const local = machineProxyClient()
  const target = new URL('/terminal?root=%2Frepo&shell=bash', remote.server.url)
  target.protocol = 'ws:'
  const request = new Request('http://local/machines/dev/proxy/terminal', {
    headers: { origin: browserOrigin, cookie: 'session=local-secret' },
  })
  const relay = createMachineProxySocket(
    target,
    machineProxyHeaders(request, remoteWebOrigin),
    'dev',
  )
  const frames = ['{ "n": 9007199254740993 }', 'true', '007', '', Buffer.from([0, 255, 128])]

  try {
    relay.open(local.client)
    for (const frame of frames) relay.message(local.client, frame)
    await expect.poll(() => local.messages.length).toBe(frames.length)
    expect(local.messages.slice(0, 4)).toEqual(frames.slice(0, 4))
    expect(local.messages[4]).toEqual(new Uint8Array([0, 255, 128]).buffer)
    expect(remote.requests[0]?.url).toContain('/terminal?root=%2Frepo&shell=bash')
    expect(remote.requests[0]?.headers.get('origin')).toBe(remoteWebOrigin)
    expect(remote.requests[0]?.headers.has('cookie')).toBe(false)
    relay.close(local.client, 1000, 'done')
    expect(local.closes).toEqual([{ code: 1000, reason: 'done' }])
  } finally {
    relay.close(local.client, 1000, 'cleanup')
    await remote.server.stop(true)
  }
})

test('upgrades an authenticated prefixed request through Elysia and dispatches raw frames', async () => {
  const remote = remoteMachineSocket()
  const local = machineProxyClient()
  const relay = machineProxyAdapter({
    auth: createAuthConfig({ allowedOrigins: [browserOrigin] }),
    resolve: () => ({ origin: remote.server.url.origin, webOrigin: remoteWebOrigin }),
  })
  const response = await relay.app.handle(
    new Request('http://local/platform-api/machines/dev/proxy/orchestration/rpc?client=a%2Fb', {
      headers: {
        origin: browserOrigin,
        upgrade: 'websocket',
        connection: 'upgrade',
        'sec-websocket-key': 'browser-key-must-not-reach-remote',
        'sec-websocket-version': '13',
      },
    }),
  )
  expect(response.status).toBeLessThan(400)
  expect(relay.upgrades).toHaveLength(1)
  const socket = { ...local.client, data: relay.upgrades[0]?.data }
  try {
    dispatchMachineProxySocket('open', socket)
    dispatchMachineProxySocket('message', socket, '{ "n": 9007199254740993 }')
    dispatchMachineProxySocket('message', socket, Buffer.from([0, 255, 128]))
    await expect.poll(() => local.messages.length).toBe(2)
    expect(local.messages[0]).toBe('{ "n": 9007199254740993 }')
    expect(local.messages[1]).toEqual(new Uint8Array([0, 255, 128]).buffer)
    expect(remote.requests[0]?.url).toContain('/orchestration/rpc?client=a%2Fb')
    expect(remote.requests[0]?.headers.get('sec-websocket-key')).not.toBe(
      'browser-key-must-not-reach-remote',
    )
    expect(remote.requests[0]?.headers.get('origin')).toBe(remoteWebOrigin)
  } finally {
    dispatchMachineProxySocket('close', socket, 1000, 'cleanup')
    await remote.server.stop(true)
  }
})

test('wildcard URLs cannot replace the connected machine origin', async () => {
  const targets: URL[] = []
  const proxy = createMachineProxyRoutes({
    auth: createAuthConfig({ allowedOrigins: [browserOrigin] }),
    resolve: () => ({ origin: 'http://127.0.0.1:9001', webOrigin: remoteWebOrigin }),
    fetcher: async (url) => {
      targets.push(url)
      return new Response(null, { status: 204 })
    },
  })
  for (const path of ['/untrusted.example/health', 'https://untrusted.example/health']) {
    await proxy.handle(
      new Request(`http://local/machines/dev/proxy/${path}`, {
        headers: { origin: browserOrigin },
      }),
    )
  }
  expect(targets).toHaveLength(2)
  expect(targets.map((target) => target.origin)).toEqual([
    'http://127.0.0.1:9001',
    'http://127.0.0.1:9001',
  ])
})
