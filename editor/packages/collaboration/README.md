# @singapore-editor/collaboration

Editor binding, session protocols, transports, and remote cursor presence for host-ordered collaboration.

Part of [Singapore](https://shaulavo.dev/singapore/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/collaboration
```

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
