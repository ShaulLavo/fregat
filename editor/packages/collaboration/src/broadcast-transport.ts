import type { EditEnvelope, Message } from './protocol'
import { MESSAGE_LIMIT } from './framing'
import { DuplicatePeerSessionError, RoomCrypto, sealedPacketSize } from './room-crypto'
import { TransportRouter } from './transport-router'

export interface BroadcastTransportOptions<E extends EditEnvelope> {
  readonly router: TransportRouter<E>
  readonly crypto: RoomCrypto
  readonly heartbeatInterval: number
  readonly peerTimeout: number
  readonly onError: (error: unknown) => void
}

type BroadcastPayload =
  | { readonly document: string; readonly type: 'announce' | 'leave' }
  | {
      readonly document: string
      readonly type: 'message'
      readonly to: string
      readonly message: unknown
    }

export class BroadcastTransport<E extends EditEnvelope = EditEnvelope> {
  private readonly channel: BroadcastChannel
  private readonly generation = crypto.randomUUID()
  private readonly peers = new Map<string, { time: number; generation: string; sequence: number }>()
  private readonly timer: ReturnType<typeof setInterval>
  private outbound: Promise<void> = Promise.resolve()
  private inbound: Promise<void> = Promise.resolve()
  private queued = 0
  private inboundBytes = 0
  private closed = false

  constructor(private readonly options: BroadcastTransportOptions<E>) {
    const { router, crypto: roomCrypto, heartbeatInterval, peerTimeout } = options
    if (roomCrypto.room !== router.identity.room || roomCrypto.peer !== router.identity.peer)
      throw new TypeError('Room crypto must match the transport identity')
    if (
      !Number.isFinite(heartbeatInterval) ||
      heartbeatInterval <= 0 ||
      !Number.isFinite(peerTimeout) ||
      peerTimeout <= heartbeatInterval
    )
      throw new RangeError('Peer timeout must exceed the positive heartbeat interval')
    this.channel = new BroadcastChannel(`singapore-collaboration:${router.identity.room}`)
    this.channel.onmessage = (event) => {
      const size = sealedPacketSize(event.data)
      if (size === undefined || this.inboundBytes + size > 4 * MESSAGE_LIMIT) return
      this.inboundBytes += size
      this.inbound = this.inbound
        .then(() => this.receive(event.data))
        .catch(async (error) => {
          options.onError(error)
          if (error instanceof DuplicatePeerSessionError) await this.close()
        })
        .finally(() => {
          this.inboundBytes -= size
        })
    }
    // @justification BroadcastChannel has no remote-close or crash event; this heartbeat expires
    // silent peers and advertises membership, and close clears the interval.
    this.timer = setInterval(() => {
      for (const [peer, state] of this.peers)
        if (Date.now() - state.time > peerTimeout) this.remove(peer)
      this.publish({ document: router.identity.document, type: 'announce' })
    }, heartbeatInterval)
    this.publish({ document: router.identity.document, type: 'announce' })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    await this.outbound
    try {
      this.channel.postMessage(
        await this.options.crypto.seal(this.generation, {
          document: this.options.router.identity.document,
          type: 'leave',
        }),
      )
    } finally {
      this.channel.close()
      for (const peer of this.peers.keys()) this.remove(peer)
    }
  }

  private publish(payload: BroadcastPayload): void {
    if (this.closed) return
    const size = new TextEncoder().encode(JSON.stringify(payload)).byteLength
    if (size > MESSAGE_LIMIT || this.queued + size > 2 * MESSAGE_LIMIT) {
      this.options.onError(new RangeError('Broadcast send queue exceeds its byte limit'))
      return
    }
    this.queued += size
    this.outbound = this.outbound
      .then(async () => {
        const packet = await this.options.crypto.seal(this.generation, payload)
        if (!this.closed) this.channel.postMessage(packet)
      })
      .catch(this.options.onError)
      .finally(() => {
        this.queued -= size
      })
  }

  private async receive(input: unknown): Promise<void> {
    if (this.closed) return
    const opened = await this.options.crypto.open(input)
    if (
      !opened ||
      this.closed ||
      !isPayload(opened.payload) ||
      opened.payload.document !== this.options.router.identity.document
    )
      return
    const { sender, generation, sequence } = opened.packet
    const previous = this.peers.get(sender)
    if (previous && sequence <= previous.sequence) return
    const payload = opened.payload
    if (payload.type === 'leave') {
      if (previous?.generation !== generation) return
      this.remove(sender)
      return
    }
    const known = this.peers.has(sender)
    if (
      !known &&
      !this.options.router.add(sender, 'broadcast', (message: Message<E>) =>
        this.publish({
          document: this.options.router.identity.document,
          type: 'message',
          to: sender,
          message,
        }),
      )
    )
      return
    this.peers.set(sender, { time: Date.now(), generation, sequence })
    if (!known) this.publish({ document: this.options.router.identity.document, type: 'announce' })
    if (payload.type === 'message' && payload.to === this.options.router.identity.peer)
      this.options.router.receive(sender, payload.message)
  }

  private remove(peer: string): void {
    this.peers.delete(peer)
    this.options.router.remove(peer, 'broadcast')
  }
}

function isPayload(value: unknown): value is BroadcastPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<BroadcastPayload>
  return (
    typeof payload.document === 'string' &&
    (payload.type === 'announce' ||
      payload.type === 'leave' ||
      (payload.type === 'message' && typeof payload.to === 'string' && 'message' in payload))
  )
}
