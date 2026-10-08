import { frameMessage, FrameReceiver, MESSAGE_LIMIT, sendFrames } from './framing'
import type { EditEnvelope, Message } from './protocol'
import { DuplicatePeerSessionError, RoomCrypto, sealedPacketSize } from './room-crypto'
import type { SignalingClient } from './signaling'
import { TransportRouter } from './transport-router'
import { prunePeerHistory } from './peer-history'

export interface WebRTCTransportOptions<E extends EditEnvelope> {
  readonly router: TransportRouter<E>
  readonly crypto: RoomCrypto
  readonly signaling: SignalingClient
  readonly iceServers: readonly RTCIceServer[]
  readonly transportPolicy: RTCIceTransportPolicy
  readonly credentials: {
    readonly turn?: (peer: string, signal: AbortSignal) => Promise<readonly RTCIceServer[]>
  }
  readonly announceInterval: number
  readonly connectionTimeout: number
  readonly onError: (error: unknown, peer?: string, direction?: 'send' | 'receive') => void
  readonly onRecovery?: (peer?: string, direction?: 'send' | 'receive') => void
  readonly onPeerLeft?: (peer: string) => void
}

type Signal =
  | { readonly type: 'announce'; readonly document: string }
  | { readonly type: 'leave'; readonly document: string }
  | {
      readonly type: 'offer' | 'answer'
      readonly document: string
      readonly to: string
      readonly description: RTCSessionDescriptionInit
    }
type Link = {
  readonly peer: string
  readonly generation: string
  readonly pc: RTCPeerConnection
  readonly abort: AbortController
  readonly timeout: ReturnType<typeof setTimeout>
  channel?: RTCDataChannel
  outbound: Promise<void>
  inbound: Promise<void>
  queued: number
  inboundBytes: number
}

/** Native full-mesh links. Lower peer-session IDs initiate each pair. */
export class WebRTCTransport<E extends EditEnvelope = EditEnvelope> {
  private readonly links = new Map<string, Link>()
  private readonly pending = new Map<string, AbortController>()
  private readonly handshakes = new Map<
    string,
    { tail: Promise<void>; count: number; bytes: number }
  >()
  private handshakeBytes = 0
  private readonly discovered = new Map<
    string,
    { time: number; advertisement?: string; sequence: number }
  >()
  private readonly latestOffers = new Map<string, number>()
  private readonly retired = new Set<string>()
  private readonly generation = crypto.randomUUID()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly unsubscribe: () => void
  private outbound: Promise<void> = Promise.resolve()
  private inbound: Promise<void> = Promise.resolve()
  private inboundBytes = 0
  private closed = false

  constructor(private readonly options: WebRTCTransportOptions<E>) {
    if (
      options.crypto.room !== options.router.identity.room ||
      options.crypto.peer !== options.router.identity.peer
    )
      throw new TypeError('Room crypto must match the transport identity')
    if (
      !['all', 'relay'].includes(options.transportPolicy) ||
      !Array.isArray(options.iceServers) ||
      !options.credentials
    )
      throw new TypeError('ICE servers, transport policy and credentials are required')
    if (
      !Number.isFinite(options.announceInterval) ||
      options.announceInterval <= 0 ||
      !Number.isFinite(options.connectionTimeout) ||
      options.connectionTimeout <= options.announceInterval
    )
      throw new RangeError('Connection timeout must exceed the positive announce interval')
    this.unsubscribe = options.router.onChange((peer) => {
      if (options.router.has(peer, 'broadcast')) {
        this.pending.get(peer)?.abort()
        const link = this.links.get(peer)
        if (link) this.remove(link)
        return
      }
      if (this.discovered.has(peer)) this.initiate(peer)
    })
    options.signaling.start(
      (packet) => {
        const size = sealedPacketSize(packet)
        if (
          size === undefined ||
          size > 2 * 1024 * 1024 ||
          this.inboundBytes + size > 4 * 1024 * 1024
        )
          return
        this.inboundBytes += size
        this.inbound = this.inbound
          .then(() => this.receive(packet))
          .catch(async (error) => {
            options.onError(error, undefined, 'receive')
            if (error instanceof DuplicatePeerSessionError) await this.close()
          })
          .finally(() => {
            this.inboundBytes -= size
          })
      },
      () => this.announce(),
    )
    // @justification Signaling has no peer-roster notification; discovery announcements and retries
    // expire silent peers on this protocol clock, which close clears.
    this.timer = setInterval(() => {
      this.announce()
      for (const [peer, discovery] of this.discovered) {
        if (
          !this.links.has(peer) &&
          !this.pending.has(peer) &&
          Date.now() - discovery.time > options.connectionTimeout
        ) {
          this.discovered.delete(peer)
          continue
        }
        this.initiate(peer)
      }
    }, options.announceInterval)
  }

  get connections(): number {
    return this.links.size
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    this.unsubscribe()
    for (const abort of this.pending.values()) abort.abort()
    await this.outbound
    try {
      this.options.signaling.publish(
        await this.options.crypto.seal(this.generation, {
          type: 'leave',
          document: this.options.router.identity.document,
        }),
      )
    } finally {
      this.options.signaling.close()
      for (const link of this.links.values()) this.remove(link)
      this.discovered.clear()
    }
  }

  private announce(): void {
    this.publish(this.generation, {
      type: 'announce',
      document: this.options.router.identity.document,
    })
  }

  private publish(generation: string, payload: Signal): void {
    if (this.closed) return
    this.outbound = this.outbound
      .then(async () => {
        const packet = await this.options.crypto.seal(generation, payload)
        if (this.closed) return
        this.options.signaling.publish(packet)
        this.options.onRecovery?.(undefined, 'send')
      })
      .catch((error) => this.options.onError(error, undefined, 'send'))
  }

  private async receive(input: unknown): Promise<void> {
    if (this.closed) return
    const opened = await this.options.crypto.open(input)
    if (
      !opened ||
      this.closed ||
      !isSignal(opened.payload) ||
      opened.payload.document !== this.options.router.identity.document
    )
      return
    this.options.onRecovery?.(undefined, 'receive')
    const { sender, generation } = opened.packet
    const payload = opened.payload
    if (payload.type === 'leave') {
      const discovery = this.discovered.get(sender)
      if (
        !discovery ||
        discovery.advertisement !== generation ||
        opened.packet.sequence <= discovery.sequence
      )
        return
      this.discovered.delete(sender)
      this.pending.get(sender)?.abort()
      const link = this.links.get(sender)
      if (link) this.remove(link)
      this.options.onPeerLeft?.(sender)
      return
    }
    if (!this.discovered.has(sender) && this.discovered.size >= 7) return
    const discovery: { time: number; advertisement?: string; sequence: number } =
      this.discovered.get(sender) ?? { time: Date.now(), sequence: 0 }
    discovery.time = Date.now()
    if (payload.type === 'announce' && opened.packet.sequence > discovery.sequence) {
      discovery.sequence = opened.packet.sequence
      discovery.advertisement = generation
    }
    this.discovered.set(sender, discovery)
    if (this.options.router.has(sender, 'broadcast')) return
    if (payload.type === 'announce') {
      this.initiate(sender)
      return
    }
    if (payload.to !== this.options.router.identity.peer || this.retired.has(generation)) return
    // Retain only the SDP dictionary fields accounted for by the per-peer queue.
    const description: RTCSessionDescriptionInit = {
      type: payload.description.type,
      sdp: payload.description.sdp,
    }
    if (payload.type === 'offer') {
      if (
        sender >= this.options.router.identity.peer ||
        opened.packet.sequence <= (this.latestOffers.get(sender) ?? 0)
      )
        return
      if (!this.latestOffers.has(sender))
        prunePeerHistory(this.latestOffers, (peer) => this.discovered.has(peer))
      this.latestOffers.set(sender, opened.packet.sequence)
      const existing = this.links.get(sender)
      if (existing?.generation === generation) return
      this.pending.get(sender)?.abort()
      if (existing) this.remove(existing)
      const sequence = opened.packet.sequence
      this.enqueue(sender, description, async () => {
        if (this.latestOffers.get(sender) !== sequence || !this.discovered.has(sender)) return
        const link = await this.create(sender, generation)
        if (!link) return
        try {
          await link.pc.setRemoteDescription(description)
          if (!this.current(link)) return
          await link.pc.setLocalDescription(await link.pc.createAnswer())
          if (!this.current(link)) return
          await gatherIce(link.pc, link.abort.signal)
          if (this.current(link))
            this.publish(generation, {
              type: 'answer',
              document: this.options.router.identity.document,
              to: sender,
              description: link.pc.localDescription!.toJSON(),
            })
        } catch (error) {
          this.fail(link, error)
        }
      })
      return
    }
    const link = this.links.get(sender)
    if (!link || link.generation !== generation) return
    this.enqueue(sender, description, async () => {
      if (!this.current(link) || link.pc.signalingState !== 'have-local-offer') return
      try {
        await link.pc.setRemoteDescription(description)
      } catch (error) {
        this.fail(link, error)
      }
    })
  }

  private enqueue(
    peer: string,
    description: RTCSessionDescriptionInit,
    work: () => Promise<void>,
  ): void {
    const queue = this.handshakes.get(peer) ?? { tail: Promise.resolve(), count: 0, bytes: 0 }
    const size = 2 * (description.sdp?.length ?? 0) + 4096
    const budget = 4 * 1024 * 1024
    if (queue.count >= 8 || queue.bytes + size > budget / 7 || this.handshakeBytes + size > budget)
      return
    queue.bytes += size
    this.handshakeBytes += size
    queue.count++
    this.handshakes.set(peer, queue)
    queue.tail = queue.tail
      .then(() => {
        if (!this.closed) return work()
      })
      .catch((error) => this.options.onError(error, peer))
      .finally(() => {
        this.handshakeBytes -= size
        queue.bytes -= size
        queue.count--
        if (queue.count === 0) this.handshakes.delete(peer)
      })
  }

  private initiate(peer: string): void {
    if (
      this.closed ||
      this.options.router.identity.peer >= peer ||
      this.links.has(peer) ||
      this.pending.has(peer) ||
      this.options.router.has(peer, 'broadcast')
    )
      return
    void this.offer(peer).catch((error) => this.options.onError(error, peer))
  }

  private async offer(peer: string): Promise<void> {
    const link = await this.create(peer, crypto.randomUUID())
    if (!link) return
    try {
      this.attach(link, link.pc.createDataChannel('singapore-collaboration', { ordered: true }))
      await link.pc.setLocalDescription(await link.pc.createOffer())
      await gatherIce(link.pc, link.abort.signal)
      if (this.current(link))
        this.publish(link.generation, {
          type: 'offer',
          document: this.options.router.identity.document,
          to: peer,
          description: link.pc.localDescription!.toJSON(),
        })
    } catch (error) {
      this.fail(link, error)
    }
  }

  private async create(peer: string, generation: string): Promise<Link | undefined> {
    if (this.pending.has(peer) || this.closed) return undefined
    const abort = new AbortController()
    this.pending.set(peer, abort)
    // @justification A TURN supplier may never settle; abort bounds the wait, finally clears
    // the deadline, and close aborts pending requests.
    const credentialTimeout = setTimeout(() => abort.abort(), this.options.connectionTimeout)
    try {
      const credentials = await supplyCredentials(this.options.credentials.turn, peer, abort.signal)
      if (
        abort.signal.aborted ||
        this.closed ||
        this.options.router.has(peer, 'broadcast') ||
        !this.discovered.has(peer)
      )
        return undefined
      const pc = new RTCPeerConnection({
        iceServers: [...this.options.iceServers, ...credentials],
        iceTransportPolicy: this.options.transportPolicy,
      })
      const link: Link = {
        peer,
        generation,
        pc,
        abort: new AbortController(),
        // @justification Native connection setup can stall without a terminal event; channel open
        // or removal clears this deadline, and failure checks the current link generation.
        timeout: setTimeout(
          () => this.fail(link, new TypeError('Peer connection timed out')),
          this.options.connectionTimeout,
        ),
        outbound: Promise.resolve(),
        inbound: Promise.resolve(),
        queued: 0,
        inboundBytes: 0,
      }
      this.links.set(peer, link)
      pc.ondatachannel = (event) => this.attach(link, event.channel)
      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed' ||
          pc.connectionState === 'disconnected'
        )
          this.fail(link, new TypeError('Peer connection stopped'))
      }
      return link
    } catch (error) {
      if (!abort.signal.aborted) throw error
      return undefined
    } finally {
      clearTimeout(credentialTimeout)
      if (this.pending.get(peer) === abort) this.pending.delete(peer)
    }
  }

  private attach(link: Link, channel: RTCDataChannel): void {
    if (!this.current(link)) {
      channel.close()
      return
    }
    if (
      link.channel ||
      channel.ordered !== true ||
      channel.maxRetransmits !== null ||
      channel.maxPacketLifeTime !== null ||
      channel.label !== 'singapore-collaboration'
    ) {
      channel.close()
      this.fail(link, new TypeError('Expected one reliable ordered data channel'))
      return
    }
    link.channel = channel
    channel.binaryType = 'arraybuffer'
    const receiver = new FrameReceiver()
    channel.onopen = () => {
      if (!this.current(link)) return
      clearTimeout(link.timeout)
      if (!this.options.router.add(link.peer, 'webrtc', (message) => this.send(link, message))) {
        this.remove(link)
        return
      }
      this.options.onRecovery?.(link.peer)
    }
    channel.onmessage = (event) => {
      if (
        !(event.data instanceof ArrayBuffer) ||
        event.data.byteLength > 16 * 1024 ||
        link.inboundBytes + event.data.byteLength > 2 * MESSAGE_LIMIT
      ) {
        this.fail(link, new RangeError('Data channel receive queue exceeds its byte limit'))
        return
      }
      const size = event.data.byteLength
      link.inboundBytes += size
      link.inbound = link.inbound
        .then(async () => {
          if (!this.current(link)) return
          if (!(event.data instanceof ArrayBuffer))
            throw new TypeError('Data channel requires binary chunks')
          const bytes = await receiver.receive(event.data)
          if (bytes && this.current(link))
            this.options.router.receive(
              link.peer,
              JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
            )
        })
        .catch((error) => this.fail(link, error))
        .finally(() => {
          link.inboundBytes -= size
        })
    }
    channel.onclose = () => {
      if (this.current(link)) this.fail(link, new TypeError('Data channel closed'))
    }
    channel.onerror = () => this.fail(link, new TypeError('Data channel failed'))
  }

  private send(link: Link, message: Message<E>): void {
    const bytes = new TextEncoder().encode(JSON.stringify(message))
    if (bytes.length > MESSAGE_LIMIT || link.queued + bytes.length > 2 * MESSAGE_LIMIT) {
      this.fail(link, new RangeError('Data channel queue exceeds its byte limit'))
      return
    }
    link.queued += bytes.length
    link.outbound = link.outbound
      .then(async () => {
        if (!this.current(link) || !link.channel) return
        const frames = await frameMessage(bytes, link.pc.sctp?.maxMessageSize ?? 16 * 1024)
        await sendFrames(link.channel, frames, link.abort.signal)
      })
      .catch((error) => this.fail(link, error))
      .finally(() => {
        link.queued -= bytes.length
      })
  }

  private current(link: Link): boolean {
    return !this.closed && this.links.get(link.peer) === link
  }

  private fail(link: Link, error: unknown): void {
    if (!this.current(link)) return
    this.remove(link)
    this.options.onError(error, link.peer)
    this.announce()
  }

  private remove(link: Link): void {
    if (this.links.get(link.peer) !== link) return
    this.links.delete(link.peer)
    this.retired.add(link.generation)
    if (this.retired.size > 1024) this.retired.delete(this.retired.values().next().value!)
    clearTimeout(link.timeout)
    link.abort.abort()
    link.pc.onconnectionstatechange = null
    if (link.channel) {
      link.channel.onclose = null
      link.channel.onerror = null
    }
    link.pc.close()
    this.options.router.remove(link.peer, 'webrtc')
  }
}

function isSignal(value: unknown): value is Signal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Partial<Signal>
  if (typeof signal.document !== 'string') return false
  if (signal.type === 'announce' || signal.type === 'leave') return true
  return (
    (signal.type === 'offer' || signal.type === 'answer') &&
    typeof signal.to === 'string' &&
    typeof signal.description === 'object' &&
    signal.description !== null &&
    signal.description.type === signal.type &&
    typeof signal.description.sdp === 'string' &&
    signal.description.sdp.length <= 256 * 1024
  )
}

function gatherIce(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      pc.removeEventListener('icegatheringstatechange', changed)
      signal.removeEventListener('abort', aborted)
    }
    const changed = () => {
      if (pc.iceGatheringState !== 'complete') return
      cleanup()
      resolve()
    }
    const aborted = () => {
      cleanup()
      reject(new TypeError('ICE gathering stopped'))
    }
    pc.addEventListener('icegatheringstatechange', changed)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    else changed()
  })
}

function supplyCredentials(
  supplier: WebRTCTransportOptions<EditEnvelope>['credentials']['turn'],
  peer: string,
  signal: AbortSignal,
): Promise<readonly RTCIceServer[]> {
  if (!supplier) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new TypeError('TURN credential request stopped'))
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) {
      aborted()
      return
    }
    Promise.resolve()
      .then(() => supplier(peer, signal))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted))
  })
}
