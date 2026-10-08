import type { Server, ServerWebSocket } from 'bun'
import { clientAddressKey } from './client-address'

type Connection = {
  readonly ip: string
  member?: string
  topic?: string
  deadline?: ReturnType<typeof setTimeout>
  released: boolean
  budgetStarted: number
  frames: number
  bytes: number
}
type Subscriber = ServerWebSocket<Connection>
export type Admission = boolean | { readonly member: string }

export interface SignalingServerOptions {
  readonly hostname: string
  readonly port: number
  readonly allowedOrigins: readonly string[]
  readonly authorize: (request: Request) => Admission | Promise<Admission>
  readonly clientAddress?: (
    request: Request,
    server: Pick<Server<unknown>, 'requestIP'>,
  ) => string | undefined
  readonly ipv6Prefix?: number
  readonly limits: {
    readonly connections: number
    readonly connectionsPerMember?: number
    readonly connectionsPerIP: number
    readonly subscribeTimeout: number
    readonly idleTimeout: number
    readonly framesPerSecond: number
    readonly bytesPerSecond: number
  }
}

/** The broker sees opaque room topics and ciphertext, never document messages. */
export function startSignalingServer(options: SignalingServerOptions) {
  if (typeof options.authorize !== 'function')
    throw new TypeError('An explicit admission policy is required')
  if (
    !options.hostname ||
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535 ||
    options.allowedOrigins.length === 0
  )
    throw new TypeError('An explicit bind host, port and allowed origins are required')
  if (
    !options.limits ||
    [
      options.limits.connections,
      options.limits.connectionsPerIP,
      options.limits.subscribeTimeout,
      options.limits.idleTimeout,
      options.limits.framesPerSecond,
      options.limits.bytesPerSecond,
    ].some((value) => !Number.isSafeInteger(value) || value <= 0)
  )
    throw new TypeError('Positive integer broker limits are required')
  const ipv6Prefix = options.ipv6Prefix ?? 64
  if (!Number.isInteger(ipv6Prefix) || ipv6Prefix < 0 || ipv6Prefix > 128)
    throw new TypeError('IPv6 prefix must be an integer from 0 to 128')
  const connectionsPerMember =
    options.limits.connectionsPerMember ?? Math.min(16, options.limits.connections)
  if (!Number.isSafeInteger(connectionsPerMember) || connectionsPerMember <= 0)
    throw new TypeError('A positive integer per-member limit is required')
  const topics = new Map<string, Set<Subscriber>>()
  const ips = new Map<string, number>()
  const admissions = new Map<string, number>()
  let connections = 0
  const release = (data: Connection) => {
    if (data.released) return
    data.released = true
    connections--
    if (data.member) {
      const count = admissions.get(data.member)! - 1
      if (count === 0) admissions.delete(data.member)
      else admissions.set(data.member, count)
    }
    const count = (ips.get(data.ip) ?? 1) - 1
    if (count === 0) ips.delete(data.ip)
    else ips.set(data.ip, count)
  }
  const remove = (socket: Subscriber) => {
    clearTimeout(socket.data.deadline)
    const members = socket.data.topic ? topics.get(socket.data.topic) : undefined
    members?.delete(socket)
    if (members?.size === 0) topics.delete(socket.data.topic!)
    release(socket.data)
  }
  const arm = (socket: Subscriber, duration: number) => {
    clearTimeout(socket.data.deadline)
    // @justification Silent clients emit no progress event; one deadline per socket bounds
    // subscription and application idle time, is replaced by progress, and is cleared on close.
    socket.data.deadline = setTimeout(() => {
      remove(socket)
      socket.terminate()
    }, duration)
  }
  return Bun.serve<Connection>({
    hostname: options.hostname,
    port: options.port,
    async fetch(request, server) {
      const origin = request.headers.get('origin')
      if (!origin || !options.allowedOrigins.includes(origin))
        return new Response('Origin refused', { status: 403 })
      let address: string | undefined
      try {
        address = options.clientAddress
          ? options.clientAddress(request, server)
          : server.requestIP(request)?.address
      } catch {
        return new Response('Client address refused', { status: 403 })
      }
      const ip = address ? clientAddressKey(address, ipv6Prefix) : undefined
      if (!ip) return new Response('Client address required', { status: 403 })
      if (
        connections >= options.limits.connections ||
        (ips.get(ip) ?? 0) >= options.limits.connectionsPerIP
      )
        return new Response('Connection capacity reached', { status: 429 })
      const protocols = request.headers.get('sec-websocket-protocol')
      if (
        protocols !== null &&
        !protocols.split(',').some((value) => value.trim() === 'singapore-collaboration')
      )
        return new Response('Public signaling protocol required', { status: 400 })
      let admission: Admission | Promise<Admission>
      try {
        admission = options.authorize(request)
      } catch {
        return new Response('Admission refused', { status: 403 })
      }
      if (admission === false) return new Response('Admission refused', { status: 403 })
      const data: Connection = {
        ip,
        released: false,
        budgetStarted: Date.now(),
        frames: 0,
        bytes: 0,
      }
      connections++
      ips.set(ip, (ips.get(ip) ?? 0) + 1)
      let upgraded = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const accepted = await Promise.race([
          Promise.resolve(admission).catch(() => false),
          new Promise<Admission>((resolve) => {
            // @justification Authorization may never settle; the deadline bounds reserved quota,
            // and finally clears it and releases the reservation when upgrade fails.
            timeout = setTimeout(() => resolve(false), options.limits.subscribeTimeout)
          }),
        ])
        let member: string | undefined
        if (accepted === true) member = undefined
        else if (
          accepted &&
          typeof accepted.member === 'string' &&
          accepted.member.length > 0 &&
          accepted.member.length <= 256
        )
          member = `member:${accepted.member}`
        else return new Response('Admission refused', { status: 403 })
        if (member) {
          if ((admissions.get(member) ?? 0) >= connectionsPerMember)
            return new Response('Member capacity reached', { status: 429 })
          data.member = member
          admissions.set(member, (admissions.get(member) ?? 0) + 1)
        }
        upgraded = server.upgrade(request, {
          data,
          headers:
            protocols === null
              ? undefined
              : { 'Sec-WebSocket-Protocol': 'singapore-collaboration' },
        })
        return upgraded ? undefined : new Response('WebSocket upgrade required', { status: 426 })
      } finally {
        clearTimeout(timeout)
        if (!upgraded) release(data)
      }
    },
    websocket: {
      maxPayloadLength: 1024 * 1024,
      idleTimeout: 0,
      sendPings: false,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(socket) {
        arm(socket, options.limits.subscribeTimeout)
      },
      message(socket, raw) {
        if (typeof raw !== 'string') {
          socket.close(1003, 'Text frames required')
          return
        }
        const data = socket.data
        if (Date.now() - data.budgetStarted >= 1000) {
          data.budgetStarted = Date.now()
          data.frames = 0
          data.bytes = 0
        }
        data.frames++
        data.bytes += Buffer.byteLength(raw, 'utf8')
        if (
          data.frames > options.limits.framesPerSecond ||
          data.bytes > options.limits.bytesPerSecond
        ) {
          remove(socket)
          socket.terminate()
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
          if (data.topic === topic) return
          if (data.topic) {
            socket.close(1008, 'One subscription per connection')
            return
          }
          const members = topics.get(topic) ?? new Set<Subscriber>()
          if (
            members.size >= 8 ||
            (!topics.has(topic) && topics.size >= options.limits.connections)
          ) {
            socket.close(1013, 'Room capacity reached')
            return
          }
          data.topic = topic
          members.add(socket)
          topics.set(topic, members)
          arm(socket, options.limits.idleTimeout)
          socket.send(JSON.stringify({ type: 'subscribed', topic }))
          return
        }
        if (frame.type !== 'publish' || data.topic !== topic) {
          socket.close(1008, 'Subscribe before publishing')
          return
        }
        arm(socket, options.limits.idleTimeout)
        const publication = JSON.stringify({ type: 'publish', topic, payload: frame.payload })
        for (const member of topics.get(topic) ?? [])
          if (member !== socket) member.send(publication)
      },
      close: remove,
    },
  })
}
