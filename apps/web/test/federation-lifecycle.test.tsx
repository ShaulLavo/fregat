import { onTestFinished } from 'vitest'
import { http, HttpResponse } from 'msw'
import { test, expect } from './fixtures'
import { server as httpServer } from './msw/server'
import { createFederationHarness } from './factories/federation'

// A later fixture teardown can yield to recovery after the test's handlers were reset.
test('stops federation recovery before a later fixture teardown wakes it', async ({ server }) => {
  const h = await createFederationHarness(server)
  await h.connections.disconnectMachine('remote')
  const origin = 'https://second-offline.example.test'
  h.connections.configureMachines({ offline: { kind: 'origin', url: origin } })
  const requests: string[] = []
  const observe = ({ request }: { request: Request }) => {
    if (request.url === `${origin}/health`) requests.push(request.url)
  }
  httpServer.events.on('request:start', observe)
  httpServer.use(http.get(`${origin}/health`, () => new HttpResponse(null, { status: 503 })))
  expect(await h.connections.connectMachine('offline')).toBe('failed')
  expect(requests).toHaveLength(1)
  onTestFinished(async () => {
    try {
      window.dispatchEvent(new Event('online'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(requests).toHaveLength(1)
    } finally {
      httpServer.events.removeListener('request:start', observe)
    }
  })
})

test('starts the following fixture without the previous recovery request', async ({ server }) => {
  const h = await createFederationHarness(server)
  expect(await h.connections.connectMachine('remote')).toBe('connected')
})
