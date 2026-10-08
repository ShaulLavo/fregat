# Collaboration session

A transport-neutral session for small, trusted full-mesh rooms of up to eight peers.
It chooses an ordering host, recovers after host failure, and preserves both branches'
edits when network partitions rejoin. A confirmation means acceptance on the current
branch. Reconciliation can return a branch-confirmed edit to pending.

The package includes the session protocol and character-based presence. The optional
`presence-plugin` entry point paints remote carets and selections in an editor view.

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

## Presence

`new Presence(peerSessionId, documentId, session)` keeps per-peer clocks and bounded
remote state. The session supplies authenticated senders and its caller-driven clock.
Presence uses `PRESENCE` messages and leaves document history unchanged. Each active
editor attachment receives packets and departure events. Clock participation starts
only while local renewal, a queued update or remote expiry needs work. An empty attached
consumer receives no clock callbacks. The final attachment sends null for advertised
local state, cancels queued work, unsubscribes and hides remote state. `dispose()` releases
all state when the room closes. Runtime-neutral presence creates no timers.

`setLocalState` accepts an epoch, a confirmed tip, a display name, a six-digit hex
colour, a focused view ID or `null`, and selections. Each selection has an `anchor`
and a `head` gap. A gap contains `left: CharId | 'start'`, `right: CharId | 'end'`, and
`bias: 'left' | 'right'`. Both characters must be known before resolving the gap.
Deleted characters keep their retained position. A left-biased gap stays after its
left character; a right-biased gap stays before its right character.

Local state renews every 15 seconds. Remote state expires after 30 seconds of silence.
Outgoing updates and each peer's incoming visible updates have a 50 ms cadence. A burst
keeps one latest validated state per peer and flushes its final selection on the next
eligible clock tick. Incoming fields are validated and copied for every decoded packet;
transport byte limits and ingress backpressure still belong to the integration. Null
state and authenticated leave remove visible state promptly and cancel queued state.
Repeated leave/reappearance cannot bypass the positive-state cadence. View notifications
coalesce to one repaint request per animation frame.

Every message, including null state, needs a clock greater than the peer session's last
accepted clock. One clock floor per peer session survives expiry, detach and reattachment
until `dispose()` closes the room. A room admits up to 256 peer session IDs across its
lifetime. Removed state entries are pruned after 60 seconds on packet receipt or attachment;
clock floors remain without clock callbacks or expiry scans. A restarted peer uses a
fresh session ID. Completed local departure clears remote awareness from the readable
final document. Awareness clock dispatch is independent of the session's ordering-host
role. Each state has at most 32 selections,
128 display-name code units, and 256 code units per identifier. Names exclude control
and formatting characters. Parsing copies validated fields and discards extra fields.

The view plugin takes plain options and works with `new Editor(element)`:

```ts
import { Editor } from '@singapore-editor/core/editor'
import { Presence } from '@singapore-editor/collaboration'
import { createPresencePlugin } from '@singapore-editor/collaboration/presence-plugin'

const presence = new Presence(peerSessionId, documentId, session)
const editor = new Editor(element, {
  plugins: [createPresencePlugin({ presence, resolver })],
})
editor.setText(text)
```

`resolver` implements `resolveGap(gap): number | undefined`. The rendering contribution
retains unresolved selections and retries them on content or layout updates. The view
uses owner-scoped highlights and mounted range geometry, including wrapped rows and
horizontal scroll. Folded or unmounted carets stay hidden until their text becomes
visible. Names use text content and expose the full name through `title`. A caret or
selection change reveals the name for two seconds. The idle label fades using the host's
exit-motion tokens; reduced motion hides it immediately at the deadline. Hovering the
caret reveals the full label. Renewal-only packets keep idle labels hidden. Carets stay
visible throughout. One view deadline handles visible active labels, and disposal cancels
both that deadline and any pending animation frame. An editor with zero remote peers
creates no presence DOM, highlights or label deadline.

`Presence.attach()` also supports a headless consumer. Its returned function detaches
that consumer. A transport-neutral consumer can omit `session`, deliver packets with
`receive`, and advance a monotonic millisecond clock with `tick`.

## Checks

From the repository root:

```sh
bunx turbo run build --filter=@singapore-editor/collaboration...
bunx playwright install chromium
bun run --cwd editor/packages/collaboration typecheck
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
