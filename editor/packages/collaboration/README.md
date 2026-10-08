# Collaboration session

A transport-neutral session for small, trusted full-mesh rooms of up to eight peers.
It chooses an ordering host, recovers after host failure, and preserves both branches'
edits when network partitions rejoin. A confirmation means acceptance on the current
branch. Reconciliation can return a branch-confirmed edit to pending.

The default entry contains the runtime-neutral session protocol. The `/transports`
entry adds native WebRTC, encrypted WebSocket signaling and same-origin
BroadcastChannel links. Presence rendering and editor attachment follow separately.

## Integration boundary

Construct `Session` with a peer-session ID, room and document IDs, a genesis
checkpoint, a `DocumentEngine`, a send callback and explicit timing/chunk options.
Call `connect` and `disconnect` for direct authenticated links. Call `receive` for
decoded messages and `tick` with a monotonic clock. Submit original edit envelopes
with their original IDs and dependencies. The session interprets identities and
dependencies, while the engine owns the opaque change, its canonical outcome and
history hash.

`DocumentEngine` owns sequencing and applying ordered outcomes, checkpoint/history
export, complete chain verification, atomic base installation, unique-edit recovery,
and EditId deduplication. Rejected outcomes remain in that history. The engine's `sequence` method accepts an
optional session rejection and must record it without applying the change. Missing
dependencies wait for the explicit `dependencyTimeout`; after that bound, their
original edits become rejected conflicts. A later-arriving dependency leaves that
recorded outcome unchanged. The toy engine in
`test/engine.ts` is deliberately an ordered ID/text list, independent of a text CRDT.
The adapter for `@singapore-editor/collab`'s Host and Participant is follow-up work.

After `status` becomes `left`, the caller closes the session's links and reports those
closures to the surviving peers. Departure keeps its final document readable while
later confirmations continue on the survivors.

The caller supplies a fresh peer ID after a process restart, retains authored intents
and pending work durably if crashes must preserve unsent work, and reconnects using
that new identity. A surviving peer's branch retains edits authored by departed peers.
The session has no timer, editor hook or browser dependency of its own.

## State and convergence

Membership is the current set of direct authenticated links. `HELLO` and `HOST_PULSE`
carry each peer's sorted roster and its installed handoff announcement. Receivers
verify and install that announcement before interpreting the advertised authority;
reordered discovery traffic therefore preserves a completed handoff. Sequencing and
host activation require matching
rosters from every member. A partial or asymmetric rejoin therefore freezes incumbent
hosts until the connected component becomes a full mesh. Membership changes and host
suspicion start roster-bound rounds coordinated by the lowest peer ID. Every
participant supplies its frozen branch. The coordinator fetches and verifies complete
histories before selecting a base. On one lineage, the freshest holder wins and peer
ID breaks ties. Divergent histories compare depth, branch-host ID, then tip hash.
Terms fence authority traffic and never rank history.

The coordinator distributes a base and the union of losing branches' unique original
intents. Peers archive their replaced branch and install the base. The chosen host
waits for every round member's `HAVE` before claiming authority and sequencing pending
work. Replay follows dependencies and preserves IDs. A membership change invalidates
the round. A third partition therefore starts another frozen round rather than
accepting a partially discovered pairwise result as globally final.

Clean handoff freezes the outgoing host, transfers its confirmed tip and pending
intents, and waits for the successor's verified `HAVE`. Both preparation and committed
announcements carry pending edits authored throughout the transfer. `HAVE` identifies
the handoff stage and the retained EditIds. Departure waits for the successor to retain
every pending edit and for every member to install the successor announcement.
Installing a handoff base settles pending IDs already present in its confirmed history.
The outgoing host continues pulses and retransmits its preceding authority announcement
throughout preparation. Members relay preparation and
commit announcements to the successor across delayed direct links. The successor
retains the union of transferred edits and relays the committed announcement.

The requested departure survives an intervening election. A re-elected outgoing host
retries its handoff, choosing a connected successor if the requested one disconnected.
A host with no connected successor retains its document until a peer connects.
An outgoing host that becomes a follower leaves after its pending
work receives confirmed outcomes from the elected host. The election chooses authority
using the same history rules. Calling `submit` after the session has left throws a
`TypeError`. Removing a follower keeps the current host; removing the host starts election.

Liveness requires eventual delivery, a stable full-mesh component and a ticking clock.
The transport reports closed or failed links through `disconnect`. Pulse suspicion
freezes confirmation and starts a round; a still-listed silent member stalls that
round until delivery resumes or the transport removes its failed link.
This is eventual convergence, with an active host in every stabilized partition.
It provides no quorum-based or Byzantine consensus guarantee. Byte framing,
authentication, message-size bounds, backpressure and retention limits belong to the
transport/production integration. History chunks here are bounded by record count;
the later transport must also enforce its byte limit.

## Checks

From the repository root:

```sh
bun run --cwd editor/packages/collaboration typecheck
bun run --cwd editor/packages/collaboration build
bun run --cwd editor/packages/collaboration test
COLLABORATION_LONG_RUN=1 bun run --cwd editor/packages/collaboration test
```

The default run has 100 deterministic seeds. The long run has 10,000. Each seed
checks components computed from the actual directed-link graph after host crash and
restart, two-pair splits, or three-way splits with staggered healing. Partial-heal
checks include a one-way bridge followed by a bidirectional bridge before full-mesh
recovery. Those bridges check that at most one host can sequence in their connected
component. A focused four-peer path also proves that both incumbents stop advancing.

Links have independent delay, loss and duplicate delivery. Every seed performs a
short disconnect and reconnect with packets still queued. Packets carry the link
generation at send time. Counters require both delivery from an older generation and
its arrival after traffic from the new generation. The suite prints and asserts
positive counts for every required scenario.

Full-mesh quiescence checks require identical confirmed history and text, EditId
uniqueness, one host per component, and settlement of every authored edit as accepted
or rejected after all peers rejoin. Rejected outcomes represent surfaced conflicts in
this simulation. Focused handoff tests cover typing in both transfer stages, delayed
base confirmations, non-coordinator hosts, election-interrupted departure, and a
requested successor disconnecting. The simulator closes completed departures' links
and checks authored outcomes against the surviving component's history.
CI runs the default checks and offers the long run through workflow dispatch.

## Browser transports

Create a fresh random peer-session ID for each tab or process. Share one `RoomCrypto`
instance between that tab's adapters. An authenticated packet from another tab using
its own peer ID raises `DuplicatePeerSessionError` through `onError` and closes the
affected adapter. Reconstruct the tab's session, router and adapters with a fresh
random peer-session ID before retrying. Reflected local packets and unauthenticated
forgeries are ignored. `createRoomInvitation()` returns an opaque room UUID and a 256-bit invitation secret. Share the invitation
outside the broker. Every peer must use the same room, secret and document ID.

The caller supplies all signaling URLs, ICE servers, transport policy and credentials.
An empty ICE list is an explicit local-network choice. Remote deployments need their
own TURN relay. The library has no public service defaults.

```ts
import { Session, type EditEnvelope } from '@singapore-editor/collaboration'
import {
  RoomCrypto,
  TransportRouter,
  WebRTCTransport,
  WebSocketSignaling,
  BroadcastTransport,
} from '@singapore-editor/collaboration/transports'

// sessionOptions includes the engine, identity and explicit session timing limits.
let router: TransportRouter<EditEnvelope>
const session = new Session({
  ...sessionOptions,
  send: (peer, message) => router.send(peer, message),
})
router = new TransportRouter({ room, document, peer: session.peer }, session)
const roomCrypto = await RoomCrypto.create(room, session.peer, invitationSecret)
const signaling = new WebSocketSignaling({
  urls: config.signalingUrls,
  room,
  credentials: { protocols: config.webSocketProtocols },
  reconnectInterval: config.signalingReconnectInterval,
  onError,
})
const rtc = new WebRTCTransport({
  router,
  crypto: roomCrypto,
  signaling,
  iceServers: config.iceServers,
  transportPolicy: config.transportPolicy,
  credentials: { turn: config.supplyTurnCredentials },
  announceInterval: config.announceInterval,
  connectionTimeout: config.connectionTimeout,
  onError,
})
const tabs = new BroadcastTransport({
  router,
  crypto: roomCrypto,
  heartbeatInterval: config.tabHeartbeatInterval,
  peerTimeout: config.tabPeerTimeout,
  onError,
})
```

Keep calling `session.tick(performance.now())` on the application's clock. Close
both adapters with `await tabs.close()` and `await rtc.close()` when detaching.
The TURN supplier receives `(peer, abortSignal)` and returns ICE server entries
with current username/credential values. It runs for every new connection,
including reconnects. Static credentials can be included in `iceServers` and the
required `credentials` object can be `{}`. The browser supports WebSocket
subprotocols for admission credentials. The broker requires an explicit
`authorize(request)` policy. The example uses a separate deployment admission token;
include that token in `config.webSocketProtocols` and share it privately with members.
The room invitation secret stays outside the broker.

### Link and wire design

`TransportRouter` owns the session boundary. It calls `connect` for the first
reachable path, `disconnect` when the last path closes, and `receive` once per
sender/message ID. It prefers BroadcastChannel when both paths exist. The WebRTC
adapter closes an existing link when the same peer appears on BroadcastChannel,
then reconnects if the tab heartbeat expires. A 4,096-message receive window
rejects duplicates and older messages, including packets from a retired path.
The router retains at most 64 peer-session histories, preserving active peers and
replacing the oldest inactive history as new members arrive. WebRTC's offer
sequence histories use the same bound and preserve discovered peers.
Session pulses and retained pending edits recover messages outside that window.
There are no changes to the session protocol.

WebRTC uses a full mesh of at most eight peer sessions. The lower peer ID initiates
each pair. Each connection uses one reliable ordered channel, with no partial
reliability options. Offers and answers include fully gathered ICE candidates.
This non-trickle exchange keeps signaling small and avoids candidate-order races.
Decryption and discovery use a shared serialized queue. SDP, renewable TURN credentials
and ICE gathering run in separate per-peer queues: a stalled peer leaves other links
free to proceed. Each peer retains at most eight handshake operations, with a shared
4 MiB retained-SDP budget. New offers cancel superseded credential/ICE work; stale
completions cannot replace the newer generation. Each replacement connection has a fresh random generation. Failed, disconnected,
closed, timed-out or malformed links report `disconnect` to the session. A live
BroadcastChannel path keeps that peer connected while the WebRTC path retires.

Every data-channel frame is binary. Its 68-byte header contains a magic/version
word, a random 128-bit transfer ID, index, chunk count, total byte length, chunk
byte length and a SHA-256 digest of the complete UTF-8 JSON envelope. Frames are
at most 16 KiB including their header and also respect negotiated
`pc.sctp.maxMessageSize`; zero means SCTP places no size limit. Transfers are at
most 8 MiB and 65,536 chunks. One incomplete ordered transfer occupies at most
8 MiB. The send queue and queued received frames each have a 16 MiB limit per
link. Sends stop above 256 KiB of buffered channel data and resume on
`bufferedamountlow` at 128 KiB. Closing a link aborts a blocked send. Queue
saturation closes the link so session replay can resume on a fresh connection.

Signaling and BroadcastChannel use AES-256-GCM with fresh 96-bit random IVs.
PBKDF2/SHA-256 derives the room key with 100,000 iterations and the opaque room
ID as salt. Authenticated associated data binds version, room, peer-session ID,
connection generation, sequence and timestamp. Packets expire after 60 seconds;
peers need clocks within that allowance. Each peer/generation has a 4,096-sequence
sliding replay window. At most 1,024 recently active windows are retained, with
expired windows pruned. Fresh packets keep flowing as the window advances;
duplicates and older sequences are refused. Signaling brokers see room IDs,
traffic sizes and ciphertext. WebRTC document traffic uses endpoint-to-endpoint
DTLS. Room members sharing the secret are trusted and can impersonate each other.
This is not an account or Byzantine-consensus system.

### Self-hosted broker

The Bun-only `/server` entry is separate from the browser bundle. It forwards
opaque publish frames to subscribed sockets and stores no history. Each socket
subscribes to one room. Limits are eight subscribers per room, 1,024 active rooms
and 1 MiB per WebSocket frame or buffered socket output. Connections must present
an origin from the explicit allowlist and pass the required admission callback.
The explicit `limits` option requires positive integer `connections`,
`connectionsPerIP`, `subscribeTimeout` and `idleTimeout` values (timeouts in milliseconds),
plus `framesPerSecond` and `bytesPerSecond` budgets per connection. Both pending
asynchronous admissions and upgraded sockets count toward connection quotas;
admission work has the subscribe deadline. IP accounting uses the direct socket
address. Configure trusted proxy enforcement separately when deploying behind a proxy.
Subscribe and application-idle deadlines terminate sockets and release room and IP
capacity. Incoming pings, pongs and repeated subscriptions leave those deadlines
unchanged. Publish traffic consumes the frame/byte budget and refreshes the idle deadline.

The example reads a separate random deployment admission token from a file and
requires it as a WebSocket subprotocol. It permits 256 connections, 16 per IP, a
5-second subscribe/admission deadline, a 120-second application-idle deadline and
64 frames / 2 MiB per second per connection. Keep the client's announce interval below
the broker idle deadline. Unauthorized clients are refused before receiving room
capacity. Authorized clients still share finite capacity: admission is a trust boundary,
and deployments need TLS and upstream HTTP/connection rate limits for network floods.
Use a synchronous token check or authenticate before reaching an asynchronous policy
so strangers cannot occupy its pending-admission quota. The room's shared encryption
secret alone provides no broker admission or service-availability guarantee.

Generate a random token in a private file, then run with your bind address, port,
file path and allowed origins. The token itself stays out of command arguments and logs:

```sh
umask 077
bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"))' > admission-token
bun editor/packages/collaboration/examples/signaling-server.ts \
  127.0.0.1 8789 ./admission-token http://localhost:5173
```

Wire messages are `{ type: 'subscribe', topic }`, the acknowledgement
`{ type: 'subscribed', topic }`, and `{ type: 'publish', topic, payload }` in both
directions. `payload` is a sealed room packet. Publishing requires a subscription.
WebSocket reconnects re-subscribe and announce; they do not carry document edits.

### Verification and TURN qualification

```sh
bun run --cwd editor/packages/collaboration test
bun run --cwd editor/packages/collaboration test:server
bun run --cwd editor/packages/collaboration test:browser
```

Chromium tests start a local Bun broker and use separate real pages. Three WebRTC
peers exchange session submissions and confirmations, including an 80 KiB Unicode
edit, lose the host, elect a replacement and rejoin with fresh connection
generations and renewed credentials. Two same-origin pages exchange edits through
BroadcastChannel. The combined test proves those pages use zero WebRTC links.
Two-tab collision cases cover both adapters with a shared peer ID and require an
explicit diagnostic in each tab. Native-connection fakes prove another peer answers
while credentials or ICE gathering stall, and a new generation cancels stalled work.
Broker tests cover admission refusal, global/IP quotas, subscribe and idle eviction,
frame/byte budgets and bounded asynchronous authorization.

The TURN-only case skips with a stated reason unless a relay is explicitly supplied.
CI has no relay or TURN credentials. To run it against a local coturn instance,
configure a UDP listener and a static test user, disable TLS/DTLS only for that
local fixture, and allow loopback peers. Supply the resulting ICE entry:

```sh
COLLABORATION_TEST_TURN='[{"urls":"turn:127.0.0.1:3478?transport=udp","username":"test","credential":"test-secret"}]' \
  bun run --cwd editor/packages/collaboration test:browser
```

That case uses `iceTransportPolicy: 'relay'`, so a passing connection requires TURN.
Repeat with TCP/TLS TURN URLs for restrictive networks. Final remote qualification
requires two machines joining the same private invitation through the self-hosted
broker with relay-only policy and exchanging an edit in each direction. Local
Chromium coverage does not establish cross-machine or Safari/Firefox support.
Manual invitation-blob pairing is optional and is not included in this adapter.
