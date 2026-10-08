import { describe, expect, test, vi } from 'vitest'
import { frameMessage, FrameReceiver, MESSAGE_LIMIT, sendFrames } from '../src/framing'
import { createRoomInvitation, RoomCrypto, sealedPacketSize } from '../src/room-crypto'
import { WebSocketSignaling } from '../src/signaling'

const encoder = new TextEncoder()

test('signaling opens one socket per distinct configured URL', async () => {
  const urls: string[] = []
  const offered: string[][] = []
  vi.stubGlobal(
    'WebSocket',
    class Socket {
      constructor(url: string, protocols: string[]) {
        urls.push(url)
        offered.push(protocols)
      }
      close() {}
    },
  )
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345', 'ws://localhost:12345'],
    room: crypto.randomUUID(),
    credentials: { protocols: () => ['private-token', 'singapore-collaboration'] },
    reconnectInterval: 100,
    onError: vi.fn(),
  })
  try {
    signaling.start(vi.fn(), vi.fn())
    await vi.waitFor(() => expect(urls).toEqual(['ws://localhost:12345']))
    expect(offered).toEqual([['singapore-collaboration', 'private-token']])
  } finally {
    signaling.close()
    vi.unstubAllGlobals()
  }
})

test('signaling requests renewed credentials before each reconnect', async () => {
  vi.useFakeTimers()
  const sockets: Socket[] = []
  class Socket {
    onclose?: () => void
    constructor(
      _url: string,
      readonly protocols: readonly string[],
    ) {
      sockets.push(this)
    }
    close() {
      this.onclose?.()
    }
  }
  vi.stubGlobal('WebSocket', Socket)
  let token = 'initial-admission'
  const credentials = vi.fn(() => [token])
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345'],
    room: crypto.randomUUID(),
    credentials: { protocols: credentials },
    reconnectInterval: 100,
    onError: vi.fn(),
  })
  try {
    signaling.start(vi.fn(), vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets[0]?.protocols).toEqual(['singapore-collaboration', 'initial-admission'])
    token = 'renewed-admission'
    sockets[0]!.close()
    await vi.advanceTimersByTimeAsync(100)
    expect(sockets[1]?.protocols).toEqual(['singapore-collaboration', 'renewed-admission'])
    expect(credentials).toHaveBeenCalledTimes(2)
  } finally {
    signaling.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

test('closing signaling cancels pending credentials and ignores their late result', async () => {
  const socket = vi.fn()
  vi.stubGlobal(
    'WebSocket',
    class Socket {
      constructor() {
        socket()
      }
    },
  )
  let complete!: (protocols: readonly string[]) => void
  let pendingSignal!: AbortSignal
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345'],
    room: crypto.randomUUID(),
    credentials: {
      protocols: (signal) => {
        pendingSignal = signal
        return new Promise((resolve) => {
          complete = resolve
        })
      },
    },
    reconnectInterval: 100,
    onError: vi.fn(),
  })
  try {
    signaling.start(vi.fn(), vi.fn())
    signaling.close()
    expect(pendingSignal.aborted).toBe(true)
    complete(['late-admission'])
    await Promise.resolve()
    expect(socket).not.toHaveBeenCalled()
  } finally {
    signaling.close()
    vi.unstubAllGlobals()
  }
})

test('signaling retries a failed credential request before opening a socket', async () => {
  vi.useFakeTimers()
  const socket = vi.fn()
  vi.stubGlobal(
    'WebSocket',
    class Socket {
      constructor() {
        socket()
      }
      close() {}
    },
  )
  const failure = new TypeError('Credential storage unavailable')
  const credentials = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(['renewed-admission'])
  const onError = vi.fn()
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345'],
    room: crypto.randomUUID(),
    credentials: { protocols: credentials },
    reconnectInterval: 100,
    onError,
  })
  try {
    signaling.start(vi.fn(), vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(socket).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(failure)
    await vi.advanceTimersByTimeAsync(100)
    expect(socket).toHaveBeenCalledTimes(1)
    expect(credentials).toHaveBeenCalledTimes(2)
  } finally {
    signaling.close()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

describe('ordered binary framing', () => {
  test.each([256, 16_384, 65_536, 0])('round trips within negotiated maximum %s', async (limit) => {
    const bytes = encoder.encode('😀\u0000x'.repeat(10_000))
    const frames = await frameMessage(bytes, limit)
    expect(frames.every((frame) => frame.byteLength <= Math.min(limit || 16_384, 16_384))).toBe(
      true,
    )
    const receiver = new FrameReceiver()
    let result: Uint8Array | undefined
    for (const frame of frames) result = await receiver.receive(frame)
    expect(result).toEqual(bytes)
  })

  test('rejects oversized messages and unusable SCTP limits', async () => {
    await expect(frameMessage(new Uint8Array(MESSAGE_LIMIT + 1), 16_384)).rejects.toThrow(
      RangeError,
    )
    await expect(frameMessage(encoder.encode('x'), 68)).rejects.toThrow(RangeError)
    await expect(frameMessage(encoder.encode('x'), NaN)).rejects.toThrow(RangeError)
    await expect(frameMessage(new Uint8Array(65_537), 69)).rejects.toThrow('chunk count')
  })

  test('rejects corruption, reordering and inconsistent bounds', async () => {
    const frames = await frameMessage(encoder.encode('x'.repeat(1000)), 256)
    await expect(new FrameReceiver().receive(frames[1]!)).rejects.toThrow('first chunk')
    const corrupted = frames[0]!.slice(0)
    new Uint8Array(corrupted)[corrupted.byteLength - 1] =
      new Uint8Array(corrupted)[corrupted.byteLength - 1]! ^ 1
    const receiver = new FrameReceiver()
    await receiver.receive(corrupted)
    for (const frame of frames.slice(1, -1)) await receiver.receive(frame)
    await expect(receiver.receive(frames.at(-1)!)).rejects.toThrow('digest')
    const invalid = frames[0]!.slice(0)
    new DataView(invalid).setUint32(28, MESSAGE_LIMIT + 1)
    await expect(new FrameReceiver().receive(invalid)).rejects.toThrow('bounds')
    const ordered = new FrameReceiver()
    await ordered.receive(frames[0]!)
    await expect(ordered.receive(frames[0]!)).rejects.toThrow('ordered transfer')
  })

  test('waits for bufferedamountlow and aborts a blocked send', async () => {
    class Channel extends EventTarget {
      readyState = 'open'
      bufferedAmount = 256 * 1024
      bufferedAmountLowThreshold = 0
      sent: ArrayBuffer[] = []
      send(frame: ArrayBuffer) {
        this.sent.push(frame)
      }
    }
    const channel = new Channel()
    const abort = new AbortController()
    const frames = await frameMessage(encoder.encode('message'), 16_384)
    const pending = sendFrames(channel, frames, abort.signal)
    expect(channel.sent).toHaveLength(0)
    channel.bufferedAmount = 0
    channel.dispatchEvent(new Event('bufferedamountlow'))
    await pending
    expect(channel.sent).toHaveLength(1)
    channel.bufferedAmount = 256 * 1024
    const blocked = sendFrames(channel, frames, abort.signal)
    abort.abort()
    await expect(blocked).rejects.toThrow('backpressure')
    for (const event of ['close', 'error']) {
      const stopped = new Channel()
      const waiting = sendFrames(stopped, frames, new AbortController().signal)
      stopped.readyState = 'closed'
      stopped.dispatchEvent(new Event(event))
      await expect(waiting).rejects.toThrow('backpressure')
    }
    const stopped = new Channel()
    const waiting = sendFrames(stopped, frames, new AbortController().signal)
    stopped.readyState = 'closed'
    stopped.bufferedAmount = 0
    stopped.dispatchEvent(new Event('bufferedamountlow'))
    await expect(waiting).rejects.toThrow('closed')
  })
})

describe('authenticated room packets', () => {
  test('rejects unused packet fields before queue accounting and decryption', async () => {
    const { room, secret } = createRoomInvitation()
    const sender = await RoomCrypto.create(room, 'a', secret)
    const receiver = await RoomCrypto.create(room, 'b', secret)
    const packet = await sender.seal('generation', 'legitimate')
    expect(sealedPacketSize(packet)).toBeGreaterThan(0)
    const padded = { ...packet, padding: 'x'.repeat(65_536) }
    const size = sealedPacketSize(padded)
    const opened = await receiver.open(padded)
    expect({ size, opened: Boolean(opened) }).toEqual({ size: undefined, opened: false })
    expect((await receiver.open(packet))?.payload).toBe('legitimate')
  })

  test('binds sender, room, generation and sequence and rejects replay', async () => {
    const { room, secret } = createRoomInvitation()
    const sender = await RoomCrypto.create(room, 'a', secret)
    const receiver = await RoomCrypto.create(room, 'b', secret)
    const packet = await sender.seal('generation', { offer: 'private SDP' })
    for (const changed of [
      { sender: 'c' },
      { room: 'other' },
      { generation: 'old' },
      { sequence: 2 },
      { sentAt: 0 },
    ])
      expect(await receiver.open({ ...packet, ...changed })).toBeUndefined()
    const [first, duplicate] = await Promise.all([receiver.open(packet), receiver.open(packet)])
    expect([first, duplicate].filter(Boolean)).toHaveLength(1)
    expect((first ?? duplicate)?.payload).toEqual({ offer: 'private SDP' })
    expect(await receiver.open(packet)).toBeUndefined()
    expect(await sender.open(packet)).toBeUndefined()
  })

  test('accepts reordered packets and independent connection generations', async () => {
    const { room, secret } = createRoomInvitation()
    const sender = await RoomCrypto.create(room, 'a', secret)
    const receiver = await RoomCrypto.create(room, 'b', secret)
    const packets = await Promise.all([0, 1, 2].map((value) => sender.seal('g', value)))
    for (const index of [2, 0, 1])
      expect((await receiver.open(packets[index]!))?.payload).toBe(index)
    expect(await receiver.open(packets[0]!)).toBeUndefined()
    const restartedAdapter = await RoomCrypto.create(room, 'a', secret)
    const independent = await restartedAdapter.seal('another-generation', 'independent')
    expect((await receiver.open(independent))?.payload).toBe('independent')
  })

  test('keeps accepting fresh packets after a busy room fills its replay window', async () => {
    const { room, secret } = createRoomInvitation()
    const sender = await RoomCrypto.create(room, 'a', secret)
    const receiver = await RoomCrypto.create(room, 'b', secret)
    const first = await sender.seal('generation', 'first')
    expect(await receiver.open(first)).toBeDefined()
    const packets = process.env.COLLABORATION_LONG_RUN === '1' ? 16_400 : 4097
    for (let index = 0; index < packets; index++) {
      const packet = await sender.seal('generation', index)
      expect((await receiver.open(packet))?.payload).toBe(index)
    }
    expect(await receiver.open(first)).toBeUndefined()
    for (let index = 0; index < 4096; index++) await sender.seal('generation', index)
    const afterGap = await sender.seal('generation', 'after-gap')
    expect((await receiver.open(afterGap))?.payload).toBe('after-gap')
    expect(await receiver.open(first)).toBeUndefined()
  }, 30_000)

  test('rejects wrong secrets, corrupt ciphertext and malformed inputs', async () => {
    const { room, secret } = createRoomInvitation()
    const sender = await RoomCrypto.create(room, 'a', secret)
    const wrong = await RoomCrypto.create(room, 'b', createRoomInvitation().secret)
    const packet = await sender.seal('g', 'test')
    expect(await wrong.open(packet)).toBeUndefined()
    const receiver = await RoomCrypto.create(room, 'b', secret)
    expect(await receiver.open({ ...packet, ciphertext: '!invalid!' })).toBeUndefined()
    for (const malformed of [null, {}, { ...packet, sequence: -1 }, { ...packet, iv: 'x' }])
      expect(await receiver.open(malformed)).toBeUndefined()
  })
})
