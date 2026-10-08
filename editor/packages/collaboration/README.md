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
