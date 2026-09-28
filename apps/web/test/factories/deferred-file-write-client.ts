import { createObservedInProcessClient } from '../client'
import type { TestServer } from '../server'

export function createDeferredFileWriteClient(server: TestServer) {
  const firstWrite = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const writePaths: string[] = []
  const client = createObservedInProcessClient(server, async (request) => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/fs/write') return
    writePaths.push(new URL(request.url).searchParams.get('path') ?? '')
    if (writePaths.length !== 1) return
    firstWrite.resolve()
    await release.promise
  })
  return { client, firstWrite: firstWrite.promise, release: () => release.resolve(), writePaths }
}
