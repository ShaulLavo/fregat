import { expect, test } from 'vitest'
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

test('other authorization failures do not renew or replay the relay request', async () => {
  let refreshes = 0
  const response = await forwardMachineRequest(
    new Request('http://localhost/machines/fixture/proxy/settings'),
    new URL('http://127.0.0.1:31001/settings'),
    new Headers(),
    async () => Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }),
    async () => {
      refreshes++
      return new Headers()
    },
  )
  expect(response.status).toBe(401)
  expect(refreshes).toBe(0)
})
