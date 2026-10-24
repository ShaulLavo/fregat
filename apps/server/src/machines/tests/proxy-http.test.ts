import { expect, test } from 'vitest'
import { createMachineProxyError } from '../proxy-errors'
import { forwardMachineRequest, machineProxyHeaders } from '../proxy-http'

test('a relay strips adjacent forwarding and handshake headers and uses its own cookie', () => {
  const request = new Request('http://localhost/machines/fixture/proxy/health', {
    headers: {
      cookie: 'source_device=browser.secret',
      authorization: 'Bearer source-only',
      'x-forwarded-custom': 'client-metadata',
      'x-forwarded-for': '100.64.0.9',
      'x-forwarded-host': 'source.example',
      'x-forwarded-proto': 'https',
      'sec-websocket-key': 'source-key',
      'sec-websocket-version': '13',
    },
  })
  const headers = machineProxyHeaders(request, 'http://localhost:5173', 'relay_device=relay.secret')
  expect(Object.fromEntries(headers)).toEqual({
    cookie: 'relay_device=relay.secret',
    origin: 'http://localhost:5173',
    via: '1.1 fregat',
  })
})

test('a relay removes every destination CORS header from its response', async () => {
  const response = await forwardMachineRequest(
    new Request('http://localhost/machines/fixture/proxy/health'),
    new URL('http://127.0.0.1:31001/health'),
    new Headers(),
    async () =>
      new Response('healthy', {
        headers: {
          'access-control-allow-credentials': 'true',
          'access-control-allow-origin': 'http://destination.example',
          'access-control-expose-headers': 'secret-header',
          'set-cookie': 'platform_device=destination.secret; HttpOnly',
        },
      }),
  )
  expect(
    Array.from(response.headers.keys()).filter((name) => name.startsWith('access-control-')),
  ).toEqual([])
  expect(response.headers.has('set-cookie')).toBe(false)
  expect(await response.text()).toBe('healthy')
})

test.each([false, true])(
  'a revoked relay retries its POST once, with repeated rejection=%s',
  async (rejectedAgain) => {
    const requests: Request[] = []
    let refreshes = 0
    const response = await forwardMachineRequest(
      new Request('http://localhost/machines/fixture/proxy/settings', {
        method: 'POST',
        body: 'original body',
      }),
      new URL('http://127.0.0.1:31001/settings'),
      new Headers({ cookie: 'relay_device=revoked.secret' }),
      async (url, init) => {
        requests.push(new Request(url, init))
        if (requests.length === 1 || rejectedAgain)
          return Response.json({ error: { code: 'DEVICE_NOT_PAIRED' } }, { status: 401 })
        return new Response('accepted')
      },
      async () => {
        refreshes++
        return new Headers({ cookie: 'relay_device=replacement.secret' })
      },
    )
    expect(requests).toHaveLength(2)
    expect(refreshes).toBe(1)
    expect(await requests[0]!.text()).toBe('original body')
    expect(await requests[1]!.text()).toBe('original body')
    expect(requests[1]!.headers.get('cookie')).toBe('relay_device=replacement.secret')
    expect(response.status).toBe(rejectedAgain ? 401 : 200)
  },
)

test.each([false, true])(
  'a streamed POST stays readable on retry after its first upload, with repeated rejection=%s',
  async (rejectedAgain) => {
    const bytes = new Uint8Array([0, 255, 13, 10, 128])
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2))
        controller.enqueue(bytes.subarray(2))
        controller.close()
      },
    })
    const requests: Request[] = []
    let refreshes = 0
    const response = await forwardMachineRequest(
      new Request('http://localhost/machines/fixture/proxy/settings', { method: 'POST', body }),
      new URL('http://destination.example/settings'),
      new Headers({
        'content-type': 'application/octet-stream',
        cookie: 'relay_device=revoked.secret',
      }),
      async (url, init) => {
        const upload = new Request(url, init)
        requests.push(upload)
        if (requests.length === 1) {
          expect(new Uint8Array(await upload.arrayBuffer())).toEqual(bytes)
          return Response.json({ error: { code: 'DEVICE_NOT_PAIRED' } }, { status: 401 })
        }
        if (rejectedAgain)
          return Response.json({ error: { code: 'DEVICE_NOT_PAIRED' } }, { status: 401 })
        return new Response('accepted')
      },
      async () => {
        refreshes++
        return new Headers({
          'content-type': 'application/octet-stream',
          cookie: 'relay_device=replacement.secret',
        })
      },
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]!.bodyUsed).toBe(true)
    const retry = requests[1]!
    expect(retry.bodyUsed).toBe(false)
    expect(new Uint8Array(await retry.arrayBuffer())).toEqual(bytes)
    expect(retry.method).toBe('POST')
    expect(retry.headers.get('content-type')).toBe('application/octet-stream')
    expect(retry.headers.get('cookie')).toBe('relay_device=replacement.secret')
    expect(refreshes).toBe(1)
    expect(response.status).toBe(rejectedAgain ? 401 : 200)
    await response.body?.cancel()
  },
)

test.each(['accepted', 'upload failure', 'refresh failure', 'retry failure'])(
  'unused upload branches are released after %s',
  async (outcome) => {
    let cancellations = 0
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations++
      },
    })
    let attempts = 0
    const uploadCancellations: Promise<void>[] = []
    const forwarding = forwardMachineRequest(
      new Request('http://localhost/machines/fixture/proxy/settings', { method: 'POST', body }),
      new URL('http://destination.example/settings'),
      new Headers(),
      async (url, init) => {
        attempts++
        const upload = new Request(url, init)
        if (upload.body) uploadCancellations.push(upload.body.cancel())
        if (outcome === 'upload failure' || attempts === 2) throw createMachineProxyError()
        if (outcome === 'accepted') return new Response('accepted')
        return Response.json({ error: { code: 'DEVICE_NOT_PAIRED' } }, { status: 401 })
      },
      async () => {
        if (outcome === 'refresh failure') throw createMachineProxyError()
        return new Headers()
      },
    )
    if (outcome === 'accepted') {
      expect(await (await forwarding).text()).toBe('accepted')
    } else {
      await expect(forwarding).rejects.toMatchObject({ code: 'MACHINE_PROXY_UNAVAILABLE' })
    }
    await Promise.all(uploadCancellations)
    expect(cancellations).toBe(1)
    expect(attempts).toBe(outcome === 'retry failure' ? 2 : 1)
  },
)

test('other authorization failures do not renew or replay the relay request', async () => {
  let attempts = 0
  let refreshes = 0
  const response = await forwardMachineRequest(
    new Request('http://localhost/machines/fixture/proxy/settings', {
      method: 'POST',
      body: 'original body',
    }),
    new URL('http://127.0.0.1:31001/settings'),
    new Headers(),
    async (url, init) => {
      attempts++
      expect(await new Request(url, init).text()).toBe('original body')
      return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
    },
    async () => {
      refreshes++
      return new Headers()
    },
  )
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } })
  expect(attempts).toBe(1)
  expect(refreshes).toBe(0)
})
