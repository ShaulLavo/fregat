import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { createInProcessFetcher } from '../client'
import type { TestServer } from '../server'

export function failingSettingsStream(server: TestServer, mode: 'unreachable' | 'unreadable') {
  const fetch = createInProcessFetcher(server)
  let failing = true
  let attempts = 0
  const fetcher: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const request = new Request(input, init)
      if (!failing || new URL(request.url).pathname !== '/settings/events') return fetch(request)
      attempts += 1
      if (mode === 'unreachable')
        return Response.json({ code: 'TEST_SETTINGS_DOWN' }, { status: 503 })
      return new Response('event: settings\ndata: {}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
    { preconnect: () => undefined },
  )
  return {
    client: createEnvironmentClient({
      origin: server.origin,
      headers: () => ({ origin: server.clientOrigin }),
      fetcher,
    }),
    get attempts() {
      return attempts
    },
    recover() {
      failing = false
    },
  }
}
