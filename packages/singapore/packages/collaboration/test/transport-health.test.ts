import { expect, test, vi } from 'vitest'
import { BroadcastTransport } from '../src/broadcast-transport'
import { createRoomInvitation, RoomCrypto } from '../src/room-crypto'
import { WebSocketSignaling } from '../src/signaling'
import { TransportRouter } from '../src/transport-router'
import { WebRTCTransport } from '../src/webrtc-transport'

test('broadcast recovery identifies successful sends and authenticated receives', async () => {
  const { room, secret } = createRoomInvitation()
  let failure = false
  const channels: Channel[] = []
  class Channel {
    onmessage: ((event: { data: unknown }) => void) | null = null
    constructor() {
      channels.push(this)
    }
    postMessage() {
      if (failure) throw new TypeError('Broadcast send failed')
    }
    close() {}
  }
  vi.stubGlobal('BroadcastChannel', Channel)
  const onError = vi.fn()
  const onRecovery = vi.fn()
  const transport = new BroadcastTransport({
    router: new TransportRouter(
      { room, peer: 'a', document: 'document' },
      { connect() {}, disconnect() {}, receive() {} },
    ),
    crypto: await RoomCrypto.create(room, 'a', secret),
    heartbeatInterval: 50,
    peerTimeout: 200,
    onError,
    onRecovery,
  })
  try {
    await expect.poll(() => onRecovery.mock.calls.length).toBeGreaterThan(0)
    expect(onRecovery).toHaveBeenCalledWith('send')
    onRecovery.mockClear()
    failure = true
    await expect.poll(() => onError.mock.calls.length).toBeGreaterThan(0)
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), 'send')
    expect(onRecovery).not.toHaveBeenCalled()
    const remote = await RoomCrypto.create(room, 'b', secret)
    channels[0]!.onmessage?.({
      data: await remote.seal('generation', { document: 'document', type: 'announce' }),
    })
    await expect
      .poll(() => onRecovery.mock.calls.some(([direction]) => direction === 'receive'))
      .toBe(true)
    expect(onRecovery.mock.calls.some(([direction]) => direction === 'send')).toBe(false)
    failure = false
    await expect
      .poll(() => onRecovery.mock.calls.some(([direction]) => direction === 'send'))
      .toBe(true)
  } finally {
    failure = false
    await transport.close()
    vi.unstubAllGlobals()
  }
})

test('signaling failures and recovery identify the affected broker URL', async () => {
  const room = crypto.randomUUID()
  const sockets: Socket[] = []
  class Socket {
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    constructor(readonly url: string) {
      sockets.push(this)
    }
    send() {}
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket)
  const onError = vi.fn()
  const onRecovery = vi.fn()
  const receive = vi.fn()
  const signaling = new WebSocketSignaling({
    urls: ['ws://localhost:12345', 'ws://localhost:12346'],
    room,
    credentials: { protocols: () => [] },
    reconnectInterval: 1000,
    onError,
    onRecovery,
  })
  try {
    signaling.start(receive, vi.fn())
    await expect.poll(() => sockets.length).toBe(2)
    sockets[0]!.onerror?.()
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), sockets[0]!.url, 'send')
    const subscribed = { data: JSON.stringify({ type: 'subscribed', topic: room }) }
    sockets[1]!.onmessage?.(subscribed)
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith(sockets[1]!.url, 'receive')
    sockets[0]!.onmessage?.(subscribed)
    expect(onRecovery).toHaveBeenLastCalledWith(sockets[0]!.url, 'receive')
    sockets[0]!.onmessage?.({ data: '{' })
    expect(onError).toHaveBeenLastCalledWith(expect.any(SyntaxError), sockets[0]!.url, 'receive')
    sockets[0]!.onmessage?.({ data: JSON.stringify({ type: 'publish', topic: room, payload: {} }) })
    expect(onRecovery).toHaveBeenLastCalledWith(sockets[0]!.url, 'receive')
    expect(receive).toHaveBeenCalledExactlyOnceWith({})
  } finally {
    signaling.close()
    vi.unstubAllGlobals()
  }
})

test('WebRTC recovery and departure identify the failed link and fence its old channel', async () => {
  const { room, secret } = createRoomInvitation()
  const remote = await RoomCrypto.create(room, 'a', secret)
  const other = await RoomCrypto.create(room, 'b', secret)
  const connections: Connection[] = []
  class Channel {
    label = 'singapore-collaboration'
    ordered = true
    maxRetransmits = null
    maxPacketLifeTime = null
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    close() {}
  }
  class Connection extends EventTarget {
    iceGatheringState = 'complete'
    ondatachannel: ((event: { channel: Channel }) => void) | null = null
    localDescription: { toJSON(): RTCSessionDescriptionInit } | null = null
    constructor() {
      super()
      connections.push(this)
    }
    async setRemoteDescription() {}
    async createAnswer(): Promise<RTCSessionDescriptionInit> {
      return { type: 'answer', sdp: 'answer' }
    }
    async setLocalDescription(description: RTCSessionDescriptionInit) {
      this.localDescription = { toJSON: () => description }
    }
    close() {}
  }
  vi.stubGlobal('RTCPeerConnection', Connection)
  let deliver: (packet: unknown) => void = () => {}
  const onError = vi.fn()
  const onRecovery = vi.fn()
  const onPeerLeft = vi.fn()
  const interval = vi.spyOn(globalThis, 'setInterval')
  const transport = new WebRTCTransport({
    router: new TransportRouter(
      { room, peer: 'z', document: 'document' },
      { connect() {}, disconnect() {}, receive() {} },
    ),
    crypto: await RoomCrypto.create(room, 'z', secret),
    signaling: {
      start(receive) {
        deliver = receive
      },
      publish() {},
      close() {},
    },
    iceServers: [],
    transportPolicy: 'all',
    credentials: {},
    announceInterval: 100_000,
    connectionTimeout: 200_000,
    onError,
    onRecovery(peer) {
      if (peer !== undefined) onRecovery(peer)
    },
    onPeerLeft,
  })
  const discoveryClock = interval.mock.calls.at(-1)![0] as () => void
  interval.mockRestore()
  const offer = (sender: RoomCrypto, generation: string) =>
    sender.seal(generation, {
      type: 'offer',
      document: 'document',
      to: 'z',
      description: { type: 'offer', sdp: 'offer' },
    })
  try {
    deliver(await offer(remote, 'first'))
    deliver(await offer(other, 'other'))
    await expect.poll(() => connections.length).toBe(2)
    const failed = new Channel()
    connections[0]!.ondatachannel?.({ channel: failed })
    failed.onopen?.()
    expect(onRecovery).toHaveBeenCalledWith('a')
    failed.onerror?.()
    expect(onError).toHaveBeenLastCalledWith(expect.any(TypeError), 'a')
    onRecovery.mockClear()
    const healthy = new Channel()
    connections[1]!.ondatachannel?.({ channel: healthy })
    healthy.onopen?.()
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith('b')
    failed.onopen?.()
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith('b')
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200_001)
    try {
      discoveryClock()
    } finally {
      now.mockRestore()
    }
    expect(onPeerLeft).not.toHaveBeenCalled()
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith('b')
    deliver(await offer(remote, 'replacement'))
    await expect.poll(() => connections.length).toBe(3)
    const replacement = new Channel()
    connections[2]!.ondatachannel?.({ channel: replacement })
    replacement.onopen?.()
    expect(onRecovery).toHaveBeenLastCalledWith('a')
    deliver(await remote.seal('advertisement', { type: 'announce', document: 'document' }))
    deliver(await remote.seal('advertisement', { type: 'leave', document: 'document' }))
    await expect.poll(() => onPeerLeft.mock.calls.length).toBe(1)
    expect(onPeerLeft).toHaveBeenCalledWith('a')
  } finally {
    await transport.close()
    vi.unstubAllGlobals()
  }
})
