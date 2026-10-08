import type { ServerWebSocket } from 'bun'

type Subscriber = ServerWebSocket<{ topic?: string }>
export interface SignalingServerOptions {
  readonly hostname: string
  readonly port: number
  readonly allowedOrigins: readonly string[]
  readonly authorize?: (request: Request) => boolean | Promise<boolean>
}

/** The broker sees opaque room topics and ciphertext, never document messages. */
export function startSignalingServer(options: SignalingServerOptions) {
  if (
    !options.hostname ||
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535 ||
    options.allowedOrigins.length === 0
  )
    throw new TypeError('An explicit bind host, port and allowed origins are required')
  const topics = new Map<string, Set<Subscriber>>()
  const remove = (socket: Subscriber) => {
    const topic = socket.data.topic
    if (!topic) return
    const members = topics.get(topic)
    members?.delete(socket)
    if (members?.size === 0) topics.delete(topic)
  }
  return Bun.serve<{ topic?: string }>({
    hostname: options.hostname,
    port: options.port,
    async fetch(request, server) {
      const origin = request.headers.get('origin')
      if (!origin || !options.allowedOrigins.includes(origin))
        return new Response('Origin refused', { status: 403 })
      if (options.authorize && !(await options.authorize(request)))
        return new Response('Admission refused', { status: 403 })
      return server.upgrade(request, { data: {} })
        ? undefined
        : new Response('WebSocket upgrade required', { status: 426 })
    },
    websocket: {
      maxPayloadLength: 1024 * 1024,
      idleTimeout: 120,
      sendPings: true,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      message(socket, raw) {
        if (typeof raw !== 'string') {
          socket.close(1003, 'Text frames required')
          return
        }
        let frame: { type?: unknown; topic?: unknown; payload?: unknown }
        try {
          frame = JSON.parse(raw)
        } catch {
          socket.close(1007, 'Invalid JSON')
          return
        }
        if (
          !frame ||
          typeof frame !== 'object' ||
          typeof frame.topic !== 'string' ||
          !/^[a-zA-Z0-9_-]{16,128}$/.test(frame.topic)
        ) {
          socket.close(1008, 'Opaque topic required')
          return
        }
        const topic = frame.topic
        if (frame.type === 'subscribe') {
          if (socket.data.topic === topic) return
          const members = topics.get(topic) ?? new Set<Subscriber>()
          if (members.size >= 8 || (!topics.has(topic) && topics.size >= 1024)) {
            socket.close(1013, 'Room capacity reached')
            return
          }
          remove(socket)
          socket.data.topic = topic
          members.add(socket)
          topics.set(topic, members)
          socket.send(JSON.stringify({ type: 'subscribed', topic }))
          return
        }
        if (frame.type !== 'publish' || socket.data.topic !== topic) {
          socket.close(1008, 'Subscribe before publishing')
          return
        }
        const publication = JSON.stringify({ type: 'publish', topic, payload: frame.payload })
        for (const member of topics.get(topic) ?? [])
          if (member !== socket) member.send(publication)
      },
      close: remove,
    },
  })
}
