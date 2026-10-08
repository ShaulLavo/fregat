import '@singapore-editor/core/style.css'
import '@singapore-editor/collaboration/style.css'
import './collaboration.css'
import { Editor } from '@singapore-editor/core/editor'
import {
  createCollaborationPlugin,
  type CollaborationConnection,
} from '@singapore-editor/collaboration'
import {
  BroadcastTransport,
  RoomCrypto,
  TransportRouter,
  WebRTCTransport,
  WebSocketSignaling,
  createRoomInvitation,
} from '@singapore-editor/collaboration/transports'
import type { Envelope } from '@singapore-editor/collab'

const form = document.querySelector<HTMLFormElement>('#configuration')!
const signaling = document.querySelector<HTMLInputElement>('#signaling')!
const admission = document.querySelector<HTMLInputElement>('#admission')!
const ice = document.querySelector<HTMLTextAreaElement>('#ice')!
const policy = document.querySelector<HTMLSelectElement>('#policy')!
const invitation = document.querySelector<HTMLInputElement>('#invitation')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const peers = document.querySelector<HTMLElement>('#peers')!
const start = document.querySelector<HTMLButtonElement>('#start')!
const initialText =
  '// Type together. Undo changes only your own edits.\nconst message = "Hello, peers";\n'
const fragment = new URLSearchParams(location.hash.slice(1))
const linked = fragment.has('room') && fragment.has('secret')
if (linked) start.textContent = 'Join session'

const mounted: (() => Promise<void>)[] = []

function report(error: unknown): void {
  status.textContent = error instanceof Error ? error.message : 'The connection failed.'
}

async function mountPeer(
  name: string,
  room: string,
  secret: string,
  urls: readonly string[],
  signalingProtocols: readonly string[],
  iceServers: readonly RTCIceServer[],
  transportPolicy: RTCIceTransportPolicy,
): Promise<void> {
  const peer = crypto.randomUUID()
  const displayName = `${name} · ${peer.slice(0, 8)}`
  const signalingClient = urls.length
    ? new WebSocketSignaling({
        urls,
        room,
        credentials: { protocols: () => signalingProtocols },
        reconnectInterval: 1000,
        onError: report,
      })
    : undefined
  const cleanups: (() => void | Promise<void>)[] = []
  const dispose = async () => {
    await Promise.allSettled(
      cleanups
        .splice(0)
        .reverse()
        .map((cleanup) => Promise.resolve().then(cleanup)),
    )
  }
  mounted.push(dispose)
  if (signalingClient) cleanups.push(() => signalingClient.close())
  try {
    const roomCrypto = await RoomCrypto.create(room, peer, secret)
    const panel = document.createElement('article')
    panel.className = 'peer'
    const header = document.createElement('div')
    header.className = 'peer-header'
    const label = document.createElement('strong')
    label.textContent = displayName
    const state = document.createElement('span')
    const leave = document.createElement('button')
    leave.textContent = 'Leave session'
    const element = document.createElement('div')
    element.className = 'peer-editor'
    element.setAttribute('aria-label', `${name} editor`)
    header.append(label, state, leave)
    panel.append(header, element)
    peers.append(panel)
    cleanups.push(() => panel.remove())
    let connection!: CollaborationConnection
    let router: TransportRouter<Envelope> | undefined
    const editor = new Editor(element, {
      defaultText: initialText,
      wordWrap: true,
      plugins: [
        createCollaborationPlugin({
          session: { peer, room, document: 'example-document', epoch: room, text: initialText },
          presence: { displayName, colour: name === 'Peer one' ? '#a8ddc4' : '#e8be82' },
          transport: { send: (target, message) => router?.send(target, message) },
          onReady: (ready) => {
            connection = ready
          },
        }),
      ],
    })
    cleanups.push(() => editor.dispose())
    router = new TransportRouter({ room, document: 'example-document', peer }, connection.session)
    const broadcast = new BroadcastTransport({
      router,
      crypto: roomCrypto,
      heartbeatInterval: 500,
      peerTimeout: 2000,
      onError: report,
    })
    cleanups.push(() => broadcast.close())
    const rtc = signalingClient
      ? new WebRTCTransport({
          router,
          crypto: roomCrypto,
          signaling: signalingClient,
          iceServers,
          transportPolicy,
          credentials: {},
          announceInterval: 1000,
          connectionTimeout: 10_000,
          onError: report,
        })
      : undefined
    if (rtc) cleanups.push(() => rtc.close())
    // @justification Session roles change outside editor events; this small status clock
    // is cleared on departure and page teardown.
    const timer = setInterval(() => {
      const session = connection.session
      const role = session.isHost ? 'Ordering host' : 'Participant'
      state.textContent =
        session.status === 'stable' ? `${role} · ${session.members.size} peers` : session.status
      if (session.status !== 'left') return
      clearInterval(timer)
      editor.setPlugins([])
      leave.disabled = true
      void broadcast.close().catch(report)
      void rtc?.close().catch(report)
    }, 100)
    leave.addEventListener('click', () => {
      const successor = [...connection.session.members].filter((id) => id !== peer).sort()[0]
      connection.session.leave(connection.session.isHost ? successor : undefined)
      leave.disabled = true
    })
    cleanups.push(() => clearInterval(timer))
  } catch (error) {
    await dispose()
    const index = mounted.indexOf(dispose)
    if (index >= 0) mounted.splice(index, 1)
    throw error
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  void begin().catch((error) => {
    start.disabled = false
    report(error)
  })
})

async function begin(): Promise<void> {
  start.disabled = true
  const servers: unknown = JSON.parse(ice.value)
  if (
    !Array.isArray(servers) ||
    servers.some((server) => !server || typeof server !== 'object' || !('urls' in server))
  )
    throw new TypeError('ICE servers must be an array of objects with urls')
  const urls = signaling.value.split(/\s+/).filter(Boolean)
  if (urls.length && !admission.value.trim())
    throw new TypeError('Enter your member’s broker token to use WebRTC')
  const signalingProtocols = admission.value.trim() ? [admission.value.trim()] : []
  const identity = linked
    ? { room: fragment.get('room')!, secret: fragment.get('secret')! }
    : createRoomInvitation()
  const hash = new URLSearchParams(identity).toString()
  history.replaceState(null, '', `#${hash}`)
  invitation.value = location.href
  status.textContent = 'Connecting peers…'
  try {
    await mountPeer(
      'Peer one',
      identity.room,
      identity.secret,
      urls,
      signalingProtocols,
      servers,
      policy.value as RTCIceTransportPolicy,
    )
    await mountPeer(
      'Peer two',
      identity.room,
      identity.secret,
      urls,
      signalingProtocols,
      servers,
      policy.value as RTCIceTransportPolicy,
    )
    status.textContent = 'Session ready. Share the invitation link to add peers.'
  } catch (error) {
    await close()
    peers.replaceChildren()
    throw error
  }
}

async function close(): Promise<void> {
  await Promise.allSettled(mounted.splice(0).map((dispose) => dispose()))
}
window.addEventListener('pagehide', () => {
  void close()
})
