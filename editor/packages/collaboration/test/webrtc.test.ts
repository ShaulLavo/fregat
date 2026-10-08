import { expect, test, vi } from 'vitest'
import { createRoomInvitation, RoomCrypto, type SealedPacket } from '../src/room-crypto'
import { TransportRouter } from '../src/transport-router'
import { WebRTCTransport } from '../src/webrtc-transport'

for (const delay of ['credentials', 'ice'] as const) {
  test(`another peer can answer while ${delay} are stalled`, async () => {
    const { room, secret } = createRoomInvitation()
    const local = await RoomCrypto.create(room, 'z', secret)
    const slow = await RoomCrypto.create(room, 'a', secret)
    const fast = await RoomCrypto.create(room, 'b', secret)
    const publications: SealedPacket[] = []
    let deliver: (packet: unknown) => void = () => {}
    let release: (servers: readonly RTCIceServer[]) => void = () => {}
    const credentials = new Promise<readonly RTCIceServer[]>((resolve) => {
      release = resolve
    })
    const created: Connection[] = []
    class Connection extends EventTarget {
      iceGatheringState: RTCIceGatheringState = 'complete'
      signalingState: RTCSignalingState = 'stable'
      ondatachannel = null
      onconnectionstatechange = null
      peer = ''
      localDescription: { toJSON: () => RTCSessionDescriptionInit } | null = null
      constructor() {
        super()
        created.push(this)
      }
      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        expect(Object.keys(description)).toEqual(['type', 'sdp'])
        this.peer = description.sdp!
        if (delay === 'ice' && this.peer === 'a') this.iceGatheringState = 'gathering'
      }
      async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'answer', sdp: this.peer }
      }
      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = { toJSON: () => description }
      }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', Connection)
    let slowCredentialCalls = 0
    const onError = vi.fn()
    const transport = new WebRTCTransport({
      router: new TransportRouter(
        { room, peer: 'z', document: 'document' },
        { connect() {}, disconnect() {}, receive() {} },
      ),
      crypto: local,
      signaling: {
        start(receive) {
          deliver = receive
        },
        publish(packet) {
          publications.push(packet)
        },
        close() {},
      },
      iceServers: [],
      transportPolicy: 'all',
      credentials: {
        turn: (peer) => {
          if (peer === 'a') slowCredentialCalls++
          return delay === 'credentials' && peer === 'a' && slowCredentialCalls === 1
            ? credentials
            : Promise.resolve([])
        },
      },
      announceInterval: 1000,
      connectionTimeout: 5000,
      onError,
    })
    try {
      deliver(
        await slow.seal('slow-generation', {
          type: 'offer',
          document: 'document',
          to: 'z',
          description: { type: 'offer', sdp: 'a', padding: 'ignored'.repeat(1024) },
        }),
      )
      deliver(
        await fast.seal('fast-generation', {
          type: 'offer',
          document: 'document',
          to: 'z',
          description: { type: 'offer', sdp: 'b' },
        }),
      )
      await expect
        .poll(() => publications.some((packet) => packet.generation === 'fast-generation'), {
          timeout: 500,
        })
        .toBe(true)
      const reply = publications.find((packet) => packet.generation === 'fast-generation')!
      expect((await fast.open(reply))?.payload).toMatchObject({ type: 'answer', to: 'b' })
      expect(publications.some((packet) => packet.generation === 'slow-generation')).toBe(false)
      deliver(
        await slow.seal('replacement-generation', {
          type: 'offer',
          document: 'document',
          to: 'z',
          description: { type: 'offer', sdp: 'a2' },
        }),
      )
      await expect
        .poll(() => publications.some((packet) => packet.generation === 'replacement-generation'), {
          timeout: 500,
        })
        .toBe(true)
      release([])
      expect(publications.some((packet) => packet.generation === 'slow-generation')).toBe(false)
      expect(onError).not.toHaveBeenCalled()
    } finally {
      release([])
      for (const connection of created) {
        connection.iceGatheringState = 'complete'
        connection.dispatchEvent(new Event('icegatheringstatechange'))
      }
      await transport.close()
      vi.unstubAllGlobals()
    }
  })
}
