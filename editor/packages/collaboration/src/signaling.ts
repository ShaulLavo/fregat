import type { SealedPacket } from './room-crypto'

export interface SignalingClient {
  start(receive: (packet: unknown) => void, ready: () => void): void
  publish(packet: SealedPacket): void
  close(): void
}

export interface WebSocketSignalingOptions {
  readonly urls: readonly string[]
  readonly room: string
  readonly credentials: { readonly protocols: readonly string[] }
  readonly reconnectInterval: number
  readonly onError: (error: unknown) => void
}

export class WebSocketSignaling implements SignalingClient {
  private readonly sockets = new Map<string, WebSocket>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private callbacks: { receive: (packet: unknown) => void; ready: () => void } | undefined
  private closed = false

  constructor(private readonly options: WebSocketSignalingOptions) {
    if (!options.room || options.urls.length === 0)
      throw new TypeError('A room and signaling URLs are required')
    if (!Number.isFinite(options.reconnectInterval) || options.reconnectInterval <= 0)
      throw new RangeError('Signaling reconnect interval must be positive')
    for (const url of options.urls)
      if (!['ws:', 'wss:'].includes(new URL(url).protocol))
        throw new TypeError('Signaling URL must use ws or wss')
  }

  start(receive: (packet: unknown) => void, ready: () => void): void {
    if (this.closed || this.callbacks) throw new TypeError('Signaling client can be started once')
    this.callbacks = { receive, ready }
    for (const url of new Set(this.options.urls)) this.connect(url)
  }

  publish(packet: SealedPacket): void {
    if (packet.room !== this.options.room)
      throw new TypeError('Packet belongs to another signaling room')
    const frame = JSON.stringify({ type: 'publish', topic: this.options.room, payload: packet })
    if (frame.length > 1024 * 1024) throw new RangeError('Signaling frame exceeds the broker limit')
    for (const socket of this.sockets.values()) {
      if (socket.readyState !== WebSocket.OPEN) continue
      if (socket.bufferedAmount > 1024 * 1024) {
        socket.close(1013, 'Signaling backpressure')
        continue
      }
      socket.send(frame)
    }
  }

  close(): void {
    this.closed = true
    for (const retry of this.retries.values()) clearTimeout(retry)
    this.retries.clear()
    for (const socket of this.sockets.values()) socket.close()
    this.sockets.clear()
  }

  private connect(url: string): void {
    if (this.closed) return
    this.retries.delete(url)
    const socket = new WebSocket(url, [...this.options.credentials.protocols])
    this.sockets.set(url, socket)
    socket.onopen = () =>
      socket.send(JSON.stringify({ type: 'subscribe', topic: this.options.room }))
    socket.onmessage = (event) => {
      if (this.closed || typeof event.data !== 'string' || event.data.length > 1024 * 1024) return
      try {
        const frame = JSON.parse(event.data)
        if (frame.topic !== this.options.room) return
        if (frame.type === 'subscribed') this.callbacks?.ready()
        if (frame.type === 'publish') this.callbacks?.receive(frame.payload)
      } catch (error) {
        this.options.onError(error)
      }
    }
    socket.onerror = () => this.options.onError(new TypeError('Signaling connection failed'))
    socket.onclose = () => {
      this.sockets.delete(url)
      if (!this.closed)
        this.retries.set(
          url,
          // @justification Remote broker readiness has no notification; one retry per URL spaces
          // reconnect attempts, connect checks closed, and close clears every pending retry.
          setTimeout(() => this.connect(url), this.options.reconnectInterval),
        )
    }
  }
}
