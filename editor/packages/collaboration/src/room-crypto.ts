import { MESSAGE_LIMIT } from './framing'

export interface SealedPacket {
  readonly version: 1
  readonly room: string
  readonly sender: string
  readonly generation: string
  readonly sequence: number
  readonly sentAt: number
  readonly iv: string
  readonly ciphertext: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const PACKET_LIFETIME = 60_000

export function createRoomInvitation(): { readonly room: string; readonly secret: string } {
  return { room: crypto.randomUUID(), secret: toBase64(crypto.getRandomValues(new Uint8Array(32))) }
}

export class RoomCrypto {
  private sequence = 0
  private readonly seen = new Map<string, number>()
  private constructor(
    readonly room: string,
    readonly peer: string,
    private readonly key: CryptoKey,
  ) {}

  static async create(room: string, peer: string, secret: string): Promise<RoomCrypto> {
    if (!room || !peer || secret.length < 32)
      throw new TypeError('Room, peer session and high-entropy invitation secret are required')
    const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
      'deriveKey',
    ])
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode(room), iterations: 100_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    return new RoomCrypto(room, peer, key)
  }

  async seal(generation: string, payload: unknown): Promise<SealedPacket> {
    const bytes = encoder.encode(JSON.stringify(payload))
    if (bytes.length > MESSAGE_LIMIT)
      throw new RangeError('Encrypted payload exceeds the message limit')
    const header = {
      version: 1 as const,
      room: this.room,
      sender: this.peer,
      generation,
      sequence: ++this.sequence,
      sentAt: Date.now(),
    }
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: associatedData(header) },
      this.key,
      bytes,
    )
    return { ...header, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
  }

  async open(
    input: unknown,
  ): Promise<{ readonly packet: SealedPacket; readonly payload: unknown } | undefined> {
    if (
      !validPacket(input) ||
      input.room !== this.room ||
      input.sender === this.peer ||
      Math.abs(Date.now() - input.sentAt) > PACKET_LIFETIME
    )
      return undefined
    const replay = JSON.stringify([input.sender, input.generation, input.sequence])
    this.prune()
    if (this.seen.has(replay)) return undefined
    try {
      const iv = fromBase64(input.iv)
      if (iv.length !== 12) return undefined
      const bytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: associatedData(input) },
        this.key,
        fromBase64(input.ciphertext),
      )
      const payload: unknown = JSON.parse(decoder.decode(bytes))
      // Decryption can overlap across adapters; check again after the asynchronous boundary.
      if (this.seen.has(replay)) return undefined
      if (this.seen.size >= 16_384) return undefined
      this.seen.set(replay, input.sentAt)
      return { packet: input, payload }
    } catch {
      return undefined
    }
  }

  private prune(): void {
    const threshold = Date.now() - PACKET_LIFETIME
    for (const [key, time] of this.seen) if (time < threshold) this.seen.delete(key)
  }
}

function associatedData(
  packet: Pick<SealedPacket, 'version' | 'room' | 'sender' | 'generation' | 'sequence' | 'sentAt'>,
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      packet.version,
      packet.room,
      packet.sender,
      packet.generation,
      packet.sequence,
      packet.sentAt,
    ]),
  )
}

function validPacket(value: unknown): value is SealedPacket {
  if (!value || typeof value !== 'object') return false
  const packet = value as Partial<SealedPacket>
  return (
    packet.version === 1 &&
    typeof packet.room === 'string' &&
    packet.room.length <= 256 &&
    typeof packet.sender === 'string' &&
    packet.sender.length <= 256 &&
    typeof packet.generation === 'string' &&
    packet.generation.length <= 256 &&
    Number.isSafeInteger(packet.sequence) &&
    packet.sequence! > 0 &&
    Number.isSafeInteger(packet.sentAt) &&
    typeof packet.iv === 'string' &&
    packet.iv.length === 16 &&
    typeof packet.ciphertext === 'string' &&
    packet.ciphertext.length <= Math.ceil((MESSAGE_LIMIT + 16) / 3) * 4
  )
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 8192)
    text += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(text)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0))
}

export function sealedPacketSize(value: unknown): number | undefined {
  return validPacket(value) ? 2 * value.ciphertext.length + 4096 : undefined
}
