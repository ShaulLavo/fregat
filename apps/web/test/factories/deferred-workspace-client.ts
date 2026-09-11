import { createObservedInProcessClient } from '../client'
import type { TestServer } from '../server'

export function deferredWorkspaceClient(server: TestServer) {
  const started = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()
  const client = createObservedInProcessClient(server, async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fs/workspace-address')
      return
    started.resolve()
    await gate.promise
  })
  return { client, started: started.promise, release: () => gate.resolve() }
}
