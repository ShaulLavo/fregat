import { createEnvironmentClient, type Client } from '@workspace/client-core/transport/client'

import type { TestServer } from './server'

type InjectedSettingsError = {
  readonly code: string
  readonly message: string
  readonly status: number
}

// Eden client that calls the real app directly — every request goes through
// `app.handle`, so there is no socket, no port, and nothing mocked.
export function createInProcessClient(server: TestServer): Client {
  return createClient(server, directInProcessFetcher(server))
}

export function createRestartableInProcessClient(server: TestServer) {
  let currentFetch = directInProcessFetcher(server)
  const fetcher = ((input, init) => currentFetch(input, init)) as typeof fetch
  return {
    client: createClient(server, fetcher),
    reconnect(nextServer: TestServer) {
      currentFetch = directInProcessFetcher(nextServer)
    },
  }
}

export function createObservedInProcessClient(
  server: TestServer,
  beforeRequest: (request: Request) => void | Promise<void>,
) {
  const directFetch = directInProcessFetcher(server)
  const fetcher = (async (input, init) => {
    const request = new Request(input, init)
    await beforeRequest(request)
    return directFetch(request)
  }) as typeof fetch
  return createClient(server, fetcher)
}

/** Ends every open `/fs/events` response on demand, as a server restart or dropped link would. */
export function createCuttableEventsClient(server: TestServer) {
  const directFetch = directInProcessFetcher(server)
  const open = new Set<() => void>()
  const fetcher = (async (input, init) => {
    const request = new Request(input, init)
    const response = await directFetch(request)
    if (new URL(request.url).pathname !== '/fs/events' || !response.body) return response
    const reader = response.body.getReader()
    let end = () => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        end = () => {
          open.delete(end)
          void reader.cancel()
          controller.close()
        }
        open.add(end)
      },
      async pull(controller) {
        const { done, value } = await reader.read()
        if (!open.has(end)) return
        if (!done) return controller.enqueue(value)
        open.delete(end)
        controller.close()
      },
      cancel(reason) {
        open.delete(end)
        return reader.cancel(reason)
      },
    })
    return new Response(body, response)
  }) as typeof fetch
  return {
    client: createClient(server, fetcher),
    endEventStreams: () => {
      // Each end removes itself; deleting the current entry keeps a Set iteration valid.
      for (const end of open) end()
    },
  }
}

export function createControlledInProcessClient(server: TestServer) {
  const controller = new SettingsStreamFetchController()
  const directFetch = directInProcessFetcher(server)
  const fetcher = (async (input, init) => {
    const request = withOrigin(new Request(input, init), server.origin)
    controller.observe(request)
    const injected = await controller.injectedResponse(request)
    if (injected) return injected

    const response = await directFetch(request)
    if (new URL(request.url).pathname !== '/settings/events') return response

    return controller.wrap(response)
  }) as typeof fetch

  return { client: createClient(server, fetcher), controller }
}

class SettingsStreamFetchController {
  private readonly activeAttempts = new Map<number, () => void>()
  private attemptCount = 0
  private nextSettingsReadResponse: Response | null = null
  private nextSettingsRawWriteResponse: Response | null = null
  private nextSettingsWriteResponse: Promise<Response> | Response | null = null
  private readonly rawWriteObservations: Promise<void>[] = []
  private readonly rawWriteRequests: unknown[] = []
  private readCount = 0
  private readonly settingsWriteObservations: Promise<void>[] = []
  private settingsWriteRequestCount = 0
  private readonly settingsWriteRequestsSeen: unknown[] = []
  private readonly settingsWriteRequestWaiters: Array<{
    attempt: number
    resolve: () => void
  }> = []
  private streamRequestCount = 0
  private readonly streamRequestWaiters: Array<{ attempt: number; resolve: () => void }> = []
  private readonly waiters: Array<{ attempt: number; resolve: () => void }> = []

  get settingsStreamAttemptCount() {
    return this.attemptCount
  }

  get settingsReadCount() {
    return this.readCount
  }

  get settingsStreamRequestCount() {
    return this.streamRequestCount
  }

  get settingsWriteCount() {
    return this.settingsWriteRequestCount
  }

  observe(request: Request) {
    const path = new URL(request.url).pathname
    if (path === '/settings' && request.method === 'GET') this.readCount += 1
    if (path === '/settings/raw' && request.method === 'POST') this.observeRawWrite(request)
    if (path === '/settings/write' && request.method === 'POST') {
      this.observeSettingsWrite(request)
    }
    if (path !== '/settings/events' || request.method !== 'GET') return

    this.streamRequestCount += 1
    this.resolveStreamRequestWaiters()
  }

  waitForSettingsStreamRequest(attempt: number): Promise<void> {
    if (this.streamRequestCount >= attempt) return Promise.resolve()

    return new Promise((resolve) => this.streamRequestWaiters.push({ attempt, resolve }))
  }

  rejectNextSettingsWrite({ code, message, status }: InjectedSettingsError) {
    this.nextSettingsWriteResponse = settingsErrorResponse({ code, message, status })
  }

  deferNextSettingsWrite() {
    let resolve: (response: Response) => void = () => undefined
    this.nextSettingsWriteResponse = new Promise<Response>((settle) => {
      resolve = settle
    })

    return {
      reject: ({ code, message, status }: InjectedSettingsError) =>
        resolve(settingsErrorResponse({ code, message, status })),
    }
  }

  rejectNextSettingsRead({
    code,
    message,
    status,
  }: {
    readonly code: string
    readonly message: string
    readonly status: number
  }) {
    this.nextSettingsReadResponse = Response.json({ code, message }, { status })
  }

  rejectNextSettingsRawWrite({
    code,
    message,
    status,
  }: {
    readonly code: string
    readonly message: string
    readonly status: number
  }) {
    this.nextSettingsRawWriteResponse = Response.json({ code, message }, { status })
  }

  async settingsRawWriteRequests() {
    await Promise.all(this.rawWriteObservations)
    return [...this.rawWriteRequests]
  }

  async settingsWriteRequests() {
    await Promise.all(this.settingsWriteObservations)
    return [...this.settingsWriteRequestsSeen]
  }

  waitForSettingsWriteRequest(attempt: number): Promise<void> {
    if (this.settingsWriteRequestCount >= attempt) return Promise.resolve()

    return new Promise((resolve) => this.settingsWriteRequestWaiters.push({ attempt, resolve }))
  }

  injectedResponse(request: Request): Promise<Response> | Response | null {
    const path = new URL(request.url).pathname
    if (path === '/settings' && request.method === 'GET') {
      const response = this.nextSettingsReadResponse
      this.nextSettingsReadResponse = null
      return response
    }
    if (path === '/settings/raw' && request.method === 'POST') {
      const response = this.nextSettingsRawWriteResponse
      this.nextSettingsRawWriteResponse = null
      return response
    }
    if (path !== '/settings/write' || request.method !== 'POST') return null

    const response = this.nextSettingsWriteResponse
    this.nextSettingsWriteResponse = null
    return response
  }

  waitForSettingsStreamAttempt(attempt: number): Promise<void> {
    if (this.attemptCount >= attempt) return Promise.resolve()

    return new Promise((resolve) => this.waiters.push({ attempt, resolve }))
  }

  terminateSettingsStream(attempt = this.attemptCount): boolean {
    const terminate = this.activeAttempts.get(attempt)
    if (!terminate) return false

    terminate()
    return true
  }

  wrap(response: Response): Response {
    if (!response.body) return response

    const attempt = this.attemptCount + 1
    this.attemptCount = attempt
    this.resolveWaiters()
    const reader = response.body.getReader()
    let terminated = false
    let output: ReadableStreamDefaultController<Uint8Array> | null = null
    const finish = () => {
      this.activeAttempts.delete(attempt)
      if (terminated) return

      terminated = true
      output?.close()
    }
    const terminate = () => {
      if (terminated) return

      void reader.cancel('controlled settings stream termination')
      finish()
    }
    const body = new ReadableStream<Uint8Array>({
      cancel: (reason) => {
        this.activeAttempts.delete(attempt)
        terminated = true
        return reader.cancel(reason)
      },
      pull: async (controller) => {
        const chunk = await reader.read()
        if (terminated) return
        if (chunk.done) {
          finish()
          return
        }

        controller.enqueue(chunk.value)
      },
      start: (controller) => {
        output = controller
        this.activeAttempts.set(attempt, terminate)
      },
    })

    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  }

  private resolveWaiters() {
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.attempt <= this.attemptCount) {
        waiter.resolve()
        continue
      }

      this.waiters.push(waiter)
    }
  }

  private resolveStreamRequestWaiters() {
    for (const waiter of this.streamRequestWaiters.splice(0)) {
      if (waiter.attempt <= this.streamRequestCount) {
        waiter.resolve()
        continue
      }

      this.streamRequestWaiters.push(waiter)
    }
  }

  private observeRawWrite(request: Request) {
    const observation = request
      .clone()
      .json()
      .then((body) => this.rawWriteRequests.push(body))
      .then(() => undefined)
    this.rawWriteObservations.push(observation)
  }

  private observeSettingsWrite(request: Request) {
    this.settingsWriteRequestCount += 1
    const requestIndex = this.settingsWriteRequestCount - 1
    this.resolveSettingsWriteRequestWaiters()
    const observation = request
      .clone()
      .json()
      .then((body) => {
        this.settingsWriteRequestsSeen[requestIndex] = body
      })
      .then(() => undefined)
    this.settingsWriteObservations.push(observation)
  }

  private resolveSettingsWriteRequestWaiters() {
    for (const waiter of this.settingsWriteRequestWaiters.splice(0)) {
      if (waiter.attempt <= this.settingsWriteRequestCount) {
        waiter.resolve()
        continue
      }

      this.settingsWriteRequestWaiters.push(waiter)
    }
  }
}

function settingsErrorResponse({ code, message, status }: InjectedSettingsError) {
  return Response.json({ error: { code, message } }, { status })
}

export function directInProcessFetcher(server: TestServer): typeof fetch {
  return (async (input, init) => {
    const response = await server.app.handle(withOrigin(new Request(input, init), server.origin))
    normalizeInProcessSseHeaders(response)
    return response
  }) as typeof fetch
}

function normalizeInProcessSseHeaders(response: Response) {
  if (response.headers.get('transfer-encoding') !== 'chunked') return
  if (response.headers.get('cache-control') !== 'no-cache') return

  // Happy DOM rewrites app.handle() SSE responses to text/plain.
  response.headers.set('content-type', 'text/event-stream')
}

function createClient(server: TestServer, fetcher: typeof fetch) {
  return createEnvironmentClient({
    origin: server.origin,
    fetcher,
    headers: () => ({ origin: server.origin }),
  })
}

// happy-dom's Request drops `origin` (a browser-forbidden header), which the
// app's auth guard requires. Re-attach it so dom tests reach the real routes.
function withOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') === origin) return request

  const headers = new Headers(request.headers)
  headers.set('origin', origin)
  Object.defineProperty(request, 'headers', { value: headers })
  return request
}
