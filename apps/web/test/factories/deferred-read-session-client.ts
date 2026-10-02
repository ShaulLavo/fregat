import { createObservedInProcessClient } from '../client'
import type { TestServer } from '../server'
import { createRequestGate } from './request-gate'

export function createDeferredReadSessionClient(server: TestServer) {
  const requests: string[] = []
  const gate = createRequestGate((request) => {
    const url = new URL(request.url)
    if (request.method !== 'GET' || !url.pathname.startsWith('/fs/read-session/')) return false
    if (url.searchParams.get('start') === url.searchParams.get('end')) return false
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
