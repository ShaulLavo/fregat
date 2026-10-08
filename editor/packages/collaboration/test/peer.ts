import { Session } from '../src/session'
import {
  BroadcastTransport,
  RoomCrypto,
  TransportRouter,
  WebRTCTransport,
  WebSocketSignaling,
} from '../src/transports'
import { BrowserEngine, browserGenesis, type BrowserEdit } from './browser-engine'

export interface PeerOptions {
  readonly peer: string
  readonly room: string
  readonly secret: string
  readonly url: string
  readonly broadcast: boolean
  readonly rtc: boolean
  readonly iceServers: readonly RTCIceServer[]
  readonly transportPolicy: RTCIceTransportPolicy
}

export interface PeerSnapshot {
  readonly peer: string
  readonly members: number
  readonly host: string | undefined
  readonly status: string
  readonly depth: number
  readonly text: string
  readonly rtcLinks: number
  readonly credentialCalls: number
  readonly offers: readonly string[]
  readonly errors: readonly string[]
}

export interface SelectedCandidatePair {
  readonly localType: string
  readonly remoteType: string
  readonly bytesSent: number
  readonly bytesReceived: number
}

interface PeerHarness {
  start(options: PeerOptions): Promise<void>
  snapshot(): PeerSnapshot
  selectedCandidatePairs(): Promise<readonly SelectedCandidatePair[]>
  submit(text: string): void
  stopRTC(): Promise<void>
  restartRTC(): void
  close(): Promise<void>
}

declare global {
  interface Window {
    collaborationPeer: PeerHarness
  }
}

let session: Session<BrowserEdit>
let engine: BrowserEngine
let router: TransportRouter<BrowserEdit>
let roomCrypto: RoomCrypto
let configuration: PeerOptions
let broadcast: BroadcastTransport<BrowserEdit> | undefined
let rtc: WebRTCTransport<BrowserEdit> | undefined
let ticker: ReturnType<typeof setInterval>
let seq = 0
let credentialCalls = 0
const offers = new Set<string>()
const errors: string[] = []
const peerConnections: RTCPeerConnection[] = []
const NativePeerConnection = window.RTCPeerConnection
window.RTCPeerConnection = class extends NativePeerConnection {
  constructor(configuration?: RTCConfiguration) {
    super(configuration)
    peerConnections.push(this)
  }
}
const onError = (error: unknown) => {
  errors.push(String(error))
}

function startRTC(): void {
  const signaling = new WebSocketSignaling({
    urls: [configuration.url],
    room: configuration.room,
    credentials: { protocols: ['fixture-admission'] },
    reconnectInterval: 100,
    onError,
  })
  const publish = signaling.publish.bind(signaling)
  let discoveryGeneration: string | undefined
  signaling.publish = (packet) => {
    discoveryGeneration ??= packet.generation
    if (packet.generation !== discoveryGeneration) offers.add(packet.generation)
    publish(packet)
  }
  rtc = new WebRTCTransport({
    router,
    crypto: roomCrypto,
    signaling,
    iceServers: configuration.iceServers,
    transportPolicy: configuration.transportPolicy,
    credentials: {
      turn: async () => {
        credentialCalls++
        return []
      },
    },
    announceInterval: 100,
    connectionTimeout: 15_000,
    onError,
  })
}

window.collaborationPeer = {
  async start(options) {
    configuration = options
    engine = new BrowserEngine()
    roomCrypto = await RoomCrypto.create(options.room, options.peer, options.secret)
    router = new TransportRouter(
      { room: options.room, document: 'transport-browser', peer: options.peer },
      {
        connect: (peer) => session.connect(peer),
        disconnect: (peer) => session.disconnect(peer),
        receive: (message) => session.receive(message),
      },
    )
    session = new Session({
      peer: options.peer,
      room: options.room,
      document: 'transport-browser',
      genesis: browserGenesis,
      engine,
      send: (peer, message) => router.send(peer, message),
      pulseInterval: 50,
      suspicionTimeout: 500,
      dependencyTimeout: 500,
      historyChunkRecords: 4,
    })
    if (options.broadcast)
      broadcast = new BroadcastTransport({
        router,
        crypto: roomCrypto,
        heartbeatInterval: 100,
        peerTimeout: 1000,
        onError,
      })
    if (options.rtc) startRTC()
    ticker = setInterval(() => session.tick(performance.now()), 20)
  },
  snapshot: () => ({
    peer: session.peer,
    members: session.members.size,
    host: session.host,
    status: session.status,
    depth: engine.checkpoint().depth,
    text: engine.text,
    rtcLinks: rtc?.connections ?? 0,
    credentialCalls,
    offers: [...offers],
    errors: [...errors],
  }),
  async selectedCandidatePairs() {
    const reports = await Promise.all(
      peerConnections
        .filter((connection) => connection.connectionState === 'connected')
        .map((connection) => connection.getStats()),
    )
    return reports.flatMap((report) => {
      const transports = Array.from(report.values()).filter((stat) => stat.type === 'transport')
      return transports.flatMap((transport) => {
        const pair = report.get(transport.selectedCandidatePairId)
        if (!pair) return []
        const local = report.get(pair.localCandidateId)
        const remote = report.get(pair.remoteCandidateId)
        return [
          {
            localType: local?.candidateType ?? 'unknown',
            remoteType: remote?.candidateType ?? 'unknown',
            bytesSent: pair.bytesSent ?? 0,
            bytesReceived: pair.bytesReceived ?? 0,
          },
        ]
      })
    })
  },
  submit(text) {
    session.submit({
      document: 'transport-browser',
      epoch: session.branch.authority.epoch,
      id: { actor: session.peer, seq: ++seq },
      lamport: seq,
      deps: [],
      change: { text },
    })
  },
  async stopRTC() {
    await rtc?.close()
    rtc = undefined
  },
  restartRTC: startRTC,
  async close() {
    clearInterval(ticker)
    await broadcast?.close()
    await rtc?.close()
  },
}
