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
        },
      }),
  )
  expect(
    Array.from(response.headers.keys()).filter((name) => name.startsWith('access-control-')),
  ).toEqual([])
  expect(await response.text()).toBe('healthy')
})
