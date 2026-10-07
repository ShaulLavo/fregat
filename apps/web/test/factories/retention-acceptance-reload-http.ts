import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { once } from 'node:events'
import { createScriptError } from '../../../../scripts/structured-errors.ts'
import { createRetentionReloadTransport } from './retention-acceptance-reload-transport.ts'

type Transport = ReturnType<typeof createRetentionReloadTransport>
type Forwarding = {
  readonly transport: Transport
  readonly beforeFetch: (url: URL) => Promise<void>
}
type Admission =
  | { readonly kind: 'pending' }
  | { readonly kind: 'open'; readonly forwarding: Forwarding }
  | { readonly kind: 'closed' }

function loopbackOrigin(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw createScriptError('Reload forwarding requires a valid origin', {
      internal: { valid: false },
    })
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw createScriptError('Reload forwarding requires a loopback HTTP origin', {
      internal: { valid: false },
    })
  return url
}

function refuse(response: ServerResponse, status: number) {
  response.writeHead(status, { 'content-length': '0' })
  response.end()
}

async function readBody(message: IncomingMessage) {
  const parts: Buffer[] = []
  for await (const part of message) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part))
  return Buffer.concat(parts)
}

function writeResponse(response: ServerResponse, incoming: IncomingMessage, body: Buffer) {
  return new Promise<void>((resolve, reject) => {
    response.once('finish', resolve)
    response.once('error', reject)
    response.once('close', () => {
      if (!response.writableFinished)
        reject(
          createScriptError('Reload response closed before completion', {
            internal: { stage: 'fulfillment' },
          }),
        )
    })
    response.writeHead(incoming.statusCode ?? 502, incoming.headers)
    response.end(body)
  })
}

function handshake(response: IncomingMessage) {
  const status = `HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\r\n`
  const headers: string[] = []
  for (let index = 0; index < response.rawHeaders.length; index += 2)
    headers.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}\r\n`)
  return status + headers.join('') + '\r\n'
}

export async function createRetentionReloadHttp(options: {
  readonly runnerOrigin: string
  readonly entryOrigin: string
  readonly apiOrigin: string
  readonly signal: AbortSignal
}) {
  const runner = loopbackOrigin(options.runnerOrigin)
  const entry = loopbackOrigin(options.entryOrigin)
  const api = loopbackOrigin(options.apiOrigin)
  let admission: Admission = { kind: 'pending' }
  let forwarding: Forwarding | null = null
  let closed: Promise<void> | null = null
  const active = new Set<ReturnType<typeof request>>()
  const upgraded = new Set<Duplex>()

  const receive = (
    url: URL,
    method: string,
    headers: IncomingMessage['headers'],
    body: Buffer,
    owned: Set<ReturnType<typeof request>>,
    signal: AbortSignal,
  ) =>
    new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request(url, { method, headers, signal }, resolve)
      active.add(outgoing)
      owned.add(outgoing)
      outgoing.once('close', () => {
        active.delete(outgoing)
        owned.delete(outgoing)
      })
      outgoing.once('error', reject)
      outgoing.end(body)
    })

  const fetch = async (
    url: URL,
    incoming: IncomingMessage,
    body: Buffer,
    owned: Set<ReturnType<typeof request>>,
    headers: IncomingMessage['headers'],
  ) => {
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
    let target = new URL(url.pathname + url.search, entry)
    let method = incoming.method ?? 'GET'
    let data = body
    for (let redirects = 0; redirects <= 20; redirects++) {
      options.signal.throwIfAborted()
      const response = await receive(target, method, headers, data, owned, signal)
      const bytes = await readBody(response)
      if (
        !response.headers.location ||
        ![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)
      )
        return { response, bytes }
      target = new URL(response.headers.location, target)
      if (target.origin !== entry.origin || target.username || target.password)
        throw createScriptError('Reload redirect leaves the serving origin', {
          internal: { stage: 'redirect' },
        })
      if (
        response.statusCode === 303 ||
        ((response.statusCode === 301 || response.statusCode === 302) && method === 'POST')
      ) {
        method = 'GET'
        data = Buffer.alloc(0)
        headers.connection = 'close'
        delete headers['content-length']
        delete headers['content-type']
        delete headers['transfer-encoding']
        delete headers['content-encoding']
      }
    }
    throw createScriptError('Reload forwarding exceeded its redirect limit', {
      internal: { redirects: 20 },
    })
  }

  const forward = (
    url: URL,
    incoming: IncomingMessage,
    response: ServerResponse,
    selected: Forwarding,
  ) => {
    const owned = new Set<ReturnType<typeof request>>()
    return selected.transport.run(
      url.href,
      async (fulfill, headersCompleted, markHttp) => {
        const body = await readBody(incoming)
        await selected.beforeFetch(url)
        markHttp('headersStartedAt')
        const headers: IncomingMessage['headers'] = { ...incoming.headers, host: entry.host }
        delete headers['proxy-connection']
        delete headers['proxy-authorization']
        if (incoming.method === 'GET') headers.connection = 'close'
        headersCompleted()
        options.signal.throwIfAborted()
        markHttp('fetchStartedAt')
        const result = await fetch(url, incoming, body, owned, headers)
        markHttp('fetchCompletedAt')
        await fulfill(() => writeResponse(response, result.response, result.bytes))
      },
      async () => {
        for (const outgoing of owned) outgoing.destroy()
        incoming.destroy()
        response.destroy()
      },
    )
  }

  const target = (incoming: IncomingMessage) => {
    try {
      const url = new URL(incoming.url ?? '')
      if (
        url.hostname !== runner.hostname ||
        url.port !== runner.port ||
        url.username ||
        url.password
      )
        return null
      return url
    } catch {
      return null
    }
  }

  const server = createServer((incoming, response) => {
    const selected = admission
    const url = target(incoming)
    if (selected.kind !== 'open') return refuse(response, 503)
    if (!url || url.protocol !== 'http:') return refuse(response, 403)
    if (
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(incoming.method ?? '')
    )
      return refuse(response, 405)
    void forward(url, incoming, response, selected.forwarding).catch(() => response.destroy())
  })
  server.on('connect', (_incoming, socket) =>
    socket.end('HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n'),
  )
  server.on('upgrade', (incoming, socket, head) => {
    const url = target(incoming)
    if (
      admission.kind !== 'open' ||
      !url ||
      !['http:', 'ws:'].includes(url.protocol) ||
      incoming.method !== 'GET' ||
      incoming.headers.upgrade?.toLowerCase() !== 'websocket'
    )
      return socket.destroy()
    // page.route left runner WebSockets on their original endpoint.
    const outgoing = request(new URL(url.pathname + url.search, runner), {
      headers: incoming.headers,
    })
    active.add(outgoing)
    outgoing.once('close', () => active.delete(outgoing))
    outgoing.once('error', () => socket.destroy())
    outgoing.once('response', (response) => {
      response.resume()
      socket.destroy()
    })
    outgoing.once('upgrade', (response, upstream, upstreamHead) => {
      upgraded.add(socket)
      upgraded.add(upstream)
      socket.once('close', () => {
        upgraded.delete(socket)
        upstream.destroy()
      })
      upstream.once('close', () => {
        upgraded.delete(upstream)
        socket.destroy()
      })
      socket.write(handshake(response))
      if (upstreamHead.length) socket.write(upstreamHead)
      if (head.length) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
    outgoing.end()
  })

  const disposeRequests = async () => {
    const closing = [...active].map((outgoing) => {
      const finished = once(outgoing, 'close').catch(() => undefined)
      outgoing.destroy()
      return finished
    })
    for (const socket of upgraded) socket.destroy()
    await Promise.all(closing)
  }
  const close = () =>
    (closed ??= (async () => {
      admission = { kind: 'closed' }
      forwarding?.transport.stopAdmission()
      await forwarding?.transport.cancelPending()
      await disposeRequests()
      const stopped = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      server.closeAllConnections()
      await stopped
      await forwarding?.transport.drain()
    })())

  server.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    await close()
    throw createScriptError('Reload forwarding address is unavailable', {
      internal: { listening: server.listening },
    })
  }
  return {
    proxy: { server: `http://127.0.0.1:${address.port}`, bypass: `${api.host},${entry.host}` },
    bind(value: Forwarding) {
      if (admission.kind !== 'pending')
        throw createScriptError('Reload forwarding was already bound or closed', {
          internal: { state: admission.kind },
        })
      forwarding = value
      admission = { kind: 'open', forwarding: value }
    },
    disposeRequests,
    close,
  }
}
