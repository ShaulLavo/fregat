import type { SealedPacket } from './room-crypto'

export interface SignalingClient {
  start(receive: (packet: unknown) => void, ready: () => void): void
  publish(packet: SealedPacket): void
  close(): void
}

export interface WebSocketSignalingOptions {
  readonly urls: readonly string[]
  readonly room: string
  readonly credentials: {
    readonly protocols: (signal: AbortSignal) => readonly string[] | Promise<readonly string[]>
  }
  readonly reconnectInterval: number
  readonly onError: (error: unknown, url: string, direction: 'send' | 'receive') => void
  readonly onRecovery?: (url: string, direction: 'send' | 'receive') => void
}

export class WebSocketSignaling implements SignalingClient {
  private readonly sockets = new Map<string, WebSocket>()
  private readonly pending = new Map<string, AbortController>()
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
    for (const url of new Set(this.options.urls)) void this.connect(url)
  }

  publish(packet: SealedPacket): void {
    if (packet.room !== this.options.room)
      throw new TypeError('Packet belongs to another signaling room')
    const frame = JSON.stringify({ type: 'publish', topic: this.options.room, payload: packet })
    if (frame.length > 1024 * 1024) throw new RangeError('Signaling frame exceeds the broker limit')
    for (const [url, socket] of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue
      if (socket.bufferedAmount > 1024 * 1024) {
        socket.close(1013, 'Signaling backpressure')
        continue
      }
      try {
        socket.send(frame)
        this.options.onRecovery?.(url, 'send')
      } catch (error) {
        this.options.onError(error, url, 'send')
      }
    }
  }

  close(): void {
    this.closed = true
    for (const abort of this.pending.values()) abort.abort()
    this.pending.clear()
    for (const retry of this.retries.values()) clearTimeout(retry)
    this.retries.clear()
    for (const socket of this.sockets.values()) socket.close()
    this.sockets.clear()
  }

  private async connect(url: string): Promise<void> {
    if (this.closed) return
    this.retries.delete(url)
    const abort = new AbortController()
    this.pending.set(url, abort)
    try {
      const protocols = await this.options.credentials.protocols(abort.signal)
      if (abort.signal.aborted) return
      this.openSocket(url, protocols)
    } catch (error) {
      if (abort.signal.aborted) return
      this.options.onError(error, url, 'send')
      this.reconnect(url)
    } finally {
      this.pending.delete(url)
    }
  }

  private openSocket(url: string, protocols: readonly string[]): void {
    const socket = new WebSocket(url, [...new Set(['singapore-collaboration'].concat(protocols))])
    this.sockets.set(url, socket)
    socket.onopen = () => {
      if (this.closed || this.sockets.get(url) !== socket) return
      try {
        socket.send(JSON.stringify({ type: 'subscribe', topic: this.options.room }))
      } catch (error) {
        this.options.onError(error, url, 'send')
      }
    }
    socket.onmessage = (event) => {
      if (
        this.closed ||
        this.sockets.get(url) !== socket ||
        typeof event.data !== 'string' ||
        event.data.length > 1024 * 1024
      )
        return
      try {
        const frame = JSON.parse(event.data)
        if (frame.topic !== this.options.room) return
        if (frame.type === 'subscribed') {
          this.callbacks?.ready()
          this.options.onRecovery?.(url, 'receive')
        }
        if (frame.type === 'publish') {
          this.callbacks?.receive(frame.payload)
          this.options.onRecovery?.(url, 'receive')
        }
      } catch (error) {
        this.options.onError(error, url, 'receive')
      }
    }
    socket.onerror = () => {
      if (this.closed || this.sockets.get(url) !== socket) return
      this.options.onError(new TypeError('Signaling connection failed'), url, 'send')
    }
    socket.onclose = () => {
      if (this.sockets.get(url) !== socket) return
      this.sockets.delete(url)
      this.reconnect(url)
    }
  }

  private reconnect(url: string): void {
    if (this.closed) return
    this.retries.set(
      url,
      // @justification Remote broker readiness has no notification; one retry per URL spaces
      // reconnect attempts, connect checks closed, and close clears every pending retry.
      setTimeout(() => void this.connect(url), this.options.reconnectInterval),
    )
  }
}
