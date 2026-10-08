import { expect, test, vi } from 'vitest'
import { createRoomInvitation, RoomCrypto } from '../src/room-crypto'
import { WebSocketSignaling } from '../src/signaling'
import { TransportRouter } from '../src/transport-router'
import { WebRTCTransport } from '../src/webrtc-transport'

test('an authenticated announcement preserves a failing signaling publication until a successful send', async () => {
  const { room, secret } = createRoomInvitation()
  const remote = await RoomCrypto.create(room, 'a', secret)
  let deliver: (packet: unknown) => void = () => {}
  let sendFails = true
  const failures = new Map<string, unknown>()
  const onRecovery = vi.fn((peer?: string, direction?: 'send' | 'receive') => {
    failures.delete(`${peer ?? ''}/${direction ?? ''}`)
  })
  const interval = vi.spyOn(globalThis, 'setInterval')
  const transport = new WebRTCTransport({
    router: new TransportRouter(
      { room, peer: 'z', document: 'document' },
      { connect() {}, disconnect() {}, receive() {} },
    ),
    crypto: await RoomCrypto.create(room, 'z', secret),
    signaling: {
      start(receive, ready) {
        deliver = receive
        ready()
      },
      publish() {
        if (sendFails) throw new TypeError('Signaling send still fails')
      },
      close() {},
    },
    iceServers: [],
    transportPolicy: 'all',
    credentials: {},
    announceInterval: 100_000,
    connectionTimeout: 200_000,
    onError(error: unknown, peer?: string, direction?: 'send' | 'receive') {
      failures.set(`${peer ?? ''}/${direction ?? ''}`, error)
    },
    onRecovery,
  })
  const announce = interval.mock.calls.at(-1)![0] as () => void
  interval.mockRestore()
  try {
    await expect.poll(() => failures.size).toBe(1)
    deliver(await remote.seal('advertisement', { type: 'announce', document: 'document' }))
    await expect.poll(() => onRecovery.mock.calls.length).toBe(1)
    expect(failures.size).toBe(1)
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith(undefined, 'receive')
    sendFails = false
    announce()
    await expect.poll(() => failures.size).toBe(0)
    expect(onRecovery).toHaveBeenLastCalledWith(undefined, 'send')
  } finally {
    sendFails = false
    await transport.close()
  }
})

test('broker recovery preserves failures in the other direction and at another URL', async () => {
  const { room, secret } = createRoomInvitation()
  const packet = await (
    await RoomCrypto.create(room, 'a', secret)
  ).seal('generation', {
    type: 'announce',
    document: 'document',
  })
  const sockets: Socket[] = []
  class Socket {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    fail = false
    onmessage: ((event: { data: string }) => void) | null = null
    constructor(readonly url: string) {
      sockets.push(this)
    }
    send() {
      if (this.fail) throw new TypeError('Broker publication still fails')
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket)
  const failures = new Map<string, unknown>()
  const onRecovery = vi.fn((url: string, direction?: 'send' | 'receive') => {
    failures.delete(`${url}/${direction ?? ''}`)
  })
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345', 'ws://localhost:12346'],
    room,
    credentials: { protocols: () => [] },
    reconnectInterval: 1000,
    onError(error: unknown, url: string, direction?: 'send' | 'receive') {
      failures.set(`${url}/${direction ?? ''}`, error)
    },
    onRecovery,
  })
  try {
    signaling.start(vi.fn(), vi.fn())
    await expect.poll(() => sockets.length).toBe(2)
    sockets[0]!.fail = true
    expect(() => signaling.publish(packet)).not.toThrow()
    expect(failures.size).toBe(1)
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith(sockets[1]!.url, 'send')
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'subscribed', topic: room }) })
    expect(failures.size).toBe(1)
    expect(onRecovery).toHaveBeenLastCalledWith(sockets[0]!.url, 'receive')
    sockets[0]!.fail = false
    signaling.publish(packet)
    expect(failures.size).toBe(0)
    sockets[0]!.onmessage?.({ data: '{' })
    expect(failures.size).toBe(1)
    signaling.publish(packet)
    expect(failures.size).toBe(1)
    sockets[0]!.onmessage?.({
      data: JSON.stringify({ type: 'publish', topic: room, payload: packet }),
    })
    expect(failures.size).toBe(0)
  } finally {
    signaling.close()
    vi.unstubAllGlobals()
  }
})
