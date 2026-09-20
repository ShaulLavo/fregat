import * as v from 'valibot'
import {
  orchestrationWsClientMessageSchema,
  type ClientOrchestrationCommand,
} from '@workspace/contracts'
import { createClientError } from '@workspace/client-core/errors'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { inProcessOrchestrationSocketFactory } from '@workspace/client-core/test/in-process-orchestration-socket'
import type { FakeOrchestrationSocket } from '@workspace/client-core/test/orchestration-socket'

import type { TestServer } from './server'

export function createInProcessFetcher(server: TestServer): typeof fetch {
  const fetcher = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    return server.app.handle(request)
  }

  // Bun's fetch type includes preconnect; in-process calls have no connection to establish.
  return Object.assign(fetcher, { preconnect: () => undefined })
}

export function createInProcessClient(server: TestServer) {
  return createEnvironmentClient({
    origin: server.origin,
    headers: () => ({ origin: server.clientOrigin }),
    fetcher: createInProcessFetcher(server),
  })
}

type ResponseGate = {
  readonly reached: ReturnType<typeof Promise.withResolvers<Request>>
  readonly released: ReturnType<typeof Promise.withResolvers<void>>
}

export function createControlledInProcessTransport(server: TestServer) {
  let currentServer = server
  const requests: Request[] = []
  const sockets: FakeOrchestrationSocket[] = []
  const gates = new Map<string, ResponseGate>()
  const requestGates = new Map<string, ResponseGate>()
  const createSocket = inProcessOrchestrationSocketFactory({
    get app() {
      return currentServer.app
    },
    get clientOrigin() {
      return currentServer.clientOrigin
    },
  })

  const fetcher = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    requests.push(request)
    const pathname = new URL(request.url).pathname
    const requestGate = requestGates.get(pathname)
    if (requestGate) {
      requestGates.delete(pathname)
      requestGate.reached.resolve(request)
      await requestGate.released.promise
      request.signal.throwIfAborted()
    }
    const response = await currentServer.app.handle(request)
    const gate = gates.get(pathname)
    if (!gate) return response
    gates.delete(pathname)
    gate.reached.resolve(request)
    await gate.released.promise
    return response
  }

  return {
    fetcher: Object.assign(fetcher, { preconnect: () => undefined }),
    createSocket(url: string) {
      const socket = createSocket(url)
      sockets.push(socket)
      return socket
    },
    get sockets(): readonly FakeOrchestrationSocket[] {
      return sockets
    },
    get requests(): readonly Request[] {
      return requests
    },
    connect(next: TestServer) {
      currentServer = next
    },
    pauseNextRequest(pathname: string) {
      const reached = Promise.withResolvers<Request>()
      const released = Promise.withResolvers<void>()
      requestGates.set(pathname, { reached, released })
      return { reached: reached.promise, release: released.resolve }
    },
    pauseNextResponse(pathname: string) {
      const reached = Promise.withResolvers<Request>()
      const released = Promise.withResolvers<void>()
      gates.set(pathname, { reached, released })
      return { reached: reached.promise, release: released.resolve }
    },
  }
}

export function failingCommandSocket(
  server: TestServer,
  shouldFail: (command: ClientOrchestrationCommand) => boolean,
) {
  const createSocket = inProcessOrchestrationSocketFactory({
    app: server.app,
    clientOrigin: server.clientOrigin,
  })
  return (url: string) => {
    const socket = createSocket(url)
    const send = socket.send.bind(socket)
    socket.send = (raw) => {
      const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw))
      if (
        message.kind === 'request' &&
        message.method === 'dispatchCommand' &&
        shouldFail(message.command)
      ) {
        throw createClientError({
          code: 'TEST_NETWORK_FAILURE',
          message: 'Injected command transport failure',
          status: 503,
          why: 'A single test transport request is interrupted.',
          fix: 'Retry the failed selection.',
        })
      }
      send(raw)
    }
    return socket
  }
}
