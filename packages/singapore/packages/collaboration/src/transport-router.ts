import type { EditEnvelope, Message } from './protocol'
import { prunePeerHistory } from './peer-history'

export type TransportKind = 'broadcast' | 'webrtc'
export interface SessionEndpoint<E extends EditEnvelope> {
  connect(peer: string): void
  disconnect(peer: string): void
  receive(message: Message<E>): void
}
export interface TransportIdentity {
  readonly room: string
  readonly document: string
  readonly peer: string
}

type Sender<E extends EditEnvelope> = (message: Message<E>) => void

/** One registry owns reachability and deduplication while adapters overlap. */
export class TransportRouter<E extends EditEnvelope = EditEnvelope> {
  private readonly peers = new Map<string, Map<TransportKind, Sender<E>>>()
  private readonly seen = new Map<string, { floor: number; ids: Set<number> }>()
  private readonly listeners = new Set<(peer: string) => void>()

  constructor(
    readonly identity: TransportIdentity,
    private readonly endpoint: SessionEndpoint<E>,
  ) {
    if (!identity.room || !identity.document || !identity.peer)
      throw new TypeError('Room, document and peer session IDs are required')
  }

  has(peer: string, kind: TransportKind): boolean {
    return this.peers.get(peer)?.has(kind) ?? false
  }

  add(peer: string, kind: TransportKind, send: Sender<E>): boolean {
    if (peer === this.identity.peer) return false
    const paths = this.peers.get(peer) ?? new Map<TransportKind, Sender<E>>()
    if (!this.peers.has(peer) && this.peers.size >= 7) return false
    const connected = paths.size > 0
    paths.set(kind, send)
    this.peers.set(peer, paths)
    if (!connected) this.endpoint.connect(peer)
    this.notify(peer)
    return true
  }

  remove(peer: string, kind: TransportKind): void {
    const paths = this.peers.get(peer)
    if (!paths?.delete(kind)) return
    if (paths.size === 0) {
      this.peers.delete(peer)
      this.endpoint.disconnect(peer)
    }
    this.notify(peer)
  }

  send(peer: string, message: Message<E>): void {
    const paths = this.peers.get(peer)
    const send = paths?.get('broadcast') ?? paths?.get('webrtc')
    send?.(message)
  }

  receive(peer: string, input: unknown): void {
    if (!this.peers.has(peer) || !isMessage<E>(input, this.identity, peer)) return
    const previous = this.seen.get(peer)
    if (!previous) prunePeerHistory(this.seen, (candidate) => this.peers.has(candidate))
    const seen = previous ?? { floor: 0, ids: new Set<number>() }
    if (input.messageId <= seen.floor || seen.ids.has(input.messageId)) return
    // A bounded sliding window keeps delayed cross-adapter duplicates fenced.
    seen.floor = Math.max(seen.floor, input.messageId - 4096)
    for (const id of seen.ids) if (id <= seen.floor) seen.ids.delete(id)
    seen.ids.add(input.messageId)
    this.seen.set(peer, seen)
    this.endpoint.receive(input)
  }

  onChange(listener: (peer: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(peer: string): void {
    for (const listener of this.listeners) listener(peer)
  }
}

const MESSAGE_TYPES = new Set([
  'HELLO',
  'HOST_PULSE',
  'ELECTION_OFFER',
  'HOST_CLAIM',
  'SUBMIT',
  'CONFIRM',
  'HAVE',
  'HISTORY_REQUEST',
  'HISTORY_CHUNK',
  'RECONCILE_OFFER',
  'RECONCILE_COMMIT',
  'PRESENCE',
  'LEAVE',
  'HANDOFF',
])

function isMessage<E extends EditEnvelope>(
  value: unknown,
  identity: TransportIdentity,
  peer: string,
): value is Message<E> {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<Message<E>>
  return (
    message.version === 1 &&
    message.room === identity.room &&
    message.document === identity.document &&
    message.sender === peer &&
    Number.isSafeInteger(message.messageId) &&
    message.messageId! > 0 &&
    typeof message.epoch === 'string' &&
    typeof message.type === 'string' &&
    MESSAGE_TYPES.has(message.type) &&
    message.payload !== null &&
    typeof message.payload === 'object'
  )
}
