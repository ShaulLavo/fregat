import { describe, expect, test } from 'vitest'
import { frameMessage, FrameReceiver, MESSAGE_LIMIT, sendFrames } from '../src/framing'
import { createRoomInvitation, RoomCrypto } from '../src/room-crypto'

const encoder = new TextEncoder()

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
  })
})

describe('authenticated room packets', () => {
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
