import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import type { TestServer } from '../server'

export function createGatedMutationClient(server: TestServer, pathname = '/fs/write') {
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  let held = false
  const requests: Request[] = []
  const client = createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.origin }),
    fetcher: Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request.clone())
        const response = await server.app.handle(request)
        if (new URL(request.url).pathname !== pathname || held) return response
        held = true
        entered.resolve()
        await released.promise
        return response
      },
      { preconnect: () => undefined },
    ),
  })
  return { client, requests, entered: entered.promise, release: () => released.resolve() }
}
