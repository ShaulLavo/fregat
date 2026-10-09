# @singapore-editor/collaboration

Editor binding, session protocols, transports, and remote cursor presence for host-ordered collaboration.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/collaboration
```

## What you set up

The library uses no hosted services and has no public defaults. What you need depends on where
peers are:

- **Tabs in one browser:** nothing. They connect over an encrypted `BroadcastChannel`.
- **Browsers on different machines:** WebRTC, which needs three things you run or choose:
  - A **signaling broker** that introduces peers. It only relays encrypted packets and keeps no
    history. Run the included Bun broker from `@singapore-editor/collaboration/server`
    ([example](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/examples/signaling-server.ts)) or any service with the same protocol, behind TLS,
    with an origin allowlist and an admission token per member.
  - **STUN servers** so peers can find a direct route.
  - A **TURN relay** (for example coturn) for networks where a direct route fails, with
    credentials your app issues.
- **The invitation:** `createRoomInvitation()` makes a room ID and secret. Send them to the other
  people yourself, for example in the fragment of a link; they never go through the broker.

Pass the broker URLs, ICE servers and credentials to the transports when joining. The
[integration guide](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/docs/integration.md#browser-transports) covers each option.

## Usage

This example validates a presence message. A room needs a document engine, authenticated links, and a clock supplied by your app.

```ts
import { Presence, parsePresence } from '@singapore-editor/collaboration'

const presence = new Presence('peer-1', 'document-1')
const message = parsePresence({ clock: 1, state: null }, 'peer-2', 'document-1')
if (message) presence.receive('peer-2', message)
console.log(presence.states)
presence.dispose()
```

## API highlights

- `createCollaborationPlugin()` attaches shared editing and selective Undo to an editor view.
- `CollaborationDocument` bridges the collab engine to session history.
- `Session` runs the transport-neutral protocol with a host-supplied document engine.
- `Presence` tracks remote selections and cursors.
- `parsePresence()` validates received presence messages.

[Generated API reference](https://shaulavo.dev/singapore/docs/reference/api/collaboration/overview/)

[Integration guide](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/collaboration/docs/integration.md)

## Confirmed merge review

Import `MergeReviewDetector` from `@singapore-editor/collaboration/merge-review` and supply a
`MergeReviewSyntax` reader. `detect(window, confirmedSnapshot, batch?)` returns `overlap`,
`parse`, `signature` and `orphan` marks. Pass the snapshot produced by the accepted history;
local pending typing stays outside that input. Each mark contains a unit ID built from the
unit kind and its first character's identity, sorted authors/edit IDs, and exact concurrent
pairs. Concurrency edges remain distinct because concurrency is non-transitive.

The syntax reader returns a group of units per requested range, in request order, using
UTF-16 offsets into the supplied snapshot. The default `enclosing` selection returns one unit
in each group. `touching` selection returns the smallest units for every touched portion of an
interval, including ancestors whose headers are touched outside nested units. Large pastes
use identity-piece intervals and query syntax nodes, so their request count follows pieces
and units rather than character count. Units include language, original signature spelling,
error state, and parent range/commutativity. A `contentKey` request asks for syntax shape and
leaf spelling with inter-token whitespace excluded. Formatting classification compares
snapshots differing by one operation with all surrounding effects retained. Signature marks
require a duplicate introduced by the edits; formatting or content-only changes to existing
duplicates stay unmarked. Return `null` when a snapshot is unavailable or a request is
cancelled. The detector then returns `unavailable` with an empty mark set so a host can retry
the whole batch.

With `batch` supplied, results concern concurrent pairs involving those IDs. A host that needs
a replacement mark set after undo, eviction or dismissal should request the whole retained
window by omitting `batch`. Marks and their settlement are caller-owned.

The detector is demand-only: it adds no subscriptions, timers, typing hooks or default syntax
reader. A null session window or a window without cross-author pairs returns before syntax
work. The coordinator, identity mapping, signature/orphan checks and `projectEffects` run on
the invoking thread; the supplied reader determines where syntax queries and projected-snapshot
parsing run. Worker `mergeUnit` requests support `analysis: true`, optional `contentKey: true`,
and cancellation, including line-fallback languages. A production bridge that registers
confirmed/projected snapshots in that worker and schedules review after confirmed batches
remains to be wired. The Node correctness
and cost fixtures use real grammars and queries on the test thread.

Run `bun run bench:merge-review` from this package for the shared-machine cost experiment and
CPU profile. The current 8,192-record workload exceeds the plan's unchanged 2 ms budget;
`bench/detector-evidence.json` records gate measurements and `bench/detector-profile-evidence.json`
records separately instrumented attribution. `bench/detector-baseline-evidence.json` is the
intermediate cached-state baseline before token fingerprints became demand-only. The profile
uses independent units, so projected-snapshot rebuilding and parsing are zero inside its timed
region; their cost is still unbounded by that experiment. The revised 2/4/8-author medians at
8,192 records are 3.218/3.058/3.100 ms, with p95 5.478/4.823/5.060 ms.

`bench/paste-evidence.json` separately records the paste interval experiment against the reviewed
implementation: 16,001 syntax ranges become two for a 16,000-character insertion, with a trivial
reader. A real 100,000-character multi-unit paste uses two ranges and 20 query matches while
retaining both signature marks. These results measure paste range collection independently of
the unchanged ordinary batch gate.

## Transport status

Transport options accept an optional `onRecovery` callback. Match all scope arguments
with `onError` when tracking outstanding failures:

- `BroadcastTransport` reports `send` after a successful channel send and `receive` after
  accepting an authenticated packet for the document. Recovery in one direction clears
  failures in that direction.
- `WebSocketSignaling` reports `(url, direction)`. A successful publication reports `send`;
  a subscription acknowledgement or publication received from that broker reports `receive`.
  Credential, subscription-send, and socket errors use the broker's `send` scope.
- `WebRTCTransport` reports the remote peer ID when its current data channel opens and the
  router accepts the link. Signaling reports `(undefined, 'send')` after publication succeeds
  and `(undefined, 'receive')` after an authenticated packet is accepted. The matching
  `onError` arguments include the error first. Peer-scoped failures remain until that peer's
  link opens again.

Receive recovery preserves outstanding send failures, and send recovery preserves outstanding
receive failures. A healthy broker or peer leaves failures at other brokers or peers intact.

`WebRTCTransport.onPeerLeft(peer)` reports an authenticated departure. Applications can
remove that departed peer's outstanding failures. Discovery-record expiry leaves
outstanding failures intact until a matching recovery or authenticated departure.

## Connection lifecycle

`Session.disconnect(peer)` records loss of the last transport path. Membership and presence remain during `suspicionTimeout`; caller-driven `Session.tick(now)` evicts the peer when that deadline passes. `Session.connect(peer)` cancels pending eviction and refreshes local presence. `Session.retire(peer)` and received `LEAVE` messages remove presence immediately and fence the departed incarnation.

Custom `PresenceObserver` implementations receive `connected()` when a new or restored link becomes available. Attached `Presence` instances use it to republish current selections or offline removals with a fresh clock. Removed peers retain their clock floors so delayed messages cannot restore old carets.

## TURN verification

The browser suite skips its TURN-only case until `COLLABORATION_TEST_TURN` contains an
array of `RTCIceServer` objects for a relay you control. Run this from the package directory:

```sh
COLLABORATION_TEST_TURN='[{"urls":"turn:127.0.0.1:3478?transport=udp","username":"test-member","credential":"your-ephemeral-credential"}]' \
  bun run test:browser -- test/transports.browser.test.ts -t TURN-only
```

Configure the relay's listening address, relay address, credentials and UDP port range.
A loopback-only coturn instance also needs `--allow-loopback-peers` for two local browser
peers. Keep that instance bound to loopback and stop it after the test. For checks across
machines, use a private interface both machines can reach and allow its relay port range.

The case uses two real browser pages with `iceTransportPolicy: 'relay'` and exchanges
chunked edits. It checks that both peers select a `relay` local and remote ICE candidate
and that the selected pairs send and receive bytes. A configured relay that fails to
connect fails the test.

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://shaulavo.dev/singapore/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
