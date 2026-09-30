import { createObservedInProcessClient } from '../client'
import type { TestServer } from '../server'
import { createRequestGate } from './request-gate'

export function createDeferredReadSessionClient(server: TestServer) {
  const requests: string[] = []
  const gate = createRequestGate((request) => {
    if (request.method !== 'GET' || !new URL(request.url).pathname.startsWith('/fs/read-session/'))
      return false
    requests.push(request.url)
    return requests.length === 1
  })
  return {
    client: createObservedInProcessClient(server, gate.beforeRequest),
    entered: gate.entered,
    release: gate.release,
    requests,
  }
}
