const HEADER = 68
const CHUNK_LIMIT = 16 * 1024
export const MESSAGE_LIMIT = 8 * 1024 * 1024
const MAGIC = 0x53474301

export async function frameMessage(
  bytes: Uint8Array<ArrayBuffer>,
  maxMessageSize: number,
): Promise<readonly ArrayBuffer[]> {
  if (bytes.length === 0 || bytes.length > MESSAGE_LIMIT)
    throw new RangeError('Message exceeds the transfer limit')
  const limit = maxMessageSize === 0 ? CHUNK_LIMIT : Math.min(CHUNK_LIMIT, maxMessageSize)
  if (!Number.isSafeInteger(limit) || limit <= HEADER)
    throw new RangeError('SCTP message limit cannot carry a chunk')
  const size = limit - HEADER
  const count = Math.ceil(bytes.length / size)
  if (count > 65_536) throw new RangeError('Transfer exceeds the chunk count limit')
  const id = crypto.getRandomValues(new Uint8Array(16))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from({ length: count }, (_, index) => {
    const data = bytes.subarray(index * size, (index + 1) * size)
    const frame = new ArrayBuffer(HEADER + data.length)
    const view = new DataView(frame)
    view.setUint32(0, MAGIC)
    new Uint8Array(frame, 4, 16).set(id)
    view.setUint32(20, index)
    view.setUint32(24, count)
    view.setUint32(28, bytes.length)
    view.setUint32(32, data.length)
    new Uint8Array(frame, 36, 32).set(digest)
    new Uint8Array(frame, HEADER).set(data)
    return frame
  })
}

type Transfer = {
  readonly id: string
  readonly count: number
  readonly length: number
  readonly digest: Uint8Array<ArrayBuffer>
  readonly bytes: Uint8Array<ArrayBuffer>
  index: number
  offset: number
}

/** Ordered channels carry one transfer at a time, bounding incomplete-transfer memory. */
export class FrameReceiver {
  private transfer: Transfer | undefined

  async receive(frame: ArrayBuffer): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (frame.byteLength <= HEADER || frame.byteLength > CHUNK_LIMIT)
      throw new RangeError('Invalid chunk size')
    const view = new DataView(frame)
    if (view.getUint32(0) !== MAGIC) throw new TypeError('Unknown chunk format')
    const id = Array.from(new Uint8Array(frame, 4, 16)).join(',')
    const index = view.getUint32(20)
    const count = view.getUint32(24)
    const length = view.getUint32(28)
    const size = view.getUint32(32)
    const digest = new Uint8Array(frame.slice(36, HEADER))
    if (
      length === 0 ||
      length > MESSAGE_LIMIT ||
      count === 0 ||
      count > 65_536 ||
      count > length ||
      index >= count ||
      size !== frame.byteLength - HEADER
    )
      throw new RangeError('Invalid transfer bounds')
    if (!this.transfer) {
      if (index !== 0) throw new TypeError('Transfer must start with its first chunk')
      this.transfer = {
        id,
        count,
        length,
        digest,
        bytes: new Uint8Array(length),
        index: 0,
        offset: 0,
      }
    }
    const transfer = this.transfer
    if (
      transfer.id !== id ||
      transfer.count !== count ||
      transfer.length !== length ||
      transfer.index !== index ||
      !equalBytes(transfer.digest, digest) ||
      transfer.offset + size > length
    )
      throw new TypeError('Inconsistent ordered transfer')
    transfer.bytes.set(new Uint8Array(frame, HEADER), transfer.offset)
    transfer.offset += size
    transfer.index++
    if (transfer.index !== count) return undefined
    this.transfer = undefined
    if (
      transfer.offset !== length ||
      !equalBytes(new Uint8Array(await crypto.subtle.digest('SHA-256', transfer.bytes)), digest)
    )
      throw new TypeError('Transfer digest or length mismatch')
    return transfer.bytes
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export interface OrderedChannel extends EventTarget {
  readonly readyState: string
  readonly bufferedAmount: number
  bufferedAmountLowThreshold: number
  send(data: ArrayBuffer): void
}

export async function sendFrames(
  channel: OrderedChannel,
  frames: readonly ArrayBuffer[],
  signal: AbortSignal,
): Promise<void> {
  channel.bufferedAmountLowThreshold = 128 * 1024
  for (const frame of frames) {
    signal.throwIfAborted()
    if (channel.readyState !== 'open') throw new TypeError('Data channel closed during transfer')
    if (channel.bufferedAmount + frame.byteLength > 256 * 1024) await waitForDrain(channel, signal)
    signal.throwIfAborted()
    if (channel.readyState !== 'open') throw new TypeError('Data channel closed during transfer')
    channel.send(frame)
  }
}

function waitForDrain(channel: OrderedChannel, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', drained)
      channel.removeEventListener('close', closed)
      channel.removeEventListener('error', closed)
      signal.removeEventListener('abort', closed)
    }
    const drained = () => {
      cleanup()
      resolve()
    }
    const closed = () => {
      cleanup()
      reject(new TypeError('Data channel stopped during backpressure'))
    }
    channel.addEventListener('bufferedamountlow', drained, { once: true })
    channel.addEventListener('close', closed, { once: true })
    channel.addEventListener('error', closed, { once: true })
    signal.addEventListener('abort', closed, { once: true })
    if (signal.aborted || channel.readyState !== 'open') closed()
    else if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) drained()
  })
}
